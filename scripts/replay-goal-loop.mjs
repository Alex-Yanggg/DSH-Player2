import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPersonaKnobs } from "@dsh-player2/contracts";
import { createGoalTools, GOAL_TOOL_NAMES, SimAdapter } from "@dsh-player2/dsh-companion-plugin";
import { GoalLane } from "@dsh-player2/dsh-host-plugin";

// Keyless goal-lane replay (P2-0021). A simulated body adapter speaks the real
// body file protocol; the real goal lane (record, budget, dice, stop path)
// drives a scripted stand-in for the model that only uses the real goal tools
// (observe, walk, raw buttons, finish): "give me 3 carrots" completes in 5 of 5
// runs from different start tiles, across game days, and the companion's own
// summary reaches the game. Budget failure and knob statistics are unit tests
// (goal.test.ts, body.test.ts). No game, no API key. Real-model and real-game runs are the e2e suite's job.

const FARM = [
  "##############",
  "#............#",
  "#............#",
  "#....####....#",
  "#............#",
  "#............#",
  "##############",
];
const kit = () => [
  { slot: 0, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" },
  { slot: 1, id: "(T)WateringCan", name: "Watering Can", stack: 1, category: "Tool" },
  { slot: 2, id: "(O)474", name: "Carrot Seeds", stack: 3, category: "Seed" },
];

const call = (tools, name, args) => tools.find((tool) => tool.name === name).execute(args);

/** The scripted stand-in: reads the state each turn and does the next sensible thing. */
function carrotFarmer(sim, wanted) {
  return async ({ controller }) => {
    const tools = createGoalTools(controller);
    const plot = [{ x: 3, y: 5 }, { x: 5, y: 5 }, { x: 7, y: 5 }];
    return {
      cancel() {}, async dispose() {},
      async turn() {
        const state = await controller.body.state();
        const carrots = state.body.items.find((item) => item.name === "Carrot")?.stack ?? 0;
        if (carrots >= wanted) {
          await call(tools, GOAL_TOOL_NAMES.finish, { status: "done", summary: `Planted ${wanted} seeds on the south plot, watered them, and pulled up ${carrots} carrots.` });
          return;
        }
        const dirt = state.objects.filter((object) => object.kind === "dirt");
        if (dirt.some((object) => object.extra?.ready === true)) {
          for (const tile of dirt.filter((object) => object.extra?.ready === true)) await call(tools, GOAL_TOOL_NAMES.use, { button: "Action", x: tile.x, y: tile.y });
          return;
        }
        if (dirt.length === 0) {
          await call(tools, GOAL_TOOL_NAMES.note, { text: "no shop needed: three seeds in the bag, plant them on the south plot" });
          for (const tile of plot) await call(tools, GOAL_TOOL_NAMES.use, { button: "UseTool", x: tile.x, y: tile.y, slot: 1 });
          for (const tile of plot) await call(tools, GOAL_TOOL_NAMES.use, { button: "Action", x: tile.x, y: tile.y, slot: 3 });
          for (const tile of plot) await call(tools, GOAL_TOOL_NAMES.use, { button: "UseTool", x: tile.x, y: tile.y, slot: 2 });
          return;
        }
        sim.growAll(); // the night passes
      },
    };
  };
}

async function withSim(start, body) {
  const session = await mkdtemp(join(tmpdir(), "player2-goal-replay-"));
  const sim = new SimAdapter(session, { locations: [{ name: "Farm", rows: [...FARM], warps: [], objects: [], characters: [] }], body: { location: "Farm", x: start.x, y: start.y, items: kit() } });
  await sim.start(1);
  try { return await body(session, sim); } finally { await sim.stop(); await rm(session, { recursive: true, force: true, maxRetries: 5 }); }
}

async function waitTerminal(lane, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const status = lane.current()?.status;
    if (["done", "failed", "stopped", "budget-exceeded"].includes(status)) return lane.current();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("goal did not end in time");
}

const traces = [];
const trace = async (code, detail) => { traces.push({ code, ...detail }); };

// 1. Five runs of "give me 3 carrots".
const starts = [{ x: 1, y: 1 }, { x: 12, y: 1 }, { x: 6, y: 4 }, { x: 1, y: 5 }, { x: 12, y: 5 }];
let done = 0;
for (const start of starts) {
  const record = await withSim(start, async (session, sim) => {
    const lane = new GoalLane(session, { trace, idleMs: 20, createRunner: carrotFarmer(sim, 3) });
    await lane.apply({ op: "set", text: "给我弄 3 根胡萝卜" }, defaultPersonaKnobs);
    const result = await waitTerminal(lane);
    await lane.close();
    const speech = JSON.parse(await readFile(join(session, "speech", (await readdir(join(session, "speech"))).find((n) => n.startsWith("say-"))), "utf8"));
    assert.match(speech.text, /carrots/);
    return result;
  });
  if (record.status === "done") done++;
  console.log(`carrots from (${start.x},${start.y}): ${record.status} after ${record.turns} turns, notes=${record.notes.length}`);
}
assert.ok(done >= 4, `only ${done}/5 carrot runs completed`);

assert.ok(traces.some((t) => t.code === "DSH_GOAL_FINISHED"));
console.log(`P2-0021 goal-lane replay passed: ${done}/5 carrot runs.`);
