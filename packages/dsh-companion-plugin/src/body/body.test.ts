import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyDeclarationSchema, bodyStateSchema, bodyTaskSchema, bodyTaskStatusSchema, defaultPersonaKnobs, type BodyItem, type PersonaKnobs } from "@dsh-player2/contracts";
import { BODY_TOOL_NAMES, createBodyTools } from "./tools.js";
import { PersonaDice, probability, seededUniform, turnNudges } from "./knobs.js";
import { controlsOf, findPath, locationRoute, pathToSteps, Walkability } from "./navigation.js";
import { SimAdapter, type SimLocation } from "./sim-adapter.js";
import { walkTo } from "./walk.js";

// The sim plays body tasks at a real tick pace; under a full parallel run a
// round of walks can pass the default 5 s without anything being wrong.
vi.setConfig({ testTimeout: 30_000 });

const FARM = [
  "####################",
  "#..................#",
  "#..................#",
  "#....######........#",
  "#....#....#........W",
  "#....#....#........#",
  "#.........#........#",
  "#..................#",
  "####################",
];
const TOWN = [
  "##########",
  "W........#",
  "#........#",
  "##########",
];

const kit: BodyItem[] = [
  { slot: 0, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" },
  { slot: 1, id: "(T)WateringCan", name: "Watering Can", stack: 1, category: "Tool" },
  { slot: 2, id: "(O)474", name: "Carrot Seeds", stack: 3, category: "Seed" },
  { slot: 3, id: "(W)0", name: "Rusty Sword", stack: 1, category: "Weapon" },
];

function world(): SimLocation[] {
  return [
    { name: "Farm", rows: [...FARM], warps: [{ x: 19, y: 4, to: "Town", toX: 1, toY: 1, kind: "walk" }], objects: [{ x: 15, y: 6, kind: "forage", name: "Daffodil", id: "(O)18" }, { x: 17, y: 1, kind: "counter", name: "Counter", extra: { shopId: "SeedShop", passable: false } }], characters: [] },
    { name: "Town", rows: [...TOWN], warps: [{ x: 0, y: 1, to: "Farm", toX: 18, toY: 4, kind: "walk" }], objects: [], characters: [] },
  ];
}

let sim: SimAdapter;
let client: SimAdapter;

beforeEach(async () => {
  sim = new SimAdapter({
    locations: world(), body: { location: "Farm", x: 2, y: 2, items: kit.map((i) => ({ ...i })) },
    shops: { SeedShop: [
      { id: "(O)472", name: "Parsnip Seeds", category: "Seed", price: 20, stock: null },
      { id: "(O)475", name: "Potato Seeds", category: "Seed", price: 50, stock: 1 },
    ] },
  });
  await sim.start(1);
  client = sim;
});

afterEach(async () => {
  await sim.stop();
});

const exec = { callId: "call-1", signal: new AbortController().signal };

function tool(name: string) {
  const found = createBodyTools(client).find((t) => t.name === name);
  if (!found) throw new Error(name);
  const run = found as unknown as { execute(args: Record<string, unknown>, exec: unknown): Promise<string> };
  return { execute: (args: Record<string, unknown>) => run.execute(args, exec) };
}

describe("body protocol frames", () => {
  it("the sim serves frames the contracts accept", async () => {
    const declaration = bodyDeclarationSchema.parse(await sim.declaration());
    expect(declaration.inputs.some((i) => i.id === "NoClip" && i.cheat)).toBe(true);
    const state = bodyStateSchema.parse(await sim.state());
    expect(state.body?.location).toBe("Farm");
  });

  it("parses the shared golden fixture", async () => {
    const golden = JSON.parse(await readFile(new URL("../../../../fixtures/body/stardew-body-frames.json", import.meta.url), "utf8"));
    expect(bodyDeclarationSchema.safeParse(golden.declaration).success).toBe(true);
    expect(bodyStateSchema.safeParse(golden.state).success).toBe(true);
    expect(bodyTaskSchema.safeParse(golden.task).success).toBe(true);
    expect(bodyTaskStatusSchema.shape.status.safeParse(golden.status.status).success).toBe(true);
    expect(golden.status.seq).toBe(golden.task.seq);
  });
});

describe("observation", () => {
  it("says when the player is somewhere else", async () => {
    expect(await tool("world_observe").execute({})).not.toContain("a different place from you");
    sim.player.location = "Town";
    expect(await tool("world_observe").execute({})).toContain("Player Tester: Town, a different place from you");
  });

  it("shows the tiles the game answers, raw, nearest first", async () => {
    sim.locations.get("Farm")!.warps.push({ x: 18, y: 4, to: "Mine", toX: 18, toY: 13, kind: "walk" });
    sim.actionTiles = [
      { x: 23, y: 9, layer: "Buildings", action: "Mine" },
      { x: 17, y: 3, layer: "Buildings", action: "MineElevator" },
    ];
    const look = await tool("world_observe").execute({});
    expect(look).toContain("Tiles the game itself answers, raw: (17,3) 'MineElevator'; (23,9) 'Mine'");
  });
});

describe("navigation", () => {
  it("routes around walls and turns a path into exact holds", async () => {
    const state = await client.state();
    const walk = new Walkability(state);
    const path = findPath(walk, { x: 2, y: 2 }, [{ x: 7, y: 5 }]);
    expect(path?.at(-1)).toEqual({ x: 7, y: 5 });
    expect(path!.every((t) => walk.walkableFrom({ x: 2, y: 2 }, t.x, t.y))).toBe(true);
    const steps = pathToSteps(path!, controlsOf(await client.declaration()));
    expect(steps.every((s) => s.hold?.length === 1)).toBe(true);
  });

  it("finds a location route over the warp graph", async () => {
    const route = locationRoute(await client.world(), "Farm", "Town");
    expect(route?.[0]?.warp.to).toBe("Town");
    expect(locationRoute(await client.world(), "Town", "Mine")).toBeUndefined();
  });
});

describe("pause", () => {
  it("holds a task through a paused world instead of timing it out", async () => {
    sim.paused = true;
    setTimeout(() => { sim.paused = false; }, 2_000);
    const run = await client.run([{ hold: ["DPadRight"], ms: 200 }], { timeoutMs: 800 });
    expect(run.status).toBe("done");
    expect(run.totalMs).toBeGreaterThan(1_500);
  });
});

describe("walk helper over raw input", () => {
  it("walks into the walled garden", async () => {
    const result = await walkTo(client, controlsOf(await client.declaration()), () => client.world(), { x: 7, y: 5, mode: "stand" });
    expect(result.ok, result.reason).toBe(true);
    expect(sim.tile).toEqual({ x: 7, y: 5 });
    // Only raw buttons ever reached the adapter.
    const ids = new Set(sim.inputsSeen.flatMap((t) => t.steps.flatMap((s) => [...(s.hold ?? []), ...(s.press ?? [])])));
    for (const id of ids) expect(id).toMatch(/^DPad(Up|Right|Down|Left)$/);
  });

  it("crosses into another location through a walk warp", async () => {
    const result = await walkTo(client, controlsOf(await client.declaration()), () => client.world(), { location: "Town", x: 5, y: 2, mode: "stand" });
    expect(result.ok, result.reason).toBe(true);
    expect(sim.body.location).toBe("Town");
  });

  it("fails honestly for an unreachable tile", async () => {
    const result = await walkTo(client, controlsOf(await client.declaration()), () => client.world(), { x: 0, y: 0, mode: "stand" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no walkable path/);
  });

  it("names the objects in the way when only they block the path", async () => {
    // The game's grid marks an object's tile blocked as well.
    const farm = sim.locations.get("Farm")!;
    farm.rows[6] = "#.....#####........#";
    farm.objects.push(...[6, 8, 9].map((x) => ({ x, y: 6, kind: "object", name: "Stone", extra: { passable: false } })));
    farm.objects.push({ x: 7, y: 6, kind: "clump", name: "Large Stump", extra: { passable: false } });
    const result = await walkTo(client, controlsOf(await client.declaration()), () => client.world(), { x: 7, y: 5, mode: "stand" });
    expect(result.ok).toBe(false);
    // The shortest way runs through the stump; a way around it is named first.
    expect(result.reason).toMatch(/in the way: Stone at \((6|8),6\)$/);
  });
});

/** Walks next to a tile, selects a toolbar slot (0-based) and presses one button — the work a plan step plays. */
async function act(x: number, y: number, button: string, slot?: number): Promise<string[]> {
  const walked = await walkTo(client, controlsOf(await client.declaration()), () => client.world(), { x, y, mode: "adjacent" });
  expect(walked.ok, walked.reason).toBe(true);
  const cycle = slot === undefined ? [] : [{ press: [`Slot${slot + 1}`], ms: 0 }];
  const run = await client.run([...cycle, { press: [button], ms: 0 }]);
  return run.events.map((e) => `${e.kind}: ${e.detail}`);
}

describe("the game answers the body's buttons", () => {
  it("tills, plants, waters and harvests a carrot", async () => {
    expect((await act(4, 7, "ControllerX", 0)).join(" ")).toContain("Hoe");
    expect((await act(4, 7, "ControllerA", 2)).join(" ")).toContain("planted");
    expect((await act(4, 7, "ControllerX", 1)).join(" ")).toContain("Watering Can");
    sim.growAll();
    expect((await act(4, 7, "ControllerA")).join(" ")).toContain("harvested");
    expect(sim.body.items.some((i) => i?.name === "Carrot")).toBe(true);
  });

  it("the game refuses cheat inputs while the switch is off and allows them on grant", async () => {
    const refused = await client.run([{ hold: ["DPadUp", "NoClip"], ms: 100 }]);
    expect(refused.reason).toMatch(/cheat-off/);
    await sim.grantCheats(true);
    const allowed = await client.run([{ hold: ["DPadUp", "NoClip"], ms: 100 }]);
    expect(allowed.status).toBe("done");
  });

  it("lists the controller", async () => {
    expect(await tool(BODY_TOOL_NAMES.controls).execute({})).toMatch(/ControllerA \(press\)/);
  });

  it("finds forage", async () => {
    expect(await tool(BODY_TOOL_NAMES.find).execute({ kind: "forage" })).toMatch(/Daffodil/);
  });
});

describe("shop counter", () => {
  it("opens with the action button, shows the stock, and buys with the same buttons", async () => {
    expect((await act(17, 1, "ControllerA")).join(" ")).toContain("menu-opened");
    const look = await tool(BODY_TOOL_NAMES.observe).execute({});
    expect(look).toMatch(/#0 Parsnip Seeds 20g/);
    expect(look).toMatch(/Potato Seeds 50g \(1 left\)/);
    await client.run([{ press: ["ControllerA"], ms: 0 }, { press: ["ControllerA"], ms: 0 }]);
    expect(sim.body.items.find((i) => i?.name === "Parsnip Seeds")?.stack).toBe(2);
    expect(sim.player.money).toBe(460);
    const sold = await client.run([{ hold: ["DPadDown"], ms: 17 }, { press: ["ControllerA"], ms: 0 }, { press: ["ControllerA"], ms: 0 }, { press: ["ControllerB"], ms: 0 }]);
    expect(sold.events.map((e) => e.kind)).toContain("sold-out");
    expect(sim.body.items.find((i) => i?.name === "Potato Seeds")?.stack).toBe(1);
  });

  it("reports when the wallet is short", async () => {
    sim.player.money = 10;
    await act(17, 1, "ControllerA");
    const run = await client.run([{ press: ["ControllerA"], ms: 0 }]);
    expect(run.events.map((e) => e.kind)).toContain("cant-afford");
  });
});

describe("persona dice", () => {
  it("is deterministic for a seed", () => {
    expect(seededUniform("a", 3, "x")).toBe(seededUniform("a", 3, "x"));
    expect(seededUniform("a", 3, "x")).not.toBe(seededUniform("b", 3, "x"));
  });

  it("knob value changes how often the die says yes", async () => {
    const rate = async (talkativeness: number) => {
      const knobs: PersonaKnobs = { ...defaultPersonaKnobs, talkativeness };
      const dice = new PersonaDice(knobs, "fixed-seed");
      let yes = 0;
      for (let turn = 0; turn < 400; turn++) if ((await dice.roll(turn, "talkativeness", "speak-up")).yes) yes++;
      return yes / 400;
    };
    const quiet = await rate(0.1);
    const chatty = await rate(0.9);
    expect(Math.abs(quiet - probability(0.1))).toBeLessThan(0.07);
    expect(Math.abs(chatty - probability(0.9))).toBeLessThan(0.07);
    expect(chatty).toBeGreaterThan(quiet + 0.5);
  });

  it("asks the help question only when stuck", async () => {
    const dice = new PersonaDice(defaultPersonaKnobs, "seed");
    expect((await turnNudges(dice, 1, true)).length).toBe((await turnNudges(dice, 1, false)).length + 1);
  });
});
