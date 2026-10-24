import type { Approach, RunContext } from "../lib/harness.ts";
import { controls, faceAndPress, goto } from "../lib/capabilities.ts";

/**
 * The toy2 ports: what it takes to point each prototype at the second toy game
 * (Keycraft: keys, doors, materials, crafting — a different state and input
 * vocabulary from the tile/tool farm sim). This file IS the porting-cost
 * evidence; the numbers are counted by bench/lib/loc.ts and reported per
 * approach:
 *
 * - llm, llm-bt, modes, skills, hybrid: ZERO code changed. Their per-game
 *   knowledge is authored at runtime by the model (a tree, a mode table, a
 *   skill, a directive), keyed by the scenario, so the same approach code runs
 *   unmodified against toy2's declaration.
 * - goap: the fixed stack gained additions for toy2 (itemAtLeast predicate
 *   kind, haveItems goal kind with its forward BFS planner, pressAt operator,
 *   doorKeys domain field — see approach-goap.ts's porting-history comment)
 *   plus a new domain JSON (domains/toy2.json); those lines are its port cost.
 * - handcoded: a full rewrite of the scenario controller below, because every
 *   game fact is code in that architecture.
 */

export function toy2Approaches(registry: Record<string, Approach>): Record<string, Approach> {
  const ports: Record<string, Approach> = {};
  for (const id of ["llm", "llm-bt", "modes", "skills", "hybrid", "goap"]) {
    const approach = registry[id];
    if (approach !== undefined) ports[id] = approach;
  }
  ports.handcoded = { id: "handcoded", label: "Hand-written state machines (toy2 port)", blurb: "rewritten for Keycraft", run: runHandCodedToy2 };
  return ports;
}

/** The Keycraft controller: a fixed, verified sequence — key, doors, materials, craft. */
async function runHandCodedToy2(ctx: RunContext): Promise<boolean> {
  const controlsRef = await controls(ctx.port);
  const interact = async (x: number, y: number, button: string): Promise<string> => {
    const walk = await goto(ctx.port, controlsRef, { x, y }, { mode: "adjacent", signal: ctx.signal });
    if (!walk.ok) return `walk failed: ${walk.reason.slice(0, 60)}`;
    const result = await faceAndPress(ctx.port, controlsRef, { x, y }, button, undefined, ctx.signal);
    return result.detail.slice(0, 80);
  };
  const held = async (name: string): Promise<boolean> => {
    const state = await ctx.port.state();
    return (state.body?.items.filter((item) => item.name === name).reduce((sum, item) => sum + item.stack, 0) ?? 0) > 0;
  };
  const gone = async (x: number, y: number): Promise<boolean> => {
    const state = await ctx.port.state();
    return !state.objects.some((object) => object.x === x && object.y === y);
  };

  const step = async (label: string, act: () => Promise<string>, verify: () => Promise<boolean>): Promise<boolean> => {
    if (await verify()) return true;
    for (let attempt = 0; attempt < 2 && !ctx.signal.aborted; attempt++) {
      const detail = await act();
      ctx.log(`${label}: ${detail}`);
      if (await verify()) return true;
      ctx.noteRecovery(`${label} did not verify`);
    }
    return false;
  };

  const plan: { label: string; act: () => Promise<string>; verify: () => Promise<boolean> }[] = [
    { label: "pick red key", act: () => interact(2, 2, "KeyE"), verify: () => held("Red Key") },
    { label: "open red door", act: () => interact(8, 3, "KeyE"), verify: () => gone(8, 3) },
    { label: "pick wood a", act: () => interact(6, 7, "KeyE"), verify: async () => (await count("Wood")) >= 1 },
    { label: "pick wood b", act: () => interact(10, 1, "KeyE"), verify: async () => (await count("Wood")) >= 2 },
    { label: "pick wood c", act: () => interact(10, 3, "KeyE"), verify: async () => (await count("Wood")) >= 3 },
    { label: "pick blue key", act: () => interact(11, 1, "KeyE"), verify: () => held("Blue Key") },
    { label: "open blue door", act: () => interact(8, 6, "KeyE"), verify: () => gone(8, 6) },
    { label: "pick stone a", act: () => interact(10, 7, "KeyE"), verify: async () => (await count("Stone")) >= 1 },
    { label: "pick stone b", act: () => interact(11, 8, "KeyE"), verify: async () => (await count("Stone")) >= 2 },
    { label: "craft crown", act: () => interact(6, 2, "KeyC"), verify: () => held("Crown") },
  ];

  async function count(name: string): Promise<number> {
    const state = await ctx.port.state();
    return state.body?.items.filter((item) => item.name === name).reduce((sum, item) => sum + item.stack, 0) ?? 0;
  }

  for (const step_ of plan) {
    if (ctx.signal.aborted) return false;
    if (!(await step(step_.label, step_.act, step_.verify))) return false;
  }
  return true;
}
