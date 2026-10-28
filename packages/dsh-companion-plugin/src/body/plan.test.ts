import { afterEach, describe, expect, it, vi } from "vitest";
import type { BodyObject } from "@dsh-player2/contracts";
import { PlanBoard, type PlanStepInput } from "./plan.js";
import { sleep } from "./port.js";
import { SimAdapter, type SimLocation } from "./sim-adapter.testkit.js";
import { StuckWatch } from "./stuck.js";

vi.setConfig({ testTimeout: 60_000 });

/**
 * The small brain over the bench's locked scenario (P2-0019b T3, P2-0019c; the
 * fixture is ported from research/self-improve/bench/lib/locked.ts): the mind
 * hands down steps, plain code keeps the body working them without a model
 * turn, the mind is woken when the plan finishes or a wall stops it, and the
 * idle ratio / actions per game minute come out far ahead of a mind-driven
 * baseline — the round-2 async claim, measured here on the sim.
 */

const ROWS = (() => {
  const grid: string[] = [];
  for (let y = 0; y < 10; y++) {
    if (y === 0 || y === 9) grid.push("#".repeat(13));
    else if (y === 3) grid.push("###########.#");
    else grid.push(`#${".".repeat(11)}#`);
  }
  return grid;
})();

const KIT = [{ slot: 0, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" }];

function open(): SimAdapter {
  const objects: BodyObject[] = [{ x: 11, y: 1, kind: "chest", name: "Old Shrine Chest", extra: { passable: true } }];
  return new SimAdapter({ locations: [{ name: "Meadow", rows: [...ROWS], warps: [], objects, characters: [] } as SimLocation], body: { location: "Meadow", x: 2, y: 7, items: KIT.map((i) => ({ ...i })) } });
}

const sims: SimAdapter[] = [];

afterEach(async () => {
  await Promise.all(sims.splice(0).map((s) => s.stop()));
});

interface Board {
  board: PlanBoard;
  watch: StuckWatch;
  woken: () => number;
}

function board(sim: SimAdapter): Board {
  const watch = new StuckWatch();
  let wakes = 0;
  const plan = new PlanBoard(sim, watch, () => { wakes++; });
  return { board: plan, watch, woken: () => wakes };
}

async function until(ready: () => boolean, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready() && Date.now() < deadline) await sleep(50);
}
describe("the plan board", () => {
  it("works handed-down steps in code with no model turn, reports, and wakes the mind when finished", async () => {
    const sim = open();
    sims.push(sim);
    await sim.start(1);
    const made = board(sim);
    made.board.start();
    made.board.set("reach the shrine", [
      { label: "walk to the pass", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "walk to the chest", tool: "body_walk_to", args: { x: 11, y: 1 }, expect: { at: { x: 11, y: 1 } } },
    ]);
    expect(made.woken()).toBe(0);
    await until(() => sim.tile.x === 11 && sim.tile.y === 1);
    expect(sim.tile).toEqual({ x: 11, y: 1 });
    const deadline = Date.now() + 20_000;
    let facts = "";
    while (Date.now() < deadline) {
      facts += made.board.drain().join("\n");
      if (facts.includes("Plan finished: reach the shrine")) break;
      await sleep(50);
    }
    expect(facts).toContain("Plan finished: reach the shrine");
    expect(made.woken()).toBeGreaterThanOrEqual(1); // the mind is woken only when the plan finished
  });

  it("a step whose expected change fails to show feeds the stuck detector and stops the body", async () => {
    const sim = open();
    // The pass is closed: walks to (11,4) cannot change the world.
    sim.locations.get("Meadow")!.objects.push({ x: 11, y: 4, kind: "rock", name: "Rockslide", extra: { passable: false } });
    sims.push(sim);
    await sim.start(1);
    const made = board(sim);
    made.board.start();
    const steps: PlanStepInput[] = [
      { label: "push the pass", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "push the pass again", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "and again", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "never runs", tool: "body_walk_to", args: { x: 2, y: 7 } },
    ];
    made.board.set("break through the rocks", steps);
    const deadline = Date.now() + 20_000;
    let facts = "";
    while (Date.now() < deadline) {
      facts += made.board.drain().join("\n");
      if (facts.includes("stopped working the plan")) break;
      await sleep(50);
    }
    expect(made.watch.isHolding()).toBe(true);
    expect(facts).toContain("expected change did not show");
    expect(facts).toContain("stopped working the plan");
    expect(facts).not.toContain("never runs: OK");
    expect(sim.tile).toEqual({ x: 2, y: 7 });
  });

  it("taking a plan back clears it and marks the wake", async () => {
    const sim = open();
    sims.push(sim);
    await sim.start(1);
    const made = board(sim);
    made.board.start();
    made.board.set("hold still", [{ label: "wait", tool: "wait", args: { minutes: 8 } }]);
    await until(() => sim.snapshot().body?.activeTask != null);
    expect(made.board.set("rethink", [])).toContain("Plan cleared");
    expect(made.board.wakePending()).toBe(true);
  });

  it("refuses a step whose arguments are not inside args, teaching the shape", () => {
    const made = board(open());
    // The live failure: the tool's arguments spread beside args instead of inside it.
    expect(() => made.board.set("bad shape", [{ tool: "body_input", steps: [{ press: ["A"], ms: 50 }] }] as never)).toThrow(/inside args/);
    expect(() => made.board.set("no args", [{ tool: "body_walk_to" }] as never)).toThrow(/inside args/);
  });
});

describe("the async claim on the sim (idle ratio, actions per game minute)", () => {
  it("keeps the body busy while the model thinks, far beyond a mind-driven baseline", async () => {
    // Baseline: the old mind-driven shape — one input per "turn", the model thinking between.
    const baseline = open();
    sims.push(baseline);
    // Real-time pace for both sims: idle is sampled on the wall clock, so sim time has to track it on every platform.
    await baseline.start(1000 / 60);
    const baseSamples: boolean[] = [];
    const sampler = setInterval(() => { baseSamples.push(baseline.snapshot().body?.activeTask != null); }, 20);
    const baseDeadline = Date.now() + 3_000;
    while (Date.now() < baseDeadline) {
      await baseline.run([{ hold: ["DPadRight"], ms: 200 }]);
      await sleep(800); // the model "thinking"
    }
    clearInterval(sampler);
    const baseIdle = baseSamples.filter((active) => !active).length / baseSamples.length;

    // Small brain: one plan handed down; the "model" sleeps for the same span.
    const sim = open();
    sims.push(sim);
    await sim.start(1000 / 60);
    const made = board(sim);
    made.board.start();
    const steps: PlanStepInput[] = [];
    for (let index = 0; index < 12; index++) {
      steps.push({ label: `pace ${index}`, tool: "body_input", args: { steps: [{ hold: [index % 2 === 0 ? "DPadRight" : "DPadLeft"], ms: 400 }] } });
      steps.push({ label: `breathe ${index}`, tool: "wait", args: { minutes: 1 } });
    }
    made.board.set("pace the meadow", steps);
    const asyncSamples: boolean[] = [];
    const timer = setInterval(() => { asyncSamples.push(sim.snapshot().body?.activeTask != null); }, 20);
    await sleep(3_000);
    clearInterval(timer);
    const asyncIdle = asyncSamples.filter((active) => !active).length / asyncSamples.length;
    const done = made.board.drain().filter((fact) => fact.startsWith("Plan,")).length;
    console.log(`p2-0019c sim bench: idle baseline(mind-driven) ${baseIdle.toFixed(2)} vs small brain(plan) ${asyncIdle.toFixed(2)}; async steps in 3 s: ${done}`);
    expect(asyncIdle).toBeLessThan(baseIdle / 2);
    expect(done).toBeGreaterThan(6);
  });
});
