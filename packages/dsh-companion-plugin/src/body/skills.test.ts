import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyItem } from "@dsh-player2/contracts";
import { createSkillRunner, InProcessRunner, PtcRunner, skillHands, SkillStore, type PtcLike } from "./skills.js";
import { SimAdapter, type SimLocation } from "./sim-adapter.js";

vi.setConfig({ testTimeout: 30_000 });

const FARM = [
  "############",
  "#..........#",
  "#..........#",
  "#..........#",
  "#..........#",
  "############",
];

const kit: BodyItem[] = [{ slot: 0, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" }];

let sim: SimAdapter;
let session: string;

beforeEach(async () => {
  const locations: SimLocation[] = [{ name: "Farm", rows: [...FARM], warps: [], objects: [], characters: [] }];
  sim = new SimAdapter({ locations, body: { location: "Farm", x: 2, y: 3, items: kit.map((i) => ({ ...i })) } });
  await sim.start(1);
  session = await mkdtemp(join(tmpdir(), "player2-skills-"));
});

afterEach(async () => {
  await sim.stop();
});

describe("the skill cycle on the sim body", () => {
  it("saves only what replays cleanly, runs it later, and marks a failing run stale", async () => {
    const store = new SkillStore(session, new InProcessRunner(skillHands(sim)));
    // A refusing save: the replay throws, so nothing is stored.
    await expect(store.save("broken", "never works", "throw new Error('nope')")).rejects.toThrow(/refused: the replay failed.*nope/);
    expect((await store.list()).map((s) => s.name)).not.toContain("broken");
    // A clean save: the program walks through the body tools and returns a summary.
    const saved = await store.save("walk-to-patch", "Walk to the tilled patch", "const where = await hands.walkTo({ x: 5, y: 3 });\nreturn where;");
    expect(saved).toContain("replayed cleanly");
    // A later run does the same work in one call.
    const run = await store.run("walk-to-patch", {});
    expect(run).toContain("Skill walk-to-patch ran");
    expect(run).toContain("OK: arrived");
    expect(sim.tile).toEqual({ x: 5, y: 3 });
    // A run-time failure reports the error and marks the skill stale; a clean run clears it.
    await store.save("flaky", "Fails on demand", "if (args && args.fail) throw new Error('on purpose');\nreturn 'done';");
    expect(await store.run("flaky", { fail: true })).toContain("marked stale").toContain("on purpose");
    expect((await store.load("flaky")).stale).toContain("on purpose");
    expect(await store.run("flaky", {})).toContain("stale mark cleared");
    expect((await store.load("flaky")).stale).toBeNull();
  });

  it("refuses names and purposes that do not fit", async () => {
    const store = new SkillStore(session, new InProcessRunner(skillHands(sim)));
    await expect(store.save("Bad Name", "purpose", "return 1")).rejects.toThrow(/refused: a skill name/);
    await expect(store.save("ok-name", "x", "return 1")).rejects.toThrow(/refused: the purpose/);
  });
});

describe("the execution paths", () => {
  it("bridges hands and args through DSH's PTC seam", async () => {
    const seen: { program: string; bindings: { global: string }[] }[] = [];
    const ptc: PtcLike = {
      language: "typescript",
      resolve: (request) => { seen.push({ program: request.program, bindings: request.bindings as { global: string }[] }); return { spec: true }; },
      run: async (spec) => (spec ? { value: 7, logs: [] } : { error: { message: "bad spec" } }),
    };
    const runner = new PtcRunner(ptc, skillHands(sim));
    expect(runner.path).toBe("dsh-ptc (typescript)");
    const outcome = await runner.run("return args.x + 1;", { x: 6 });
    expect(outcome).toEqual({ ok: true, value: "7" });
    expect(seen[0].program).toContain('const args = {"x":6};');
    expect(seen[0].bindings[0]?.global).toBe("hands");
  });

  it("records which path was chosen at mount", async () => {
    const lines: string[] = [];
    createSkillRunner(undefined, skillHands(sim), (line) => lines.push(line));
    expect(lines[0]).toContain("in-process");
    const fake: PtcLike = { language: "typescript", resolve: () => ({}), run: async () => ({ value: 1 }) };
    createSkillRunner(fake, skillHands(sim), (line) => lines.push(line));
    expect(lines[1]).toContain("dsh-ptc");
  });
});
