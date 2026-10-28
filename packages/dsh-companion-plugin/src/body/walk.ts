import type { BodyEvent, BodyObject, BodyState, BodyWarp, BodyWorld, ObstacleRow } from "@dsh-player2/contracts";
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

export interface WalkOptions {
  readonly signal?: AbortSignal;
  /** Clear-the-way rows: small breakable things the walk may clear off its own path. */
  readonly obstacles?: readonly ObstacleRow[];
}

const MAX_ATTEMPTS = 24;
const MAX_CLEARS = 12;
/** A way around that is this many tiles longer than straight through is worth clearing. */
const DETOUR_TILES = 12;

/**
 * Walks the body with the navigation helpers: plan a leg from the latest
 * state, play it as raw input, look again, re-plan. Crosses locations over the
 * exported warp graph. Blocked steps mark the tile and re-plan around it; it
 * gives up honestly with the reason instead of looping.
 */
export async function walkTo(body: BodyPort, controls: Controls, loadWorld: () => Promise<BodyWorld>, asked: WalkTarget, options: WalkOptions = {}): Promise<WalkResult> {
  const { signal, obstacles = [] } = options;
  let target = asked;
  let through: string | null = null;
  const started = Date.now();
  const events: BodyEvent[] = [];
  const blocked: Tile[] = [];
  const cleared: string[] = [];
  const unclearable = new Set<string>();
  let legs = 0;
  let world: BodyWorld | undefined;
  let last: BodyState | undefined;
  const result = (ok: boolean, reason: string): WalkResult => ({
    ok, reason: [reason, ...(through === null ? [] : [`went through the way out at the target into ${through}`]), ...(cleared.length > 0 ? [`cleared on the way: ${cleared.join(", ")}`] : [])].join("; "),
    location: last?.body?.location ?? null, x: last?.body?.x ?? null, y: last?.body?.y ?? null,
    legs, ms: Date.now() - started, events: events.slice(-12),
  });
  /** Clears the first breakable thing on the straight way when there is no way around, or only a long one. */
  const clearIfWorth = async (goals: readonly Tile[], around: readonly Tile[] | undefined): Promise<boolean> => {
    if (obstacles.length === 0 || cleared.length >= MAX_CLEARS || last === undefined) return false;
    const hit = obstacleOnTheWay(last, goals, obstacles, unclearable);
    if (hit === null || (around !== undefined && around.length <= hit.pathLength + DETOUR_TILES)) return false;
    const outcome = await clearObstacle(body, controls, last, hit, blocked, signal);
    if (outcome.state !== undefined) last = outcome.state;
    if (outcome.ok) cleared.push(hit.object.name);
    else unclearable.add(`${hit.object.x},${hit.object.y}`);
    return true;
  };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return result(false, "stopped");
    const state = last = await body.state();
    const self = state.body;
    if (self === null) return result(false, "the companion is not in the world");
    const destination = target.location ?? self.location;
    let leg: ReturnType<typeof planLeg>;
    let warped = false;
    if (self.location === destination && target.mode === "stand" && through === null) {
      // Standing on a door or a map exit means going through it: walk to where it leads instead.
      const door = doorAt(state.warps, target, new Walkability(state).walkable(target.x, target.y));
      if (door !== undefined) {
        through = door.to;
        target = { location: door.to, x: door.toX, y: door.toY, mode: "stand" };
        continue;
      }
    }
    if (self.location === destination) {
      const goal = { x: target.x, y: target.y };
      if (target.mode === "stand" && self.x === goal.x && self.y === goal.y) return result(true, "arrived");
      if (target.mode === "adjacent" && Math.abs(self.x - goal.x) + Math.abs(self.y - goal.y) === 1) {
        const facing = directionTo(self, goal);
        if (self.facing !== facing) last = (await body.run([faceStep(controls, facing)], signal ? { signal } : {})).state ?? last;
        return result(true, "arrived next to the target and facing it");
      }
      leg = planLeg(state, controls, { tile: goal, mode: target.mode }, blocked);
      if (await clearIfWorth(target.mode === "stand" ? [goal] : neighbours(goal, self), leg?.path)) continue;
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
      const exit = { x: Math.min(Math.max(hop.warp.x, 0), state.map.width - 1), y: Math.min(Math.max(hop.warp.y, 0), state.map.height - 1) };
      const goals = hop.warp.kind === "walk" ? [exit] : neighbours(exit, self);
      if (await clearIfWorth(goals, leg?.path)) continue;
      if (leg === undefined) {
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

/** The warp on the tile, or, when the tile itself cannot be stood on, one right next to it. */
function doorAt(warps: readonly BodyWarp[], tile: Tile, standable: boolean): BodyWarp | undefined {
  return warps.find((warp) => warp.x === tile.x && warp.y === tile.y)
    ?? (standable ? undefined : warps.find((warp) => Math.abs(warp.x - tile.x) + Math.abs(warp.y - tile.y) === 1));
}

/** The tiles an object covers (clumps span several). */
function tilesOf(o: BodyObject): Tile[] {
  const w = typeof o.extra?.width === "number" ? o.extra.width : 1;
  const h = typeof o.extra?.height === "number" ? o.extra.height : 1;
  return Array.from({ length: w * h }, (_, i) => ({ x: o.x + (i % w), y: o.y + Math.floor(i / w) }));
}

/** The shortest way to the goals with these objects opened, and the objects it goes through. */
function openedPath(state: BodyState, goals: readonly Tile[], opened: readonly BodyObject[]): { path: Tile[]; on: BodyObject[] } | undefined {
  const rows = state.map.rows.map((row) => [...row]);
  for (const t of opened.flatMap(tilesOf)) if (rows[t.y]?.[t.x] !== undefined) rows[t.y][t.x] = ".";
  const kept = state.objects.filter((o) => !opened.includes(o));
  const path = findPath(new Walkability({ ...state, map: { ...state.map, rows: rows.map((row) => row.join("")) }, objects: kept }), state.body!, goals);
  if (path === undefined) return undefined;
  const on = opened
    .map((o) => ({ o, at: path.findIndex((p) => tilesOf(o).some((t) => t.x === p.x && t.y === p.y)) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((hit) => hit.o);
  return { path, on };
}

/**
 * Why no path: the objects on the shortest way when only they block it, else walled off. The
 * exported grid marks an object's tiles blocked too, so they are opened here. Clumps (stumps,
 * logs, boulders) take upgraded tools, so a way around them is named first.
 */
function inTheWay(state: BodyState, goals: readonly Tile[]): string {
  const blocking = state.objects.filter((o) => o.extra?.passable === false);
  for (const objects of [blocking.filter((o) => o.kind !== "clump"), blocking]) {
    const found = openedPath(state, goals, objects);
    if (found === undefined) continue;
    return found.on.length === 0 ? "someone stands in the way" : `in the way: ${found.on.slice(0, 4).map((o) => `${o.name} at (${o.x},${o.y})${typeof o.extra?.note === "string" ? ` (${o.extra.note})` : ""}`).join(", ")}`;
  }
  return "walled off";
}

/** The obstacle row an object answers to, if any. */
export function obstacleRowOf(object: BodyObject, rows: readonly ObstacleRow[]): ObstacleRow | undefined {
  if (object.extra?.passable !== false) return undefined;
  const internal = typeof object.extra?.internalName === "string" ? object.extra.internalName : undefined;
  return rows.find((row) => (object.id !== undefined && (row.match.ids ?? []).includes(object.id)) || (internal !== undefined && (row.match.internalNames ?? []).includes(internal)));
}

/** The toolbar slot of the first item whose id contains one of the row's tool ids. */
function toolSlot(items: readonly { slot: number; id: string }[], tool: readonly string[]): number | null {
  for (const part of tool) {
    const item = items.find((candidate) => candidate.id.includes(part));
    if (item !== undefined) return item.slot;
  }
  return null;
}

export interface ObstacleHit { readonly object: BodyObject; readonly row: ObstacleRow; readonly pathLength: number }

/** The first breakable thing, with a tool for it at hand, on the shortest way straight through. */
export function obstacleOnTheWay(state: BodyState, goals: readonly Tile[], rows: readonly ObstacleRow[], skip: ReadonlySet<string> = new Set()): ObstacleHit | null {
  const items = state.body?.items ?? [];
  const clearable = state.objects.filter((o) => {
    const row = obstacleRowOf(o, rows);
    return row !== undefined && !skip.has(`${o.x},${o.y}`) && toolSlot(items, row.tool) !== null;
  });
  if (clearable.length === 0) return null;
  const found = openedPath(state, goals, clearable);
  const first = found?.on[0];
  if (found === undefined || first === undefined) return null;
  return { object: first, row: obstacleRowOf(first, rows)!, pathLength: found.path.length };
}

const stillThere = (state: BodyState, object: BodyObject) =>
  state.objects.some((o) => o.x === object.x && o.y === object.y && o.extra?.passable === false && o.name === object.name);

/** The clear-the-way combo: walk next to it, face it, select the tool, swing until it is gone. */
async function clearObstacle(body: BodyPort, controls: Controls, state: BodyState, hit: ObstacleHit, blocked: readonly Tile[], signal: AbortSignal | undefined): Promise<{ ok: boolean; state?: BodyState }> {
  const tile = { x: hit.object.x, y: hit.object.y };
  const options = signal ? { signal } : {};
  const leg = planLeg(state, controls, { tile, mode: "adjacent" }, blocked);
  if (leg === undefined) return { ok: false };
  await body.run(leg.steps.slice(0, 64), { until: { blockedMs: 600 }, ...options });
  for (let swing = 0; swing <= hit.row.maxSwings; swing++) {
    const now = await body.state();
    const self = now.body;
    if (self === null) return { ok: false, state: now };
    if (!stillThere(now, hit.object)) return { ok: true, state: now };
    const slot = toolSlot(self.items, hit.row.tool);
    if (swing === hit.row.maxSwings || slot === null || Math.abs(self.x - tile.x) + Math.abs(self.y - tile.y) !== 1 || signal?.aborted) return { ok: false, state: now };
    await body.run([faceStep(controls, directionTo(self, tile)), { press: [`Slot${slot + 1}`], ms: 0 }, ...hit.row.swing], options);
  }
  return { ok: false };
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
