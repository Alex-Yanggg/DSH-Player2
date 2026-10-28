import { mkdtempSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MindCore, MEMORY_NOTE_LIMIT } from "./core.js";
import { PERSONA_SAVE, SAVE_FACT_LIMIT } from "./ledger.js";
import { parseLedgerEdits } from "./dream-ledger.js";
import { writeLedgerExport } from "./export.js";

const NOW = new Date("2026-10-24T08:10:00.000Z");
const later = new Date(NOW.getTime() + 86_400_000);

/** One persona's bridge directory; every save of the person shares it. */
function project(): string {
  return join(mkdtempSync(join(tmpdir(), "player2-library-")), "projects", "mira");
}

async function mindAt(root: string, save: string): Promise<MindCore> {
  const dir = join(root, "sessions", save);
  await mkdir(dir, { recursive: true });
  return new MindCore(dir);
}

describe("the persona lesson store and the save facts (P2-0019b T1, P2-0019c)", () => {
  it("keys facts by the save id (the mod derives it from uniqueIDForThisGame) and dedups", async () => {
    const core = await mindAt(project(), "431271845");
    expect(core.save).toBe("431271845");
    expect(await core.learnLesson("The north pass opens on the morning of day 5.", "north pass", NOW)).toBe("kept");
    expect(await core.learnLesson("the north pass opens on the morning of day 5.", "north pass", later)).toBe("known");
    expect((await core.ledger.facts(core.save))).toHaveLength(1);
  });

  it("renders the memory note from both layers under the cap", async () => {
    const core = await mindAt(project(), "431271845");
    await core.ledger.learnFact(PERSONA_SAVE, "Swing the tool at blockers instead of pressing the action button.", "blockers", NOW);
    await core.learnLesson("The mine is closed by a landslide until spring day 5.", "mines", NOW);
    const note = await core.memoryNote(later);
    expect(note).toContain("MEMORY (what you already know");
    expect(note).toContain("YOUR LIBRARY");
    expect(note).toContain("THIS SAVE");
    expect(note).toContain("The mine is closed by a landslide until spring day 5.");
    // A second sitting sees the same note; ordering follows uses and age.
    const second = await core.memoryNote(later);
    expect(second).toContain("The mine is closed by a landslide until spring day 5.");
    expect(note.length).toBeLessThanOrEqual(MEMORY_NOTE_LIMIT + 200);
  });

  it("keeps the save's facts and the persona's lessons bounded", async () => {
    const core = await mindAt(project(), "431271845");
    for (let index = 0; index < SAVE_FACT_LIMIT + 4; index++) await core.learnLesson(`save fact number ${index} about this world`, "fill", NOW);
    expect((await core.ledger.facts(core.save)).length).toBeLessThanOrEqual(SAVE_FACT_LIMIT);
    for (let index = 0; index < SAVE_FACT_LIMIT + 4; index++) await core.ledger.learnFact(PERSONA_SAVE, `persona lesson number ${index} for every save`, "fill", NOW);
    expect((await core.ledger.facts(PERSONA_SAVE)).length).toBeLessThanOrEqual(SAVE_FACT_LIMIT);
  });

  it("the persona store is not listed as one of the game's saves", async () => {
    const core = await mindAt(project(), "save-1");
    await core.ledger.learnFact(PERSONA_SAVE, "Check a schedule before retrying a blocked route.", "policies", NOW);
    expect(await core.ledger.saves()).toEqual([]);
  });
});

describe("the dream distils and the code rule promotes (P2-0019c)", () => {
  it("parses lesson edits with the worked flag, dropping malformed ones", () => {
    const edits = parseLedgerEdits({ ledger: { lessons: [
      { text: "The mine elevator works from day 5.", topic: "mines", worked: true },
      { text: "A plain fact of this world.", topic: "facts" },
      { text: "marked but not boolean", worked: "yes" },
      { text: "" },
    ] } });
    expect(edits?.lessons).toHaveLength(3);
    expect(edits?.lessons[0].worked).toBe(true);
    expect(edits?.lessons[1].worked).toBeUndefined();
    expect(edits?.lessons[2].worked).toBeUndefined();
  });

  it("distils dream lessons as save facts; the persona layer is the code rule's to write", async () => {
    const core = await mindAt(project(), "431271845");
    const prepared = await core.prepareDream(3);
    expect(prepared.digest).toContain("MEMORY_ALREADY_KEPT");
    const outcome = await core.commitDream({ lessons: [
      { text: "The mine elevator works from day 5.", topic: "mines" },
      { text: "Check a schedule before retrying a blocked route.", topic: "policies", worked: true },
    ] }, prepared, "大肥鱼", NOW);
    expect(outcome?.applied.join("\n")).toContain("kept: The mine elevator works from day 5.");
    expect((await core.ledger.facts(core.save)).map((fact) => fact.text)).toEqual(["The mine elevator works from day 5.", "Check a schedule before retrying a blocked route."]);
    expect((await core.ledger.facts(PERSONA_SAVE))).toHaveLength(0); // one save is never enough
    // The same dream lesson again is known, not a duplicate.
    const again = await core.commitDream({ lessons: [{ text: "The mine elevator works from day 5.", topic: "mines" }] }, prepared, "大肥鱼", later);
    expect(again?.applied.join("\n")).toContain("known: The mine elevator works from day 5.");
    expect((await core.ledger.facts(core.save))).toHaveLength(2);
  });

  it("promotes a lesson the moment a second save verifies it, and the note carries it", async () => {
    const root = project();
    const first = await mindAt(root, "save-one");
    await first.ledger.learnFact(first.save, "Check a schedule before retrying a blocked route.", "policies", NOW, true);
    expect((await first.ledger.facts(PERSONA_SAVE))).toHaveLength(0);

    const second = await mindAt(root, "save-two");
    await second.ledger.learnFact(second.save, "check a schedule before retrying a blocked route.", "policies", NOW, true);
    const prepared = await second.prepareDream(2);
    const outcome = await second.commitDream({}, prepared, "大肥鱼", later);
    expect(outcome?.applied.join("\n")).toContain("promoted to your library (verified in 2 saves)");
    const held = await second.ledger.facts(PERSONA_SAVE);
    expect(held).toHaveLength(1);
    expect(held[0].text).toBe("check a schedule before retrying a blocked route.");
    // The promoted lesson rides the session-start note on every save of this persona.
    const note = await first.memoryNote(later);
    expect(note).toContain("YOUR LIBRARY");
    expect(note).toContain("check a schedule before retrying a blocked route.");
  });

  it("promotes only lessons marked worked, and never twice", async () => {
    const root = project();
    const a = await mindAt(root, "save-a");
    const b = await mindAt(root, "save-b");
    await a.ledger.learnFact(a.save, "The pass opens when the crew arrives on day 5.", "passes", NOW);
    await b.ledger.learnFact(b.save, "The pass opens when the crew arrives on day 5.", "passes", NOW, true);
    await b.commitDream({}, await b.prepareDream(1), "大肥鱼", later);
    expect((await b.ledger.facts(PERSONA_SAVE))).toHaveLength(0);
    // Now the first save verifies it too: the next dream promotes, once.
    await a.ledger.learnFact(a.save, "The pass opens when the crew arrives on day 5.", "passes", NOW, true);
    const outcome = await b.commitDream({}, await b.prepareDream(2), "大肥鱼", later);
    expect(outcome?.applied.join("\n")).toContain("promoted to your library");
    expect((await b.ledger.facts(PERSONA_SAVE))).toHaveLength(1);
    const again = await b.commitDream({}, await b.prepareDream(3), "大肥鱼", later);
    expect(again?.applied.join("\n")).not.toContain("promoted");
    expect((await b.ledger.facts(PERSONA_SAVE))).toHaveLength(1);
  });
});

describe("facts are as of a day, and the dream judges sameness (P2-0019d)", () => {
  it("stamps a fact with the game day it was seen, refreshes it when seen again, and tells today apart", async () => {
    const core = await mindAt(project(), "431271845");
    await core.learnLesson("The way into the mountain cave is blocked by fallen rocks.", "the mines", NOW, 2);
    expect((await core.ledger.facts(core.save))[0].day).toBe(2);
    const note = await core.memoryNote(later, 6);
    expect(note).toContain("day 2] The way into the mountain cave is blocked by fallen rocks.");
    expect(note).toContain("today is day 6");
    expect(note).toContain("may have changed");
    await core.learnLesson("the way into the mountain cave is blocked by fallen rocks.", "the mines", later, 4);
    expect((await core.ledger.facts(core.save))[0].day).toBe(4);
  });

  it("lists the latest day's facts first, so an often-repeated old fact cannot crowd out today's", async () => {
    const core = await mindAt(project(), "431271845");
    for (let seen = 0; seen < 5; seen++) await core.learnLesson("The mine entrance is blocked by fallen rocks.", "the mines", NOW, 2);
    await core.learnLesson("The mine entrance is open now.", "the mines", NOW, 5);
    const note = await core.memoryNote(later, 6);
    expect(note.indexOf("The mine entrance is open now.")).toBeGreaterThan(-1);
    expect(note.indexOf("The mine entrance is open now.")).toBeLessThan(note.indexOf("The mine entrance is blocked by fallen rocks."));
  });

  it("dated dream lessons, and other saves' verified lessons shown to the dream until promoted", async () => {
    const root = project();
    const first = await mindAt(root, "save-one");
    await first.ledger.learnFact(first.save, "Waiting a day can reopen a closed route.", "policies", NOW, true);
    await first.ledger.learnFact(first.save, "A plain fact of the first world.", "facts", NOW);
    const second = await mindAt(root, "save-two");
    const prepared = await second.prepareDream(5);
    expect(prepared.digest).toContain("WORKED_IN_YOUR_OTHER_SAVES(1)");
    expect(prepared.digest).toContain("- Waiting a day can reopen a closed route.");
    expect(prepared.digest).not.toContain("A plain fact of the first world.");
    // The dream recognises its own paraphrase and writes the shown text: the code rule then fires.
    const outcome = await second.commitDream({ lessons: [{ text: "Waiting a day can reopen a closed route.", topic: "policies", worked: true }] }, prepared, "大肥鱼", later);
    expect(outcome?.applied.join("\n")).toContain("promoted to your library (verified in 2 saves)");
    expect((await second.ledger.facts(second.save))[0].day).toBe(5);
    expect((await second.prepareDream(6)).digest).not.toContain("WORKED_IN_YOUR_OTHER_SAVES");
  });
});

describe("the player-readable export", () => {
  it("lists persona lessons and per-save facts", async () => {
    const root = project();
    const core = await mindAt(root, "save-x");
    const other = await mindAt(root, "save-y");
    await core.ledger.learnFact(PERSONA_SAVE, "Look for a hole or a machine when a place seems sealed.", "exploration", NOW);
    await other.ledger.learnFact(other.save, "The mine is closed until spring day 5.", "mines", NOW);
    const path = await writeLedgerExport(core.ledger, "大肥鱼", later);
    const markdown = await readFile(path, "utf8");
    expect(markdown).toContain("跨每个存档记住的");
    expect(markdown).toContain("Look for a hole or a machine when a place seems sealed.");
    expect(markdown).toContain("The mine is closed until spring day 5.");
    expect(markdown).not.toContain("存档 persona");
  });
});
