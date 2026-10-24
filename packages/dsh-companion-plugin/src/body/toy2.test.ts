import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyDeclarationSchema, parseReflexTable } from "@dsh-player2/contracts";
import { PlanBoard } from "./plan.js";
import { sleep } from "./port.js";
import { loadReflexTable, ReflexBody } from "./reflex.js";
import { StuckWatch } from "./stuck.js";
import { Toy2Adapter, TOY2_GOAL } from "./toy2.js";

vi.setConfig({ testTimeout: 60_000 });

/**
 * The second-game smoke (P2-0019 T4): Keycraft's goal runs to the Crown
 * through the plan board — the small brain's own step executor, no code
 * written for this game, only the sim data in toy2.ts and the toy2 reflex
 * table — plus one scripted stand-in for the mind, which the e2e loops
 * replace with the real one.
 */

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
    await toy2.start(1);
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
