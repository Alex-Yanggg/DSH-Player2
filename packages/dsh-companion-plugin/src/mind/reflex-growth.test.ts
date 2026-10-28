import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReflexRow } from "@dsh-player2/contracts";
import { loadReflexTable } from "../body/reflex.js";
import { MindCore } from "./core.js";
import { PERSONA_SAVE } from "./ledger.js";
import { applyReflexEdits, REFLEX_TRIAL, recordReflexOutcome, rowsInPlay, type ReflexBook } from "./reflex-growth.js";

const NOW = new Date("2026-10-28T08:00:00.000Z");
const shipped = loadReflexTable("stardew-valley")!.rows;
const buttons = new Set(["ControllerX", "DPadLeft", "DPadRight", "DPadUp", "DPadDown"]);

const eatSooner: ReflexRow = {
  id: "eat-sooner",
  when: { all: [{ kind: "healthBelow", value: 50 }, { kind: "hasItem", category: "Food" }] },
  do: { kind: "useItem", match: { category: "Food" }, steps: [{ press: ["ControllerX"], ms: 400 }] },
  cooldownMs: 5000,
  fact: "acted on reflex (eat-sooner): ate {item} with health at {health}",
};
const empty = (): ReflexBook => ({ grown: [], today: {} });

async function mindAt(root: string, save: string): Promise<MindCore> {
  const dir = join(root, "sessions", save);
  await mkdir(dir, { recursive: true });
  return new MindCore(dir);
}

describe("reflex growth: proposals the dream makes", () => {
  it("adds a candidate and tunes a shipped row, refusing with a reason the companion can read", () => {
    const book = empty();
    const result = applyReflexEdits([
      { op: "tune", id: "eat-when-hurt", row: eatSooner },
      { op: "add", row: { ...eatSooner, id: "eat-when-hurt" } },
      { op: "add", row: { ...eatSooner, id: "jump", do: { kind: "steps", steps: [{ press: ["Jump"], ms: 100 }] } } },
      { op: "add", row: { ...eatSooner, id: "fly", when: { all: [{ kind: "levitate" }] } } },
      { op: "tune", id: "unstick", row: { ...eatSooner, id: "unstick-2" } },
    ], book, shipped, buttons, NOW);
    expect(result.applied).toEqual(["reflex tune eat-when-hurt: candidate eat-sooner"]);
    expect(result.rejected.join("\n")).toMatch(/id eat-when-hurt is taken/);
    expect(result.rejected.join("\n")).toMatch(/buttons not in body_controls: Jump/);
    expect(result.rejected.join("\n")).toMatch(/when\.all\.0/);
    expect(result.rejected.join("\n")).toMatch(/keeps do\.kind/);
    expect(book.grown[0]).toMatchObject({ status: "candidate", replaces: "eat-when-hurt" });
  });

  it("a candidate on trial shadows its target, and replaces it once it proves out", () => {
    const book = empty();
    applyReflexEdits([{ op: "tune", id: "eat-when-hurt", row: eatSooner }], book, shipped, buttons, NOW);
    expect(rowsInPlay(shipped, [book]).map((row) => row.id).slice(0, 2)).toEqual(["eat-sooner", "eat-when-hurt"]);
    expect(recordReflexOutcome(book, "eat-sooner", true)).toBeNull();
    expect(recordReflexOutcome(book, "eat-sooner", false)).toBeNull();
    expect(recordReflexOutcome(book, "eat-sooner", true)).toMatch(/proved out \(2\/3 helped\)/);
    expect(rowsInPlay(shipped, [book]).map((row) => row.id)).not.toContain("eat-when-hurt");
    expect(book.today["eat-sooner"]).toEqual({ good: 2, bad: 1 });
  });

  it("a candidate that mostly fails is dropped and the shipped row stays", () => {
    const book = empty();
    applyReflexEdits([{ op: "tune", id: "eat-when-hurt", row: eatSooner }], book, shipped, buttons, NOW);
    for (let i = 0; i < REFLEX_TRIAL - 1; i++) recordReflexOutcome(book, "eat-sooner", false);
    expect(recordReflexOutcome(book, "eat-sooner", true)).toMatch(/dropped/);
    expect(rowsInPlay(shipped, [book]).map((row) => row.id)).toEqual(shipped.map((row) => row.id));
  });
});

describe("reflex growth through the mind (the save's ledger)", () => {
  it("dreams the tally, keeps a lesson for a dropped row, and promotes a row proven in two saves", async () => {
    const root = join(mkdtempSync(join(tmpdir(), "player2-reflex-")), "projects", "mira");
    const first = await mindAt(root, "save-one");
    const second = await mindAt(root, "save-two");

    await first.reflexOutcome("eat-when-hurt", true, NOW);
    const dream = await first.reflexDream(shipped);
    expect(dream).toContain("- eat-when-hurt [shipped] today 1/0");
    expect(await first.reflexDream(shipped)).toContain("- eat-when-hurt [shipped] today 0/0");

    const bad = { ...eatSooner, id: "eat-late", when: { all: [{ kind: "healthBelow" as const, value: 10 }] } };
    await first.growReflexes([{ op: "add", row: bad }], shipped, buttons, NOW);
    for (let i = 0; i < REFLEX_TRIAL; i++) await first.reflexOutcome("eat-late", false, NOW);
    expect((await first.ledger.facts(first.save)).map((fact) => fact.text).join("\n")).toMatch(/reflex eat-late did not help/);

    for (const mind of [first, second]) {
      await mind.growReflexes([{ op: "tune", id: "eat-when-hurt", row: eatSooner }], shipped, buttons, NOW);
      for (let i = 0; i < REFLEX_TRIAL; i++) await mind.reflexOutcome("eat-sooner", true, NOW);
    }
    const last = await second.growReflexes([], shipped, buttons, NOW);
    expect(last.applied.join("\n")).toMatch(/eat-sooner proved out in two saves/);
    const third = await mindAt(root, "save-three");
    expect((await third.reflexRows(shipped)).map((row) => row.id)).toContain("eat-sooner");
    expect((await third.reflexRows(shipped)).map((row) => row.id)).not.toContain("eat-when-hurt");
    expect(third.ledger.savePath(PERSONA_SAVE, "reflexes.json")).toContain("persona");
  });
});
