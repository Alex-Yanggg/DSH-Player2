import { afterEach, describe, expect, it, vi } from "vitest";
import type { BodyCharacter, BodyItem, BodyObject } from "@dsh-player2/contracts";
import { PlanBoard } from "./plan.js";
import { sleep } from "./port.js";
import { SimAdapter, type SimLocation, type SimTaskState } from "./sim-adapter.testkit.js";
import { stateDigest, StuckWatch } from "./stuck.js";

vi.setConfig({ testTimeout: 30_000 });

/**
 * The stuck detector over the bench scenarios (P2-0019b T2; the scenarios are
 * ported from research/self-improve/bench/lib/locked.ts and wall.ts): three
 * identical actions on an unchanged world are a wall, and the fact tells the
 * mind to step back. The detector is fed by the plan board's steps (P2-0019c),
 * so these tests drive it the way the small brain does.
 */

const LOCKED_ROWS = (() => {
  const grid: string[] = [];
  for (let y = 0; y < 10; y++) {
    if (y === 0 || y === 9) grid.push("#".repeat(13));
    else if (y === 3) grid.push("###########.#");
    else grid.push(`#${".".repeat(11)}#`);
  }
  return grid;
})();

const WALL_ROWS = (() => {
  const grid: string[] = [];
  for (let y = 0; y < 10; y++) {
    if (y === 0 || y === 9) grid.push("#".repeat(13));
    else if (y === 4 || y === 7) grid.push("#............#");
    else grid.push("#....#......#");
  }
  return grid;
})();

const KIT: BodyItem[] = [
  { slot: 0, id: "(W)0", name: "Rusty Sword", stack: 1, category: "Weapon" },
  { slot: 1, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" },
];

/** The wall scenario: the bridge golem is immune to the starter weapon and never moves. */
class WallSim extends SimAdapter {
  protected override press(id: string, task: SimTaskState): void {
    const faced = this.faced();
    const golem = this.location().characters.find((c) => c.kind === "monster" && c.x === faced.x && c.y === faced.y);
    if ((id === "ControllerX" || id === "ControllerA") && golem !== undefined) {
      task.status = "interrupted";
      task.reason = "golem-counterattack";
      this.note(task, "used", "Rusty Sword swing — the Clay Golem shrugs it off and its counterattack hurts");
      return;
    }
    super.press(id, task);
  }
}

/** The locked scenario: the north pass holds one Rockslide until the crew clears it on day 5. */
function locked(): SimAdapter {
  const objects: BodyObject[] = [
    { x: 11, y: 1, kind: "chest", name: "Old Shrine Chest", extra: { passable: true } },
    { x: 11, y: 4, kind: "rock", name: "Rockslide", extra: { passable: false } },
    { x: 3, y: 7, kind: "notice", name: "Notice Board", extra: { passable: false } },
  ];
  return new SimAdapter({ locations: [{ name: "Meadow", rows: [...LOCKED_ROWS], warps: [], objects, characters: [] } as SimLocation], body: { location: "Meadow", x: 2, y: 7, items: KIT.map((i) => ({ ...i })) } });
}

/** The wall scenario: the bridge golem is immune to the starter weapon and never moves. */
function walled(): SimAdapter {
  const golem: BodyCharacter = { x: 5, y: 4, px: 5 * 64, py: 4 * 64, name: "Clay Golem", kind: "monster", health: 999 };
  return new WallSim({ locations: [{ name: "Riverbank", rows: [...WALL_ROWS], warps: [], objects: [
    { x: 11, y: 1, kind: "bell", name: "Shrine Bell", extra: { passable: true } },
    { x: 5, y: 7, kind: "gate", name: "Great Gate", extra: { passable: false } },
    { x: 1, y: 1, kind: "lever", name: "Shrine Lever", extra: { passable: false } },
  ], characters: [golem] } as SimLocation], body: { location: "Riverbank", x: 2, y: 7, items: KIT.map((i) => ({ ...i })) } });
}

const sims: SimAdapter[] = [];
let watch: StuckWatch;
let board: PlanBoard;

function armed(sim: SimAdapter): PlanBoard {
  watch = new StuckWatch();
  let woken = 0;
  board = new PlanBoard(sim, watch, () => { woken++; });
  sims.push(sim);
  void sim.start(1);
  board.start();
  return board;
}

afterEach(async () => {
  await Promise.all(sims.splice(0).map((s) => s.stop()));
});

/** Waits until the facts so far satisfy `ready`; returns every fact the board reported. */
async function until(ready: (facts: string) => boolean, ms = 20_000): Promise<string> {
  const deadline = Date.now() + ms;
  let facts = "";
  while (Date.now() < deadline) {
    facts += board.drain().join("\n");
    if (ready(facts)) return facts;
    await sleep(50);
  }
  return facts;
}

describe("the stuck detector on the locked scenario", () => {
  it("calls the third identical blocked walk a wall, stops the body, and releases when the pass opens", async () => {
    const sim = locked();
    const board0 = armed(sim);
    board0.set("break through", [
      { label: "push", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "push", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "push", tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { label: "never runs", tool: "body_walk_to", args: { x: 2, y: 7 } },
    ]);
    const fact0 = await until((facts) => facts.includes("stopped working the plan"));
    expect(watch.isHolding()).toBe(true);
    expect(fact0).toContain("expected change did not show");
    expect(fact0).not.toContain("never runs: OK");
    expect(sim.tile).toEqual({ x: 2, y: 7 });
    const fact = watch.take();
    expect(fact).toContain("STUCK");
    expect(fact).toContain("11,4");
    expect(fact).toContain("lesson_learn");
    expect(watch.take()).toBeNull(); // told once
    // The crew clears the rock (day 5): the same walk now moves the world, and the hold ends.
    const farm = sim.locations.get("Meadow")!;
    farm.objects.splice(farm.objects.findIndex((o) => o.name === "Rockslide"), 1);
    board.set("walk through", [{ label: "cross", tool: "body_walk_to", args: { x: 11, y: 1 }, expect: { at: { x: 11, y: 1 } } }]);
    await until((facts) => facts.includes("cross: OK"), 25_000);
    expect(watch.isHolding()).toBe(false);
  });

  it("does not count interleaved different actions toward one wall", async () => {
    const sim = locked();
    const board0 = armed(sim);
    board0.set("mixed", [
      { tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { tool: "body_input", args: { steps: [{ press: ["ControllerA"], ms: 50 }] } },
      { tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { tool: "body_input", args: { steps: [{ press: ["ControllerA"], ms: 50 }] } },
      { tool: "body_walk_to", args: { x: 11, y: 4 }, expect: { at: { x: 11, y: 4 } } },
      { tool: "body_input", args: { steps: [{ press: ["ControllerA"], ms: 50 }] } },
    ]);
    const facts = await until((soFar) => soFar.split("Plan,").length > 6, 25_000);
    expect(watch.isHolding()).toBe(false);
    expect(watch.take()).toBeNull();
    expect(facts).not.toContain("STUCK");
  });
});

describe("the stuck detector on the wall scenario", () => {
  it("calls the third swing at the immune golem a wall even as the fight goes badly", async () => {
    const sim = walled();
    const board0 = armed(sim);
    board0.set("fight the golem", [
      { tool: "body_walk_to", args: { x: 5, y: 4, mode: "adjacent" } },
      { tool: "body_input", args: { steps: [{ press: ["ControllerX"], ms: 50 }] } },
      { tool: "body_input", args: { steps: [{ press: ["ControllerX"], ms: 50 }] } },
      { tool: "body_input", args: { steps: [{ press: ["ControllerX"], ms: 50 }] } },
    ]);
    await until((soFar) => soFar.split("Plan,").length > 4);
    const fact = watch.take();
    expect(fact).toContain("STUCK");
    expect(fact).toContain("input 1 step(s)");
  });

  it("a losing fight alone is not a change: vitals are not in the digest", async () => {
    const sim = walled();
    sims.push(sim);
    await sim.start(1);
    const before = stateDigest(sim.snapshot());
    sim.health = 41;
    sim.body.stamina = 12;
    expect(stateDigest(sim.snapshot())).toBe(before);
    // But the world answering — the golem giving ground — is one.
    sim.locations.get("Riverbank")!.characters[0]!.y = 3;
    expect(stateDigest(sim.snapshot())).not.toBe(before);
  });
});
