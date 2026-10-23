import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyDeclarationSchema, parseReflexTable } from "@dsh-player2/contracts";
import { createBodyTools } from "./tools.js";
import { loadReflexTable, ReflexBody } from "./reflex.js";
import { Toy2Adapter, TOY2_GOAL } from "./toy2.js";

vi.setConfig({ testTimeout: 30_000 });

/**
 * The second-game smoke (P2-0019 T4): Keycraft's goal runs to the Crown
 * through the plugin's own body tools — no code written for this game, only
 * the sim data in toy2.ts and the toy2 reflex table — plus one scripted
 * stand-in for the mind, which the e2e loops replace with the real one.
 */

let toy2: Toy2Adapter;

beforeEach(() => {
  toy2 = new Toy2Adapter();
});

afterEach(async () => {
  await toy2.stop();
});

const exec = { callId: "call-1", signal: new AbortController().signal };

function tool(body: Parameters<typeof createBodyTools>[0]["body"], name: string) {
  const found = createBodyTools({ body }).find((t) => t.name === name);
  if (!found) throw new Error(name);
  const run = found as unknown as { execute(args: Record<string, unknown>, exec: unknown): Promise<string> };
  return (args: Record<string, unknown>) => run.execute(args, exec);
}

type ToolFn = (args: Record<string, unknown>) => Promise<string>;

/** Walk next to a tile and press one button, as the mind would through the tools. */
async function act(input: ToolFn, walk: ToolFn, x: number, y: number, button: string): Promise<string> {
  expect(await walk({ x, y, mode: "adjacent" })).toMatch(/^OK/);
  return input({ steps: [{ press: [button], ms: 0 }] });
}

describe("the toy2 port", () => {
  it("costs data only: its declaration parses, and no table means the mind alone", async () => {
    await toy2.start(1);
    expect(bodyDeclarationSchema.parse(await toy2.declaration()).game).toBe("toy2-keycraft");
    expect(loadReflexTable("toy2")?.rows[0]?.id).toBe("unstick");
  });

  it("runs the Crown goal through the plugin's own tools, lock and key included", async () => {
    await toy2.start(1);
    const walk = tool(toy2, "body_walk_to");
    const input = tool(toy2, "body_input");
    expect(TOY2_GOAL).toContain("Crown");
    // The lock-and-key chain: red key -> red door -> blue key -> blue door -> stone.
    expect(await act(input, walk, 2, 2, "KeyE")).toContain("picked-up: Red Key");
    expect(await act(input, walk, 6, 7, "KeyE")).toContain("picked-up: Wood");
    expect(await act(input, walk, 8, 3, "KeyE")).toContain("unlocked: Red Door");
    expect(await act(input, walk, 10, 1, "KeyE")).toContain("picked-up: Wood");
    expect(await act(input, walk, 10, 3, "KeyE")).toContain("picked-up: Wood");
    expect(await act(input, walk, 11, 1, "KeyE")).toContain("picked-up: Blue Key");
    expect(await act(input, walk, 8, 6, "KeyE")).toContain("unlocked: Blue Door");
    expect(await act(input, walk, 10, 7, "KeyE")).toContain("picked-up: Stone");
    expect(await act(input, walk, 11, 8, "KeyE")).toContain("picked-up: Stone");
    expect(await act(input, walk, 6, 2, "KeyC")).toContain("crafted: Crown");
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
