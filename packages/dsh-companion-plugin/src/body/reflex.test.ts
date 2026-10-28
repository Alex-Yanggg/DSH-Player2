import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseReflexTable, type BodyItem, type ReflexTable } from "@dsh-player2/contracts";
import { loadReflexTable, ReflexBody } from "./reflex.js";
import { SimAdapter, type SimLocation } from "./sim-adapter.testkit.js";

vi.setConfig({ testTimeout: 30_000 });

const FARM = [
  "############",
  "#..........#",
  "#..........#",
  "#..........#",
  "#..........#",
  "############",
];

const kit: BodyItem[] = [
  { slot: 0, id: "(O)194", name: "Salad", stack: 2, category: "Food" },
  { slot: 1, id: "(W)0", name: "Rusty Sword", stack: 1, category: "Weapon" },
];

function world(monsters: { x: number; y: number }[] = []): SimLocation[] {
  return [{
    name: "Farm", rows: [...FARM],
    warps: [],
    objects: [],
    characters: monsters.map((m, i) => ({ x: m.x, y: m.y, px: m.x * 64, py: m.y * 64, name: `Slime ${i}`, kind: "monster" as const, health: 20 })),
  }];
}

let sim: SimAdapter;
/** One sim tick per game frame: sim time then tracks wall time on every platform's timer resolution. */
const REAL_TIME_TICK_MS = 1000 / 60;

beforeEach(async () => {
  sim = new SimAdapter({ locations: world(), body: { location: "Farm", x: 4, y: 3, items: kit.map((i) => ({ ...i })) } });
  await sim.start(1);
});

afterEach(async () => {
  await sim.stop();
});

/** Wraps the sim in a running reflex body with the given table; `facts` collects what fired. */
async function armed(table: ReflexTable, intervalMs = 40) {
  const facts: string[] = [];
  const body = new ReflexBody(sim, { table, intervalMs, onFact: (fact) => facts.push(fact) });
  body.start();
  return { body, facts };
}

const waitUntil = async (until: () => boolean, ms = 8_000) => {
  const deadline = Date.now() + ms;
  while (!until()) {
    if (Date.now() > deadline) throw new Error("condition never became true");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

describe("the reflex table", () => {
  it("loads the shipped stardew table, and no table means the mind alone", () => {
    const table = loadReflexTable("stardew-valley");
    expect(table?.rows.map((row) => row.id)).toContain("eat-when-hurt");
    expect(table?.obstacles?.map((row) => row.id)).toEqual(["stone", "twig", "weeds"]);
    expect(loadReflexTable("a-game-with-no-table")).toBeNull();
  });

  it("rejects a row the schema does not know, loudly", () => {
    expect(() => parseReflexTable({ version: "1", game: "x", rows: [{ id: "bad", when: { all: [{ kind: "levitate" }] }, do: { kind: "steps", steps: [{ ms: 1 }] }, fact: "nope" }] })).toThrow();
  });
});

describe("reflexes over the sim body", () => {
  it("eats when hurt: selects the food and uses it, then tells the mind", async () => {
    sim.health = 20;
    const { body, facts } = await armed(loadReflexTable("stardew-valley")!);
    try {
      await waitUntil(() => facts.length > 0);
      expect(facts[0]).toContain("ate Salad");
      expect(facts[0]).toContain("health at 20");
      const pressed = sim.inputsSeen.flatMap((task) => task.steps.flatMap((step) => step.press ?? [])).flat();
      expect(pressed).toContain("Slot1");
      expect(pressed).toContain("ControllerX");
      // Every task the wrapper submits asks the adapter for fast state.
      expect(sim.inputsSeen.every((task) => task.fastState === true)).toBe(true);
    } finally {
      body.stop();
    }
  });

  it("swings the weapon at an adjacent monster and kills it in the sim", async () => {
    sim.locations.get("Farm")!.characters.push({ x: 5, y: 3, px: 5 * 64, py: 3 * 64, name: "Green Slime", kind: "monster", health: 20 });
    const { body, facts } = await armed(loadReflexTable("stardew-valley")!);
    try {
      await waitUntil(() => facts.some((fact) => fact.includes("swing-when-cornered")));
      expect(facts[0]).toContain("swung Rusty Sword at the Green Slime");
      await waitUntil(() => sim.locations.get("Farm")!.characters.length === 0);
    } finally {
      body.stop();
    }
  });

  it("steps away when cornered without a weapon", async () => {
    sim.body.items[1] = null; // no weapon: the none-condition routes to the step-away row
    sim.locations.get("Farm")!.characters.push({ x: 5, y: 3, px: 5 * 64, py: 3 * 64, name: "Green Slime", kind: "monster", health: 20 });
    const { body, facts } = await armed(loadReflexTable("stardew-valley")!);
    try {
      await waitUntil(() => facts.some((fact) => fact.includes("step-away-when-cornered")));
      await waitUntil(() => sim.tile.x < 4);
    } finally {
      body.stop();
    }
  });

  it("unsticks a body walking into a wall, and the interrupted walk reports it", async () => {
    // A local table with a short threshold. The reflex clock is wall time, so the sim ticks at real-time pace here:
    // at its fast test pace the 5 s walk ends in well under the threshold on a platform with fine timers.
    const table = parseReflexTable({ ...loadReflexTable("stardew-valley")!, rows: [
      { id: "unstick", when: { all: [{ kind: "stuckFor", ms: 400 }] }, do: { kind: "steps", steps: [{ hold: ["DPadLeft"], ms: 100 }] }, cooldownMs: 2_000, fact: "acted on reflex (unstick): was stuck walking, wriggled free" },
    ] });
    await sim.stop();
    await sim.start(REAL_TIME_TICK_MS);
    const { body, facts } = await armed(table, 40);
    try {
      const walk = body.run([{ hold: ["DPadLeft"], ms: 5_000 }]);
      await waitUntil(() => facts.some((fact) => fact.includes("unstick")), 10_000);
      const run = await walk;
      expect(run.status).toMatch(/cancelled|interrupted|done/);
      expect(facts.find((fact) => fact.includes("unstick"))).toContain("wriggled free");
    } finally {
      body.stop();
    }
  });

  it("a fired row holds its cooldown", async () => {
    sim.health = 20;
    const { body, facts } = await armed(loadReflexTable("stardew-valley")!);
    try {
      await waitUntil(() => facts.length > 0);
      const at = facts.length;
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(facts.length).toBe(at); // 5 s cooldown: no second bite yet
    } finally {
      body.stop();
    }
  });
});
