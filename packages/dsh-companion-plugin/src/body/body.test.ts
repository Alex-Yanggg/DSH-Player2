import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyDeclarationSchema, bodyStateSchema, bodyTaskSchema, bodyTaskStatusSchema, defaultPersonaKnobs, type BodyItem, type PersonaKnobs } from "@dsh-player2/contracts";
import { BODY_TOOL_NAMES, createBodyTools } from "./tools.js";
import { PersonaDice, probability, seededUniform, turnNudges } from "./knobs.js";
import { findPath, locationRoute, pathToSteps, Walkability } from "./navigation.js";
import { runMelee } from "./reflex.js";
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
  const found = createBodyTools({ body: client, dice: new PersonaDice(defaultPersonaKnobs, "seed") }).find((t) => t.name === name);
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

describe("navigation", () => {
  it("routes around walls and turns a path into exact holds", async () => {
    const state = await client.state();
    const walk = new Walkability(state);
    const path = findPath(walk, { x: 2, y: 2 }, [{ x: 7, y: 5 }]);
    expect(path?.at(-1)).toEqual({ x: 7, y: 5 });
    expect(path!.every((t) => walk.walkableFrom({ x: 2, y: 2 }, t.x, t.y))).toBe(true);
    const steps = pathToSteps(path!, (await client.declaration()).limits);
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
    const run = await client.run([{ hold: ["MoveRight"], ms: 200 }], { timeoutMs: 800 });
    expect(run.status).toBe("done");
    expect(run.totalMs).toBeGreaterThan(1_500);
  });
});

describe("walk helper over raw input", () => {
  it("walks into the walled garden", async () => {
    const result = await walkTo(client, (await client.declaration()).limits, () => client.world(), { x: 7, y: 5, mode: "stand" });
    expect(result.ok, result.reason).toBe(true);
    expect(sim.tile).toEqual({ x: 7, y: 5 });
    // Only raw buttons ever reached the adapter.
    const ids = new Set(sim.inputsSeen.flatMap((t) => t.steps.flatMap((s) => [...(s.hold ?? []), ...(s.press ?? [])])));
    for (const id of ids) expect(id).toMatch(/^(Move|Face)(Up|Right|Down|Left)$/);
  });

  it("crosses into another location through a walk warp", async () => {
    const result = await walkTo(client, (await client.declaration()).limits, () => client.world(), { location: "Town", x: 5, y: 2, mode: "stand" });
    expect(result.ok, result.reason).toBe(true);
    expect(sim.body.location).toBe("Town");
  });

  it("fails honestly for an unreachable tile", async () => {
    const result = await walkTo(client, (await client.declaration()).limits, () => client.world(), { x: 0, y: 0, mode: "stand" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no walkable path/);
  });
});

describe("body tools", () => {
  it("tills, plants, waters and harvests a carrot", async () => {
    const use = tool(BODY_TOOL_NAMES.use);
    expect(await use.execute({ button: "UseTool", x: 4, y: 7, slot: 1 })).toMatch(/Hoe/);
    expect(await use.execute({ button: "Action", x: 4, y: 7, slot: 3 })).toMatch(/planted/);
    expect(await use.execute({ button: "UseTool", x: 4, y: 7, slot: 2 })).toMatch(/Watering Can/);
    sim.growAll();
    const harvest = await use.execute({ button: "Action", x: 4, y: 7 });
    expect(harvest).toMatch(/harvested/);
    expect(sim.body.items.some((i) => i?.name === "Carrot")).toBe(true);
  });

  it("the game refuses cheat inputs while the switch is off and allows them on grant", async () => {
    const input = tool(BODY_TOOL_NAMES.input);
    expect(await input.execute({ steps: [{ hold: ["MoveUp", "NoClip"], ms: 100 }] })).toMatch(/cheat-off/);
    await sim.grantCheats(true);
    expect(await input.execute({ steps: [{ hold: ["MoveUp", "NoClip"], ms: 100 }] })).not.toMatch(/cheat-off/);
  });

  it("finds forage", async () => {
    expect(await tool(BODY_TOOL_NAMES.find).execute({ kind: "forage" })).toMatch(/Daffodil/);
  });
});

describe("shop counter", () => {
  it("opens with Action, shows the stock, and buys with raw menu buttons from the player's wallet", async () => {
    const opened = await tool(BODY_TOOL_NAMES.use).execute({ button: "Action", x: 17, y: 1 });
    expect(opened).toMatch(/menu-opened/);
    const look = await tool(BODY_TOOL_NAMES.observe).execute({});
    expect(look).toMatch(/#0 Parsnip Seeds 20g/);
    expect(look).toMatch(/Potato Seeds 50g \(1 left\)/);
    const input = tool(BODY_TOOL_NAMES.input);
    await input.execute({ steps: [{ press: ["MenuConfirm"], ms: 0 }, { press: ["MenuConfirm"], ms: 0 }] });
    expect(sim.body.items.find((i) => i?.name === "Parsnip Seeds")?.stack).toBe(2);
    expect(sim.player.money).toBe(460);
    const sold = await input.execute({ steps: [{ press: ["MenuDown"], ms: 0 }, { press: ["MenuConfirm"], ms: 0 }, { press: ["MenuConfirm"], ms: 0 }, { press: ["MenuClose"], ms: 0 }] });
    expect(sold).toMatch(/sold-out/);
    expect(sim.body.items.find((i) => i?.name === "Potato Seeds")?.stack).toBe(1);
  });

  it("reports when the wallet is short", async () => {
    sim.player.money = 10;
    await tool(BODY_TOOL_NAMES.use).execute({ button: "Action", x: 17, y: 1 });
    const result = await tool(BODY_TOOL_NAMES.input).execute({ steps: [{ press: ["MenuConfirm"], ms: 0 }] });
    expect(result).toMatch(/cant-afford/);
  });
});

describe("reflex melee", () => {
  it("clears nearby monsters and reports latency", async () => {
    sim.locations.get("Farm")!.characters.push(
      { name: "Green Slime", kind: "monster", x: 6, y: 2, px: 6 * 64, py: 2 * 64, health: 20 },
      { name: "Green Slime", kind: "monster", x: 2, y: 5, px: 2 * 64, py: 5 * 64, health: 20 },
    );
    const report = await runMelee(client, (await client.declaration()).limits, { seconds: 8, chaseTiles: 8, targetKills: 0 }, { reactionMs: 0, aimError: 0 }, "s");
    expect(report.endedBy, JSON.stringify({ ...report, tile: sim.tile, facing: sim.body.facing, chars: sim.locations.get("Farm")!.characters })).toBe("clear");
    expect(report.monstersGone).toBe(2);
    expect(report.acceptMs.p95).toBeGreaterThanOrEqual(report.acceptMs.p50);
  }, 15_000);
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

  it("skill maps to faster, steadier hands", () => {
    const clumsy = new PersonaDice({ ...defaultPersonaKnobs, skill: 0 }, "s").hands();
    const sharp = new PersonaDice({ ...defaultPersonaKnobs, skill: 1 }, "s").hands();
    expect(sharp.reactionMs).toBeLessThan(clumsy.reactionMs);
    expect(sharp.aimError).toBeLessThan(clumsy.aimError);
  });
});
