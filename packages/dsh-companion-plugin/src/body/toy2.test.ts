import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyDeclarationSchema, bodyProtocolVersion, parseReflexTable, type BodyDeclaration } from "@dsh-player2/contracts";
import { PlanBoard } from "./plan.js";
import { sleep } from "./port.js";
import { loadReflexTable, ReflexBody } from "./reflex.js";
import { SimAdapter, type SimLocation, type SimTaskState } from "./sim-adapter.testkit.js";
import { StuckWatch } from "./stuck.js";

vi.setConfig({ testTimeout: 60_000 });

/**
 * The second-game smoke (P2-0019 T4): Keycraft's goal runs to the Crown
 * through the plan board — the small brain's own step executor. The whole
 * game is sim data and one press override below: no code written for this
 * game beyond its own buttons, plus the toy2 reflex table. A scripted
 * stand-in plays the mind, which the e2e loops replace with the real one.
 */

/** toy2 "Keycraft", ported from research/behavior-debate/bench as sim data (P2-0019 T4): its own map,
 *  buttons and interactions on the unchanged sim engine. The goal: 3 Wood + 2 Stone -> Crown at the bench. */
const ROWS = "#############,#.......#...#,#.......#...#,#...........#,#.......#...#,#.......#####,#...........#,#.......#...#,#.......#...#,#############".split(",");
const OBJECTS = () => [
  { x: 2, y: 2, kind: "key", name: "Red Key", extra: { color: "red" } },
  { x: 11, y: 1, kind: "key", name: "Blue Key", extra: { color: "blue" } },
  { x: 8, y: 3, kind: "door", name: "Red Door", extra: { key: "Red Key", passable: false } },
  { x: 8, y: 6, kind: "door", name: "Blue Door", extra: { key: "Blue Key", passable: false } },
  { x: 6, y: 2, kind: "bench", name: "Workbench", extra: { passable: false } },
  { x: 6, y: 7, kind: "material", name: "Wood" }, { x: 10, y: 1, kind: "material", name: "Wood" }, { x: 10, y: 3, kind: "material", name: "Wood" },
  { x: 10, y: 7, kind: "material", name: "Stone" }, { x: 11, y: 8, kind: "material", name: "Stone" },
];

export const TOY2_GOAL = "Craft the Crown at the workbench: pick up keys and materials with KeyE, unlock the matching doors, collect 3 Wood and 2 Stone, then stand next to the workbench and press KeyC.";

const DECLARATION = (): BodyDeclaration => ({
  version: bodyProtocolVersion, adapter: "sim-toy2", game: "toy2-keycraft", writtenAt: new Date().toISOString(),
  state: { file: "world_state", world: "world_map", description: "Keycraft workshop.", fields: [{ name: "map", description: "rows" }], legend: { ".": "floor", "#": "wall" } },
  inputs: [
    { id: "KeyW", kind: "hold", description: "move up", role: "up" }, { id: "KeyD", kind: "hold", description: "move right", role: "right" },
    { id: "KeyS", kind: "hold", description: "move down", role: "down" }, { id: "KeyA", kind: "hold", description: "move left", role: "left" },
    { id: "KeyE", kind: "press", description: "interact: pick up a key or material, unlock a door", role: "action" },
    { id: "KeyC", kind: "press", description: "craft at the workbench" },
  ],
  limits: { maxSteps: 64, maxStepMs: 10_000, tickMs: 1000 / 60, walkPxPerTick: 4, tilePx: 64 },
  cheats: { settingAllowed: false },
});

/** The whole Keycraft game: its own buttons and interactions, the sim's engine unchanged. */
export class Toy2Adapter extends SimAdapter {
  public constructor() {
    super({
      locations: [{ name: "Workshop", rows: [...ROWS], warps: [], objects: OBJECTS(), characters: [] } as SimLocation],
      body: { location: "Workshop", x: 2, y: 7, items: [] },
      directions: { KeyW: [0, -1, "up"], KeyD: [1, 0, "right"], KeyS: [0, 1, "down"], KeyA: [-1, 0, "left"] },
    });
  }

  public declaration(): Promise<BodyDeclaration> { return Promise.resolve(DECLARATION()); }
  protected declaredInputs() { return DECLARATION().inputs; }

  protected press(id: string, task: SimTaskState): void {
    if (id !== "KeyE" && id !== "KeyC") return super.press(id, task);
    const at = this.location().objects.find((o) => o.x === this.faced().x && o.y === this.faced().y);
    if (id === "KeyE" && at) {
      if (at.kind === "door") {
        const key = String(at.extra?.key);
        if (this.held(key) < 1) return this.note(task, "locked", at.name + " needs the " + key);
        this.location().objects.splice(this.location().objects.indexOf(at), 1);
        return this.note(task, "unlocked", at.name);
      }
      this.location().objects.splice(this.location().objects.indexOf(at), 1);
      this.gain({ id: "(O) " + at.name, name: at.name, category: at.kind === "key" ? "Key" : "Material" });
      return this.note(task, "picked-up", at.name);
    }
    if (id === "KeyC" && at?.kind === "bench") {
      if (this.held("Wood") < 3 || this.held("Stone") < 2) return this.note(task, "crafting-refused", "needs 3 Wood and 2 Stone");
      this.spend("Wood", 3);
      this.spend("Stone", 2);
      this.gain({ id: "(O) Crown", name: "Crown", category: "Craft" });
      return this.note(task, "crafted", "Crown");
    }
    this.note(task, "nothing-there", "no " + (id === "KeyE" ? "interaction" : "bench") + " here");
  }
}

let toy2: Toy2Adapter;

beforeEach(() => {
  toy2 = new Toy2Adapter();
});

afterEach(async () => {
  await toy2.stop();
});

describe("the toy2 port", () => {
  it("costs data only: its declaration parses, and no table means the mind alone", async () => {
    await toy2.start(1);
    expect(bodyDeclarationSchema.parse(await toy2.declaration()).game).toBe("toy2-keycraft");
    expect(loadReflexTable("toy2")?.rows[0]?.id).toBe("unstick");
  });

  it("runs the Crown goal through plan steps, lock and key included", async () => {
    await toy2.start(1);
    const watch = new StuckWatch();
    const board = new PlanBoard(toy2, watch, () => undefined);
    board.start();
    /** Walk next to a tile and press one button, as a handed-down plan step pair. */
    const act = async (x: number, y: number, button: string): Promise<string> => {
      board.set("act", [
        { tool: "body_walk_to", args: { x, y, mode: "adjacent" } },
        { tool: "body_input", args: { steps: [{ press: [button], ms: 0 }] } },
      ]);
      const deadline = Date.now() + 20_000;
      let facts = "";
      while (Date.now() < deadline) {
        facts += board.drain().join("\n");
        if (facts.split("Plan,").length > 2) return facts;
        await sleep(30);
      }
      return facts;
    };
    expect(TOY2_GOAL).toContain("Crown");
    // The lock-and-key chain: red key -> red door -> blue key -> blue door -> stone.
    expect(await act(2, 2, "KeyE")).toContain("picked-up: Red Key");
    expect(await act(6, 7, "KeyE")).toContain("picked-up: Wood");
    expect(await act(8, 3, "KeyE")).toContain("unlocked: Red Door");
    expect(await act(10, 1, "KeyE")).toContain("picked-up: Wood");
    expect(await act(10, 3, "KeyE")).toContain("picked-up: Wood");
    expect(await act(11, 1, "KeyE")).toContain("picked-up: Blue Key");
    expect(await act(8, 6, "KeyE")).toContain("unlocked: Blue Door");
    expect(await act(10, 7, "KeyE")).toContain("picked-up: Stone");
    expect(await act(11, 8, "KeyE")).toContain("picked-up: Stone");
    expect(await act(6, 2, "KeyC")).toContain("crafted: Crown");
    const state = await toy2.state();
    expect(state.body?.items.some((i) => i.name === "Crown")).toBe(true);
  });

  it("the toy2 reflex table fires on this game's own buttons", async () => {
    await toy2.start(1000 / 60); // real-time pace: the reflex clock is wall time (see the stardew unstick test)
    const facts: string[] = [];
    // A local threshold: the sim ticks faster than wall time (see the stardew unstick test).
    const table = { ...loadReflexTable("toy2")!, rows: [{ ...loadReflexTable("toy2")!.rows[0]!, when: { all: [{ kind: "stuckFor", ms: 400 }] } }] };
    const body = new ReflexBody(toy2, { table: parseReflexTable(table), intervalMs: 40, onFact: (fact) => facts.push(fact) });
    body.start();
    try {
      // Held into the workshop's bottom wall: the unstick reflex must answer on KeyA.
      const run = body.run([{ hold: ["KeyS"], ms: 5_000 }]);
      const deadline = Date.now() + 10_000;
      while (facts.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(facts[0]).toContain("unstick");
      const outcome = await run;
      expect(outcome.status).not.toBe("failed");
      const pressed = toy2.inputsSeen.flatMap((t) => t.steps.flatMap((s) => s.hold ?? [])).flat();
      expect(pressed).toContain("KeyA");
    } finally {
      body.stop();
    }
  });
});
