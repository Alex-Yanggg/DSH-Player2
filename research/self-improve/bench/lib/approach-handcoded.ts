import type { RunContext } from "./harness.ts";
import type { BenchState } from "./port.ts";
import { controls, faceAndPress, goto, useTool, workTile, type Controls } from "./capabilities.ts";

/**
 * A hand-written controller: fixed per-scenario state machines, no model in
 * the loop at all. This is both the bench's plumbing smoke test and the
 * prototype for the "hand-written behavior trees / state machines" advocate —
 * every game fact it knows is hardcoded here, which is exactly the porting
 * cost that architecture pays.
 *
 * Farm: a fixed sequence — for each plot tile: till, plant, water, verified
 * from state after every action, one retry per step.
 * Mine: a loop over three states — ROUTE (guarded walk to the ladder),
 * FIGHT (swing at an adjacent monster), MOVE_OFF (a monster is on your tile).
 */

const HOE_SLOT = 0;
const CAN_SLOT = 1;
const SEED_SLOT = 2;
const SWORD_SLOT = 0;

const PLOT_TILES = [
  { x: 7, y: 3 }, { x: 8, y: 3 }, { x: 9, y: 3 },
  { x: 7, y: 4 }, { x: 8, y: 4 }, { x: 9, y: 4 },
];

const LADDER = { x: 11, y: 1 };

async function runFarm(ctx: RunContext, controlsRef: Controls): Promise<boolean> {
  for (const tile of PLOT_TILES) {
    if (ctx.signal.aborted) return false;
    const till = async () => workTile(ctx.port, controlsRef, tile, HOE_SLOT, "ControllerX", ctx.signal);
    if (!(await withRetry(ctx, till, async (state) => state.objects.some((o) => o.x === tile.x && o.y === tile.y && o.kind === "dirt"), `till ${tile.x},${tile.y}`))) return false;
    const plant = async () => workTile(ctx.port, controlsRef, tile, SEED_SLOT, "ControllerA", ctx.signal);
    if (!(await withRetry(ctx, plant, async (state) => state.objects.some((o) => o.x === tile.x && o.y === tile.y && o.extra?.crop === "Parsnip"), `plant ${tile.x},${tile.y}`))) return false;
    const water = async () => workTile(ctx.port, controlsRef, tile, CAN_SLOT, "ControllerX", ctx.signal);
    if (!(await withRetry(ctx, water, async (state) => state.objects.some((o) => o.x === tile.x && o.y === tile.y && o.extra?.watered === true), `water ${tile.x},${tile.y}`))) return false;
  }
  const state = await ctx.port.state();
  return state.objects.filter((o) => o.extra?.crop === "Parsnip" && o.extra?.watered === true).length >= 6;
}

async function withRetry(ctx: RunContext, step: () => Promise<{ ok: boolean; detail: string }>, verify: (state: BenchState) => Promise<boolean>, label: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (ctx.signal.aborted) return false;
    const result = await step();
    ctx.log(`${label}: ${result.detail}`);
    if (await verify(await ctx.port.state())) return true;
    ctx.noteRecovery(`${label} did not verify (${result.detail})`);
  }
  return false;
}

async function runMine(ctx: RunContext, controlsRef: Controls): Promise<boolean> {
  for (;;) {
    if (ctx.signal.aborted) return false;
    const state = await ctx.port.state();
    const body = state.body;
    if (body === null) return false;
    if (body.x === LADDER.x && body.y === LADDER.y) return true;
    if (state.body !== null && state.body.health <= 0) return false;
    const monsters = state.characters.filter((c) => c.kind === "monster");
    const onTop = monsters.find((m) => m.x === body.x && m.y === body.y);
    const adjacent = monsters.find((m) => Math.abs(m.x - body.x) + Math.abs(m.y - body.y) === 1);

    if (onTop !== undefined) {
      // MOVE_OFF: step two tiles away in the most open direction, then re-plan.
      ctx.noteRecovery(`${onTop.name} is on top of the body`);
      const away = firstOpenDir(state, onTop.x, onTop.y);
      if (away === undefined) return false;
      await goto(ctx.port, controlsRef, { x: body.x + away.dx * 2, y: body.y + away.dy * 2 }, { signal: ctx.signal });
      continue;
    }
    if (adjacent !== undefined) {
      // FIGHT: face the monster and swing; the sim removes a monster on the faced tile.
      const swing = await faceAndPress(ctx.port, controlsRef, { x: adjacent.x, y: adjacent.y }, "ControllerX", SWORD_SLOT, ctx.signal);
      ctx.log(`swing at ${adjacent.name}: ${swing.detail}`);
      continue;
    }
    // ROUTE: a guarded walk that interrupts when a monster comes within 2 tiles.
    const walk = await guardedRoute(ctx, controlsRef);
    if (walk === "arrived") return true;
    if (walk === "retry") continue;
    // No path or repeatedly blocked: clear the nearest monster instead.
    const nearest = monsters.sort((a, b) => (Math.abs(a.x - body.x) + Math.abs(a.y - body.y)) - (Math.abs(b.x - body.x) + Math.abs(b.y - body.y)))[0];
    if (nearest === undefined) return false;
    ctx.noteRecovery(`route to ladder failed; engaging ${nearest.name}`);
    await goto(ctx.port, controlsRef, { x: nearest.x, y: nearest.y }, { mode: "adjacent", signal: ctx.signal });
  }
}

function firstOpenDir(state: BenchState, mx: number, my: number): { dx: number; dy: number } | undefined {
  const body = state.body;
  if (body === null) return undefined;
  const dirs = [
    { dx: Math.sign(body.x - mx) || 1, dy: 0 },
    { dx: 0, dy: Math.sign(body.y - my) || 1 },
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  ];
  for (const dir of dirs) {
    const x = body.x + dir.dx;
    const y = body.y + dir.dy;
    const row = state.map.rows[y];
    if (row?.[x] === "." && !state.characters.some((c) => c.kind === "monster" && c.x === x && c.y === y)) return dir;
  }
  return undefined;
}

async function guardedRoute(ctx: RunContext, controlsRef: Controls): Promise<"arrived" | "retry" | "failed"> {
  const state = await ctx.port.state();
  const body = state.body;
  if (body === null) return "failed";
  const monsters = state.characters.filter((c) => c.kind === "monster");
  const near = monsters.some((m) => Math.abs(m.x - body.x) + Math.abs(m.y - body.y) <= 2);
  if (near) return "retry"; // let the loop's FIGHT branch handle it
  const walk = await goto(ctx.port, controlsRef, LADDER, { signal: ctx.signal });
  if (walk.ok) return "arrived";
  ctx.noteRecovery(`guarded walk: ${walk.reason}`);
  return "failed";
}

export async function runHandCoded(ctx: RunContext): Promise<boolean> {
  const controlsRef = await controls(ctx.port);
  return ctx.task.scenario === "farm" ? runFarm(ctx, controlsRef) : runMine(ctx, controlsRef);
}
