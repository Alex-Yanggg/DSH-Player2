import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPersonaKnobs, type BodyItem } from "@dsh-player2/contracts";
import { createGoalTools, GOAL_TOOL_NAMES, SimAdapter, type GoalController } from "@dsh-player2/dsh-companion-plugin";
import { GoalLane, goalExtrasOf, type GoalTurnRunner } from "./goal.js";

const FARM = [
  "##########",
  "#........#",
  "#........#",
  "#........#",
  "##########",
];
const kit: BodyItem[] = [
  { slot: 0, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" },
  { slot: 1, id: "(T)WateringCan", name: "Watering Can", stack: 1, category: "Tool" },
  { slot: 2, id: "(O)474", name: "Carrot Seeds", stack: 1, category: "Seed" },
];

let session: string;
let sim: SimAdapter;
let traces: { code: string; detail: Record<string, unknown> }[];

beforeEach(async () => {
  session = await mkdtemp(join(tmpdir(), "dsh-goal-"));
  sim = new SimAdapter(session, { locations: [{ name: "Farm", rows: [...FARM], warps: [], objects: [], characters: [] }], body: { location: "Farm", x: 2, y: 2, items: kit.map((i) => ({ ...i })) } });
  await sim.start(1);
  traces = [];
});

afterEach(async () => {
  await sim.stop();
  await rm(session, { recursive: true, force: true });
});

type Tools = ReturnType<typeof createGoalTools>;
const call = (tools: Tools, name: string, args: Record<string, unknown>) =>
  (tools.find((t) => t.name === name) as unknown as { execute(a: unknown): Promise<string> }).execute(args);

/** A scripted "model": each turn runs the next script step with the real goal tools. */
function scripted(steps: ((tools: Tools, controller: GoalController) => Promise<void>)[], prompts: string[] = [], cancel = vi.fn()) {
  return async ({ controller }: { controller: GoalController }): Promise<GoalTurnRunner> => {
    const tools = createGoalTools(controller);
    let index = 0;
    return {
      turn: async (prompt) => {
        prompts.push(prompt);
        const step = steps[Math.min(index++, steps.length - 1)];
        await step(tools, controller);
      },
      cancel,
      dispose: async () => undefined,
    };
  };
}

const trace = async (code: string, detail: Record<string, unknown>) => { traces.push({ code, detail }); };

async function settle(lane: GoalLane, statuses: string[]): Promise<void> {
  await vi.waitFor(() => expect(statuses).toContain(lane.current()?.status), { timeout: 10_000, interval: 20 });
}

describe("goal extras from the social reply", () => {
  it("accepts set/stop and cheat ops and drops malformed ones", () => {
    expect(goalExtrasOf({ goal: { op: "set", text: "给我弄 3 根胡萝卜" } }).goal).toEqual({ op: "set", text: "给我弄 3 根胡萝卜" });
    expect(goalExtrasOf({ goal: { op: "stop" }, cheat: { op: "grant", quote: "开挂吧" } })).toMatchObject({ goal: { op: "stop" }, cheat: { op: "grant" } });
    expect(goalExtrasOf({ goal: { op: "launch" }, cheat: { op: "grant" } }).dropped).toEqual(["goal", "cheat"]);
    expect(goalExtrasOf({ kind: "reply" })).toEqual({ goal: null, cheat: null, dropped: [] });
  });
});

describe("goal lane", () => {
  it("runs a carrot goal to done on its own and logs its dice", async () => {
    const prompts: string[] = [];
    const lane = new GoalLane(session, {
      trace, idleMs: 20,
      createRunner: scripted([
        async (tools) => {
          await call(tools, GOAL_TOOL_NAMES.observe, {});
          await call(tools, GOAL_TOOL_NAMES.note, { text: "plant the seed by the door" });
          await call(tools, GOAL_TOOL_NAMES.use, { button: "UseTool", x: 4, y: 2, slot: 1 });
          await call(tools, GOAL_TOOL_NAMES.use, { button: "Action", x: 4, y: 2, slot: 3 });
          await call(tools, GOAL_TOOL_NAMES.use, { button: "UseTool", x: 4, y: 2, slot: 2 });
          sim.growAll();
        },
        async (tools) => {
          const harvest = await call(tools, GOAL_TOOL_NAMES.use, { button: "Action", x: 4, y: 2 });
          expect(harvest).toMatch(/harvested/);
          await call(tools, GOAL_TOOL_NAMES.finish, { status: "done", summary: "Planted a seed by the door and pulled up a carrot." });
        },
      ], prompts),
    });
    await lane.apply({ op: "set", text: "给我弄 1 根胡萝卜" }, defaultPersonaKnobs);
    await settle(lane, ["done"]);
    const record = lane.current()!;
    expect(record.turns).toBe(2);
    expect(record.notes).toEqual(["plant the seed by the door"]);
    expect(record.toolCalls).toBe(0); // counted by the companion plugin's hook in a real lane
    expect(prompts[0]).toMatch(/GOAL_TURN 1/);
    expect(prompts[0]).toContain("给我弄 1 根胡萝卜");
    expect(prompts[0]).toMatch(/Talkativeness 0.50/);
    await vi.waitFor(async () => expect(JSON.parse(await readFile(join(session, "goal", "current.json"), "utf8")).status).toBe("done"), { timeout: 10_000 });
    const dice = (await readFile(join(session, "goal", "dice.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(dice.length).toBeGreaterThanOrEqual(4);
    expect(dice.every((d) => d.seed === record.seed)).toBe(true);
    // The companion's own closing words go to the game.
    const speech = await readdir(join(session, "speech"));
    expect(speech.some((n) => n.startsWith("say-"))).toBe(true);
    expect(lane.statusNote()).toMatch(/"status":"done"/);
    await lane.close();
  });

  it("stops at the player's stay command and cancels the body", async () => {
    const cancel = vi.fn();
    const lane = new GoalLane(session, {
      trace, idleMs: 20,
      createRunner: scripted([async (tools) => { await call(tools, GOAL_TOOL_NAMES.input, { steps: [{ hold: ["MoveRight"], ms: 400 }] }); }], [], cancel),
    });
    await lane.apply({ op: "set", text: "walk around" }, defaultPersonaKnobs);
    await vi.waitFor(() => expect(lane.current()!.turns).toBeGreaterThan(0), { timeout: 10_000 });
    await mkdir(join(session, "goal"), { recursive: true });
    await writeFile(join(session, "goal", `interrupt-${Date.now()}.json`), JSON.stringify({ version: "0.1", at: new Date(Date.now() + 1).toISOString(), command: "stay" }));
    await lane.pollInterrupts();
    expect(lane.current()!.status).toBe("stopped");
    expect(lane.current()!.endReason).toContain("stay");
    expect(cancel).toHaveBeenCalled();
    expect(traces.some((t) => t.code === "DSH_GOAL_STOPPED")).toBe(true);
  });

  it("gives the companion one honest last turn when the budget runs out", async () => {
    const prompts: string[] = [];
    const lane = new GoalLane(session, {
      trace, idleMs: 20, budget: { maxTurns: 2, maxToolCalls: 600, maxGameDays: 7 },
      createRunner: scripted([async () => undefined], prompts),
    });
    await lane.apply({ op: "set", text: "catch a legend fish" }, defaultPersonaKnobs);
    await settle(lane, ["budget-exceeded"]);
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toMatch(/GOAL_BUDGET_SPENT/);
    expect(lane.current()!.endReason).toMatch(/2 turns/);
  });

  it("replaces a running goal with a new one", async () => {
    const lane = new GoalLane(session, { trace, idleMs: 20, createRunner: scripted([async () => new Promise((r) => setTimeout(r, 30))]) });
    const first = await lane.apply({ op: "set", text: "first" }, defaultPersonaKnobs);
    const second = await lane.apply({ op: "set", text: "second" }, defaultPersonaKnobs);
    expect(second!.goalId).not.toBe(first!.goalId);
    expect(lane.current()!.text).toBe("second");
    expect(traces.find((t) => t.code === "DSH_GOAL_STOPPED")?.detail.reason).toBe("replaced by a new goal");
    await lane.close();
  });

  it("turns cheats on only through a spoken grant for this save", async () => {
    let controller: GoalController | undefined;
    const lane = new GoalLane(session, { trace, idleMs: 20, createRunner: async (input) => { controller = input.controller; return { turn: async () => new Promise((r) => setTimeout(r, 20)), cancel: () => undefined, dispose: async () => undefined }; } });
    await lane.apply({ op: "set", text: "go" }, defaultPersonaKnobs);
    await vi.waitFor(() => expect(controller).toBeDefined(), { timeout: 10_000 });
    expect(await controller!.cheatsAllowed()).toBe(false);
    await lane.applyCheat({ op: "grant", quote: "随便开挂" });
    expect(await controller!.cheatsAllowed()).toBe(true);
    await lane.applyCheat({ op: "revoke", quote: "还是别开了" });
    expect(await controller!.cheatsAllowed()).toBe(false);
    expect(traces.filter((t) => t.code === "DSH_CHEAT_SWITCH").map((t) => t.detail.quote)).toEqual(["随便开挂", "还是别开了"]);
    await lane.close();
  });

  it("resumes an active goal after a host restart", async () => {
    const first = new GoalLane(session, { trace, idleMs: 20, createRunner: scripted([async () => new Promise((r) => setTimeout(r, 20))]) });
    const record = await first.apply({ op: "set", text: "keep going" }, defaultPersonaKnobs);
    await vi.waitFor(() => expect(first.current()!.turns).toBeGreaterThan(0), { timeout: 10_000 });
    await first.close();
    const prompts: string[] = [];
    const second = new GoalLane(session, { trace, idleMs: 20, createRunner: scripted([async (tools) => { await call(tools, GOAL_TOOL_NAMES.finish, { status: "failed", summary: "gave up" }); }], prompts) });
    await second.load();
    await settle(second, ["failed"]);
    expect(second.current()!.goalId).toBe(record!.goalId);
    expect(traces.some((t) => t.code === "DSH_GOAL_RESUMED")).toBe(true);
  });

  it("waits without spending turns while the world is paused", async () => {
    sim.paused = true;
    await new Promise((r) => setTimeout(r, 50));
    const lane = new GoalLane(session, { trace, idleMs: 20, createRunner: scripted([async () => undefined]) });
    await lane.apply({ op: "set", text: "wait" }, defaultPersonaKnobs);
    await new Promise((r) => setTimeout(r, 200));
    expect(lane.current()!.turns).toBe(0);
    await lane.close();
  });
});
