import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyCharacter, BodyItem, BodyObject } from "@dsh-player2/contracts";
import { SimAdapter, type SimLocation, type SimTaskState } from "./sim-adapter.js";
import { stateDigest, StuckWatch } from "./stuck.js";
import { createBodyTools } from "./tools.js";

vi.setConfig({ testTimeout: 30_000 });

/**
 * The stuck detector over the bench scenarios (P2-0020 T2; the scenarios are
 * ported from research/self-improve/bench/lib/locked.ts and wall.ts): three
 * identical actions on an unchanged world are a wall, and the fact tells the
 * mind to step back. The mind's own reflection is model work; these tests pin
 * the detector, the digest and the release.
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

/** The locked scenario: the north pass holds one Rockslide until the crew clears it on day 5. */
class LockedSim extends SimAdapter {
  public clearPass(): void {
    const location = this.locations.get("Meadow")!;
    const rocks = location.objects.find((o) => o.name === "Rockslide");
    if (rocks !== undefined) location.objects.splice(location.objects.indexOf(rocks), 1);
  }
}

/** The wall scenario: the bridge golem is immune to the starter weapon and never moves. */
class WallSim extends SimAdapter {
  protected override press(id: string, task: SimTaskState): void {
    const faced = this.faced();
    const golem = this.location().characters.find((c) => c.kind === "monster" && c.x === faced.x && c.y === faced.y);
    if ((id === "ControllerX" || id === "ControllerA") && golem !== undefined) {
      task.status = "interrupted";
      task.reason = id === "ControllerX" ? "golem-counterattack" : "blocked-by-golem";
      this.note(task, "used", "Rusty Sword swing — the Clay Golem shrugs it off (immune to starter weapons) and its counterattack hurts");
      return;
    }
    super.press(id, task);
  }
}

function locked(): LockedSim {
  const objects: BodyObject[] = [
    { x: 11, y: 1, kind: "chest", name: "Old Shrine Chest", extra: { passable: true } },
    { x: 11, y: 4, kind: "rock", name: "Rockslide", extra: { passable: false } },
    { x: 3, y: 7, kind: "notice", name: "Notice Board", extra: { passable: false } },
  ];
  return new LockedSim({ locations: [{ name: "Meadow", rows: [...LOCKED_ROWS], warps: [], objects, characters: [] } as SimLocation], body: { location: "Meadow", x: 2, y: 7, items: KIT.map((i) => ({ ...i })) } });
}

function walled(): WallSim {
  const golem: BodyCharacter = { x: 5, y: 4, px: 5 * 64, py: 4 * 64, name: "Clay Golem", kind: "monster", health: 999 };
  return new WallSim({ locations: [{ name: "Riverbank", rows: [...WALL_ROWS], warps: [], objects: [
    { x: 11, y: 1, kind: "bell", name: "Shrine Bell", extra: { passable: true } },
    { x: 5, y: 7, kind: "gate", name: "Great Gate", extra: { passable: false } },
    { x: 1, y: 1, kind: "lever", name: "Shrine Lever", extra: { passable: false } },
  ], characters: [golem] } as SimLocation], body: { location: "Riverbank", x: 2, y: 7, items: KIT.map((i) => ({ ...i })) } });
}

let watch: StuckWatch | undefined;
const sims: SimAdapter[] = [];

function tool(name: string): (args: Record<string, unknown>) => Promise<string> {
  const found = createBodyTools({ body: sims[sims.length - 1], watch }).find((t) => t.name === name)!;
  const run = found as unknown as { execute(args: Record<string, unknown>, exec: unknown): Promise<string> };
  return (args) => run.execute(args, { callId: "call-1", signal: new AbortController().signal });
}

afterEach(async () => {
  await Promise.all(sims.splice(0).map((s) => s.stop()));
  watch = undefined;
});

async function armed(sim: SimAdapter): Promise<void> {
  watch = new StuckWatch();
  sims.push(sim);
  await sim.start(1);
}

describe("the stuck detector on the locked scenario", () => {
  it("calls the third identical blocked walk a wall, and releases when the pass opens", async () => {
    const sim = locked();
    await armed(sim);
    const walk = tool("body_walk_to");
    for (let attempt = 0; attempt < 2; attempt++) expect(await walk({ x: 11, y: 4 })).toMatch(/^NOT REACHED/);
    expect(watch!.isHolding()).toBe(false);
    expect(watch!.take()).toBeNull();
    expect(await walk({ x: 11, y: 4 })).toMatch(/^NOT REACHED/);
    expect(watch!.isHolding()).toBe(true);
    const fact = watch!.take();
    expect(fact).toContain("STUCK");
    expect(fact).toContain("11,4");
    expect(fact).toContain("lesson_learn");
    expect(watch!.take()).toBeNull(); // told once
    // The crew clears the rock (day 5): the same walk now moves the world, and the hold ends.
    sim.clearPass();
    expect(await walk({ x: 11, y: 1 })).toMatch(/^OK/);
    expect(watch!.isHolding()).toBe(false);
  });

  it("does not count interleaved different actions toward one wall", async () => {
    await armed(locked());
    const walk = tool("body_walk_to");
    const input = tool("body_input");
    for (let round = 0; round < 3; round++) {
      expect(await walk({ x: 11, y: 4 })).toMatch(/^NOT REACHED/);
      expect(await input({ steps: [{ press: ["ControllerA"], ms: 50 }] })).toContain("Input done");
    }
    expect(watch!.isHolding()).toBe(false);
  });
});

describe("the stuck detector on the wall scenario", () => {
  it("calls the third swing at the immune golem a wall even as the fight goes badly", async () => {
    await armed(walled());
    const walk = tool("body_walk_to");
    const input = tool("body_input");
    expect(await walk({ x: 5, y: 4, mode: "adjacent" })).toMatch(/^OK/); // next to the golem, facing it
    for (let attempt = 0; attempt < 2; attempt++) expect(await input({ steps: [{ press: ["ControllerX"], ms: 50 }] })).toContain("golem-counterattack");
    expect(watch!.take()).toBeNull();
    expect(await input({ steps: [{ press: ["ControllerX"], ms: 50 }] })).toContain("golem-counterattack");
    const fact = watch!.take();
    expect(fact).toContain("STUCK");
    expect(fact).toContain("body_input");
  });

  it("a losing fight alone is not a change: vitals are not in the digest", async () => {
    const sim = walled();
    await armed(sim);
    const before = stateDigest(sim.snapshot());
    sim.health = 41;
    sim.body.stamina = 12;
    expect(stateDigest(sim.snapshot())).toBe(before);
    // But the world answering — the golem giving ground — is one.
    sim.locations.get("Riverbank")!.characters[0]!.y = 3;
    expect(stateDigest(sim.snapshot())).not.toBe(before);
  });
});
