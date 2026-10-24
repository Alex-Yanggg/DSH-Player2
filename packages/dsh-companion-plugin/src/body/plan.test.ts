import { afterEach, describe, expect, it, vi } from "vitest";
import type { BodyObject } from "@dsh-player2/contracts";
import { Gate, PlanBoard, type PlanStepInput } from "./plan.js";
import { SimAdapter, type SimLocation } from "./sim-adapter.js";
import { StuckWatch } from "./stuck.js";
import { createBodyTools } from "./tools.js";
import { sleep } from "./port.js";

vi.setConfig({ testTimeout: 60_000 });

/**
 * The async small brain over the bench's locked scenario (P2-0020 T3; the
 * fixture is ported from research/self-improve/bench/lib/locked.ts): the mind
 * hands down steps, plain code keeps the body working them while the model
 * "thinks", and the idle ratio / actions per game minute come out far ahead of
 * the mind-driven baseline — the round-2 async claim, measured here on the sim.
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

function board(sim: SimAdapter): PlanBoard {
  return new PlanBoard(sim, new StuckWatch(), new Gate(), () => undefined);
}

function toolOf(sim: SimAdapter, gate: Gate, name: string): (args: Record<string, unknown>) => Promise<string> {
  const found = createBodyTools({ body: sim, gate }).find((t) => t.name === name)!;
  const run = found as unknown as { execute(args: Record<string, unknown>, exec: unknown): Promise<string> };
  return (args) => run.execute(args, { callId: "call-1", signal: new AbortController().signal });
}

describe("the plan board", () => {
  it("works handed-down steps in code while the mind does nothing, and reports", async () => {
    const sim = open();
    sims.push(sim);
    await sim.start(1);
    const board0 = board(sim);
    board0.set("reach the shrine", [
      { label: "walk to the pass", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "walk to the chest", tool: "body_walk_to", args: { x: 11, y: 1 }, expect: { at: { x: 11, y: 1 } } },
    ]);
    board0.start();
    const deadline = Date.now() + 15_000;
    while (!(sim.tile.x === 11 && sim.tile.y === 1) && Date.now() < deadline) await sleep(50);
    expect(sim.tile).toEqual({ x: 11, y: 1 });
    const until = Date.now() + 5_000;
    while (!board0.drain().some((fact) => fact.startsWith("Plan finished")) && Date.now() < until) await sleep(50);
    expect(board0.status()).toContain("No plan");
  });

  it("a step whose expected change fails to show feeds the stuck detector and stops the body", async () => {
    const sim = open();
    const rocks = sim.locations.get("Meadow")!;
    // The pass is closed: walks to (11,4) cannot change the world.
    rocks.objects.push({ x: 11, y: 4, kind: "rock", name: "Rockslide", extra: { passable: false } });
    sims.push(sim);
    await sim.start(1);
    const watch = new StuckWatch();
    const board0 = new PlanBoard(sim, watch, new Gate(), () => undefined);
    const steps: PlanStepInput[] = [
      { label: "push the pass", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "push the pass again", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "and again", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "never runs", tool: "body_walk_to", args: { x: 2, y: 7 } },
    ];
    board0.set("break through the rocks", steps);
    board0.start();
    const until = Date.now() + 20_000;
    let facts = "";
    while (Date.now() < until) {
      facts += board0.drain().join("\n");
      if (facts.includes("stopped working the plan")) break;
      await sleep(50);
    }
    expect(watch.isHolding()).toBe(true);
    expect(facts).toContain("expected change did not show");
    expect(facts).toContain("stopped working the plan");
    expect(facts).not.toContain("never runs: OK");
    expect(sim.tile).toEqual({ x: 2, y: 7 });
  });

  it("the mind's acting tool queues behind the step the executor is working", async () => {
    const sim = open();
    sims.push(sim);
    await sim.start(1);
    const gate = new Gate();
    const board0 = new PlanBoard(sim, new StuckWatch(), gate, () => undefined);
    board0.start();
    board0.set("hold still", [{ label: "wait", tool: "wait", args: { minutes: 8 } }]);
    const until = Date.now() + 5_000;
    while (sim.snapshot().body?.activeTask == null && Date.now() < until) await sleep(20); // the executor holds the controller
    const input = toolOf(sim, gate, "body_input");
    const started = Date.now();
    await input({ steps: [{ press: ["ControllerA"], ms: 50 }] });
    expect(Date.now() - started).toBeGreaterThan(200); // the mind waited for the wait step, not at once
  });
});

describe("the async claim on the sim (idle ratio, actions per game minute)", () => {
  it("keeps the body busy while the model thinks, far beyond the mind-driven baseline", async () => {
    const watch = new StuckWatch();
    const gate = new Gate();
    // Baseline: the P2-0019 shape — the mind calls one input, thinks, calls again.
    const baseline = open();
    sims.push(baseline);
    await baseline.start(1);
    const input = toolOf(baseline, gate, "body_input");
    const baseSamples: boolean[] = [];
    const baseClock: number[] = [];
    const sampler = setInterval(() => { baseSamples.push(baseline.snapshot().body?.activeTask != null); baseClock.push(baseline.snapshot().tick); }, 20);
    const baseDeadline = Date.now() + 3_000;
    while (Date.now() < baseDeadline) {
      await input({ steps: [{ hold: ["DPadRight"], ms: 200 }] });
      await sleep(800); // the model "thinking"
    }
    clearInterval(sampler);
    const baseIdle = baseSamples.filter((active) => !active).length / baseSamples.length;

    // Async: one plan handed down; the "model" only thinks for the same span.
    const sim = open();
    sims.push(sim);
    await sim.start(1);
    const board0 = new PlanBoard(sim, watch, gate, () => undefined);
    const steps: PlanStepInput[] = [];
    for (let index = 0; index < 12; index++) {
      steps.push({ label: `pace ${index}`, tool: "body_input", args: { steps: [{ hold: [index % 2 === 0 ? "DPadRight" : "DPadLeft"], ms: 400 }] } });
      steps.push({ label: `breathe ${index}`, tool: "wait", args: { minutes: 1 } });
    }
    board0.set("pace the meadow", steps);
    board0.start();
    const asyncSamples: boolean[] = [];
    const timer = setInterval(() => { asyncSamples.push(sim.snapshot().body?.activeTask != null); }, 20);
    await sleep(3_000);
    clearInterval(timer);
    const asyncIdle = asyncSamples.filter((active) => !active).length / asyncSamples.length;
    const done = board0.drain().filter((fact) => fact.startsWith("Plan,")).length;
    console.log(`p2-0020 sim bench: idle baseline(mind-driven) ${baseIdle.toFixed(2)} vs async(plan) ${asyncIdle.toFixed(2)}; async steps in 3 s: ${done}`);
    expect(asyncIdle).toBeLessThan(baseIdle / 2);
    expect(done).toBeGreaterThan(6);
  });
});
