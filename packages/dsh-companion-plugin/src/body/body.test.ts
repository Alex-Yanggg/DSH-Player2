import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bodyDeclarationSchema, bodyStateSchema, bodyTaskSchema, bodyTaskStatusSchema, defaultPersonaKnobs, type BodyItem, type PersonaKnobs } from "@dsh-player2/contracts";
import { BodyFileClient } from "./client.js";
import { createGoalTools, GOAL_TOOL_NAMES, type GoalController } from "./goal-tools.js";
import { PersonaDice, probability, seededUniform, turnNudges } from "./knobs.js";
import { findPath, locationRoute, pathToSteps, Walkability } from "./navigation.js";
import { runMelee } from "./reflex.js";
import { SimAdapter, type SimLocation } from "./sim-adapter.js";
import { walkTo } from "./walk.js";

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
    { name: "Farm", rows: [...FARM], warps: [{ x: 19, y: 4, to: "Town", toX: 1, toY: 1, kind: "walk" }], objects: [{ x: 15, y: 6, kind: "forage", name: "Daffodil", id: "(O)18" }], characters: [] },
    { name: "Town", rows: [...TOWN], warps: [{ x: 0, y: 1, to: "Farm", toX: 18, toY: 4, kind: "walk" }], objects: [], characters: [] },
  ];
}

let dir: string;
let sim: SimAdapter;
let client: BodyFileClient;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dsh-body-"));
  sim = new SimAdapter(dir, { locations: world(), body: { location: "Farm", x: 2, y: 2, items: kit.map((i) => ({ ...i })) } });
  await sim.start(1);
  client = new BodyFileClient(dir, 5);
});

afterEach(async () => {
  await sim.stop();
  await rm(dir, { recursive: true, force: true });
});

function controller(overrides: Partial<GoalController> = {}): GoalController & { notes: string[]; finished: { status: string; summary: string } | undefined } {
  const notes: string[] = [];
  const self = {
    goalId: "00000000-0000-4000-8000-000000000001",
    body: client,
    dice: new PersonaDice(defaultPersonaKnobs, "seed"),
    signal: new AbortController().signal,
    cheatsAllowed: async () => false,
    note: async (text: string) => { notes.push(text); },
    finish: async (status: "done" | "failed", summary: string) => { self.finished = { status, summary }; },
    toolCallsLeft: () => 100,
    notes,
    finished: undefined as { status: string; summary: string } | undefined,
    ...overrides,
  };
  return self;
}

function tool(goal: GoalController, name: string) {
  const found = createGoalTools(goal).find((t) => t.name === name);
  if (!found) throw new Error(name);
  return found as unknown as { execute(args: Record<string, unknown>, exec?: unknown): Promise<string> };
}

describe("body protocol frames", () => {
  it("the sim writes frames the contracts accept", async () => {
    const declaration = bodyDeclarationSchema.parse(JSON.parse(await readFile(join(dir, "body", "declaration.json"), "utf8")));
    expect(declaration.inputs.some((i) => i.id === "NoClip" && i.cheat)).toBe(true);
    const state = bodyStateSchema.parse(JSON.parse(await readFile(join(dir, "body", "state.json"), "utf8")));
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

describe("goal tools", () => {
  it("tills, plants, waters and harvests a carrot", async () => {
    const goal = controller();
    const use = tool(goal, GOAL_TOOL_NAMES.use);
    expect(await use.execute({ button: "UseTool", x: 4, y: 7, slot: 1 })).toMatch(/Hoe/);
    expect(await use.execute({ button: "Action", x: 4, y: 7, slot: 3 })).toMatch(/planted/);
    expect(await use.execute({ button: "UseTool", x: 4, y: 7, slot: 2 })).toMatch(/Watering Can/);
    sim.growAll();
    const harvest = await use.execute({ button: "Action", x: 4, y: 7 });
    expect(harvest).toMatch(/harvested/);
    expect(sim.body.items.some((i) => i?.name === "Carrot")).toBe(true);
  });

  it("refuses cheat inputs while the switch is off and allows them on grant", async () => {
    const off = tool(controller(), GOAL_TOOL_NAMES.input);
    expect(await off.execute({ steps: [{ hold: ["MoveUp", "NoClip"], ms: 100 }] })).toMatch(/^Refused/);
    sim.cheatGrant = true;
    const on = tool(controller({ cheatsAllowed: async () => true }), GOAL_TOOL_NAMES.input);
    expect(await on.execute({ steps: [{ hold: ["MoveUp", "NoClip"], ms: 100 }] })).not.toMatch(/^Refused/);
  });

  it("finds forage and records notes and the finish", async () => {
    const goal = controller();
    expect(await tool(goal, GOAL_TOOL_NAMES.find).execute({ kind: "forage" })).toMatch(/Daffodil/);
    await tool(goal, GOAL_TOOL_NAMES.note).execute({ text: "planting carrots in the garden" });
    await tool(goal, GOAL_TOOL_NAMES.finish).execute({ status: "failed", summary: "out of seeds" });
    expect(goal.notes).toEqual(["planting carrots in the garden"]);
    expect(goal.finished).toEqual({ status: "failed", summary: "out of seeds" });
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

  it("logs every roll it makes for a turn", async () => {
    const log = join(dir, "dice.jsonl");
    const dice = new PersonaDice(defaultPersonaKnobs, "seed", log);
    const nudges = await turnNudges(dice, 1, true);
    expect(nudges.length).toBeGreaterThanOrEqual(3);
    const lines = (await readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.length).toBe(dice.history.length);
    expect(lines.some((l) => l.knob === "helpSeeking")).toBe(true);
  });

  it("skill maps to faster, steadier hands", () => {
    const clumsy = new PersonaDice({ ...defaultPersonaKnobs, skill: 0 }, "s").hands();
    const sharp = new PersonaDice({ ...defaultPersonaKnobs, skill: 1 }, "s").hands();
    expect(sharp.reactionMs).toBeLessThan(clumsy.reactionMs);
    expect(sharp.aimError).toBeLessThan(clumsy.aimError);
  });
});
