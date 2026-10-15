import type { BodyEvent, BodyState, BodyWorld } from "@dsh-player2/contracts";
import type { BodyPort } from "./port.js";
import { directionTo, faceStep, findPath, locationRoute, neighbours, planLeg, Walkability, type Controls, type Tile } from "./navigation.js";

/** The outcome of one helper-driven walk, in plain facts. */
export interface WalkResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly location: string | null;
  readonly x: number | null;
  readonly y: number | null;
  readonly legs: number;
  readonly ms: number;
  readonly events: readonly BodyEvent[];
}

export interface WalkTarget {
  readonly location?: string;
  readonly x: number;
  readonly y: number;
  /** `stand` on the tile, or stop `adjacent` to it and face it (for tools and the action button). */
  readonly mode: "stand" | "adjacent";
}

const MAX_ATTEMPTS = 14;

/**
 * Walks the body with the navigation helpers: plan a leg from the latest
 * state, play it as raw input, look again, re-plan. Crosses locations over the
 * exported warp graph. Blocked steps mark the tile and re-plan around it; it
 * gives up honestly with the reason instead of looping.
 */
export async function walkTo(body: BodyPort, controls: Controls, loadWorld: () => Promise<BodyWorld>, target: WalkTarget, signal?: AbortSignal): Promise<WalkResult> {
  const started = Date.now();
  const events: BodyEvent[] = [];
  const blocked: Tile[] = [];
  let legs = 0;
  let world: BodyWorld | undefined;
  let last: BodyState | undefined;
  const result = (ok: boolean, reason: string): WalkResult => ({
    ok, reason, location: last?.body?.location ?? null, x: last?.body?.x ?? null, y: last?.body?.y ?? null,
    legs, ms: Date.now() - started, events: events.slice(-12),
  });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return result(false, "stopped");
    const state = last = await body.state();
    const self = state.body;
    if (self === null) return result(false, "the companion is not in the world");
    const destination = target.location ?? self.location;
    let leg: ReturnType<typeof planLeg>;
    let warped = false;
    if (self.location === destination) {
      const goal = { x: target.x, y: target.y };
      if (target.mode === "stand" && self.x === goal.x && self.y === goal.y) return result(true, "arrived");
      if (target.mode === "adjacent" && Math.abs(self.x - goal.x) + Math.abs(self.y - goal.y) === 1) {
        const facing = directionTo(self, goal);
        if (self.facing !== facing) last = (await body.run([faceStep(controls, facing)], signal ? { signal } : {})).state ?? last;
        return result(true, "arrived next to the target and facing it");
      }
      leg = planLeg(state, controls, { tile: goal, mode: target.mode }, blocked);
      if (leg === undefined) {
        return result(false, target.mode === "stand"
          ? `no walkable path from ${self.location} (${self.x},${self.y}) to (${goal.x},${goal.y}); ${inTheWay(state, [goal])}`
          : `no walkable tile next to (${goal.x},${goal.y}) is reachable from (${self.x},${self.y}) in ${self.location}; ${inTheWay(state, neighbours(goal, self))}`);
      }
    } else {
      world ??= await loadWorld();
      const route = locationRoute(world, self.location, destination);
      if (route === undefined) return result(false, `no known route from ${self.location} to ${destination} in the exported location graph`);
      const hop = route[0];
      leg = planLeg(state, controls, { tile: { x: hop.warp.x, y: hop.warp.y }, mode: hop.warp.kind === "walk" ? "walk-warp" : "action-warp" }, blocked);
      if (leg === undefined) {
        const exit = { x: Math.min(Math.max(hop.warp.x, 0), state.map.width - 1), y: Math.min(Math.max(hop.warp.y, 0), state.map.height - 1) };
        const goals = hop.warp.kind === "walk" ? [exit] : neighbours(exit, self);
        return result(false, `no walkable path in ${self.location} from (${self.x},${self.y}) to the exit toward ${hop.warp.to} at (${hop.warp.x},${hop.warp.y}); ${inTheWay(state, goals)}`);
      }
      warped = true;
    }
    // No early "arrive" stop: whole-tile holds keep the body on tile centres.
    const run = await body.run(leg.steps.slice(0, 64), { until: warped ? { warped: true, blockedMs: 600 } : { blockedMs: 600 }, ...(signal ? { signal } : {}) });
    legs++;
    events.push(...run.events);
    last = run.state ?? last;
    const outcome = settle(run.status, run.reason, leg.path, last, blocked);
    if (outcome !== undefined) return result(false, outcome);
  }
  return result(false, `gave up after ${MAX_ATTEMPTS} legs without reaching the target`);
}

/**
 * Why no path: the objects on the shortest way when only they block it, else walled off. The
 * exported grid marks an object's tiles blocked too, so they are opened here. Clumps (stumps,
 * logs, boulders) take upgraded tools, so a way around them is named first.
 */
function inTheWay(state: BodyState, goals: readonly Tile[]): string {
  const tiles = (o: BodyState["objects"][number]) => {
    const w = typeof o.extra?.width === "number" ? o.extra.width : 1;
    const h = typeof o.extra?.height === "number" ? o.extra.height : 1;
    return Array.from({ length: w * h }, (_, i) => ({ x: o.x + (i % w), y: o.y + Math.floor(i / w) }));
  };
  const blocking = state.objects.filter((o) => o.extra?.passable === false);
  for (const objects of [blocking.filter((o) => o.kind !== "clump"), blocking]) {
    const rows = state.map.rows.map((row) => [...row]);
    for (const t of objects.flatMap(tiles)) if (rows[t.y]?.[t.x] !== undefined) rows[t.y][t.x] = ".";
    const open = { ...state, map: { ...state.map, rows: rows.map((row) => row.join("")) }, objects: [] };
    const path = findPath(new Walkability(open), state.body!, goals);
    if (path === undefined) continue;
    const on = objects.filter((o) => tiles(o).some((t) => path.some((p) => p.x === t.x && p.y === t.y)));
    return on.length === 0 ? "someone stands in the way" : `in the way: ${on.slice(0, 4).map((o) => `${o.name} at (${o.x},${o.y})`).join(", ")}`;
  }
  return "walled off";
}

/** Returns a terminal failure reason, or undefined to keep going (after marking a blocking tile). */
function settle(status: string, reason: string | null, path: readonly Tile[], state: BodyState | undefined, blocked: Tile[]): string | undefined {
  if (status === "cancelled") return `cancelled (${reason ?? "no reason"})`;
  if (status === "timeout") return `the game did not finish the input: ${reason ?? "timeout"}`;
  if (status === "failed") return `the adapter refused the input: ${reason ?? "failed"}`;
  if (reason === "blocked" && state?.body) {
    const index = path.findIndex((tile) => tile.x === state.body!.x && tile.y === state.body!.y);
    const next = index >= 0 ? path[index + 1] : undefined;
    if (next !== undefined) blocked.push(next);
    else if (blocked.length > 8) return "blocked repeatedly by something the map does not show";
  }
  return undefined;
}
