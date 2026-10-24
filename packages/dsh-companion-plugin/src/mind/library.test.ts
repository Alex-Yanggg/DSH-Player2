import { mkdtempSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MindCore, MEMORY_NOTE_LIMIT } from "./core.js";
import { lessonKey, PersonaLibrary, PERSONA_LESSON_LIMIT } from "./library.js";
import { SAVE_FACT_LIMIT } from "./ledger.js";
import { parseLedgerEdits } from "./dream-ledger.js";

const NOW = new Date("2026-10-24T08:10:00.000Z");
const later = new Date(NOW.getTime() + 86_400_000);

async function personaDir(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "player2-library-"));
  return join(root, "projects", "mira");
}

async function mind(): Promise<MindCore> {
  const dir = join(await personaDir(), "sessions", "431271845");
  await mkdir(dir, { recursive: true });
  return new MindCore(dir);
}

describe("the persona library (P2-0020 T1)", () => {
  it("keeps a lesson once; a paraphrase is folded in, not duplicated", async () => {
    const library = new PersonaLibrary(await personaDir());
    expect(await library.learn("When a destination is gated by a scheduled event, check the schedule before walking.", "schedules", NOW)).toBe("kept");
    expect(await library.learn("when a destination is gated by a scheduled event,  check the schedule before walking.", "schedules", later)).toBe("known");
    const lessons = await library.lessons();
    expect(lessons).toHaveLength(1);
    expect(lessons[0].uses).toBe(2);
  });

  it("shows most-used and newest first and stays bounded", async () => {
    const library = new PersonaLibrary(await personaDir());
    await library.learn("lesson one", "a", NOW);
    await library.learn("lesson two", "b", NOW);
    await library.learn("lesson three", "c", later);
    await library.markUsed(["lesson one"], later);
    const ordered = (await library.ordered(later)).map((lesson) => lesson.text);
    // one use today beats one use yesterday, and two uses beat one
    expect(ordered).toEqual(["lesson three", "lesson one", "lesson two"]);
    for (let index = 0; index < PERSONA_LESSON_LIMIT + 4; index++) await library.learn(`filler lesson number ${index}`, "fill", later);
    expect((await library.lessons()).length).toBeLessThanOrEqual(PERSONA_LESSON_LIMIT);
    expect(await readFile(join(library.root, "lessons.md"), "utf8")).toContain("# Lessons");
  });

  it("refuses a lesson with no content", async () => {
    const library = new PersonaLibrary(await personaDir());
    await expect(library.learn("  ", "x", NOW)).rejects.toThrow(/3 characters/);
  });
});

describe("the save layer (P2-0020 T1)", () => {
  it("keys facts by the save id (the mod derives it from uniqueIDForThisGame) and dedups", async () => {
    const core = await mind();
    expect(core.save).toBe("431271845");
    expect(await core.learnLesson("The north pass opens on the morning of day 5.", "north pass", NOW)).toBe("kept");
    expect(await core.learnLesson("the north pass opens on the morning of day 5.", "north pass", later)).toBe("known");
    expect((await core.ledger.facts(core.save))).toHaveLength(1);
  });

  it("renders the memory note from both layers, capped, and marks what it showed", async () => {
    const core = await mind();
    await core.library.learn("Swing the tool at blockers instead of pressing the action button.", "blockers", NOW);
    await core.learnLesson("The mine is closed by a landslide until spring day 5.", "mines", NOW);
    const note = await core.memoryNote(later);
    expect(note).toContain("MEMORY (what you already know");
    expect(note).toContain("YOUR LIBRARY");
    expect(note).toContain("THIS SAVE");
    expect(note).toContain("The mine is closed by a landslide until spring day 5.");
    // Shown lines count as used: a second note orders and marks again without duplicating.
    const second = await core.memoryNote(later);
    expect(second).toContain("The mine is closed by a landslide until spring day 5.");
    expect((await core.ledger.facts(core.save))[0].uses).toBe(2);
    expect(note.length).toBeLessThanOrEqual(MEMORY_NOTE_LIMIT + 200);
  });

  it("keeps the save's facts bounded", async () => {
    const core = await mind();
    for (let index = 0; index < SAVE_FACT_LIMIT + 4; index++) await core.learnLesson(`save fact number ${index} about this world`, "fill", NOW);
    expect((await core.ledger.facts(core.save)).length).toBeLessThanOrEqual(SAVE_FACT_LIMIT);
  });
});

describe("the dream distils into the layers (P2-0020 T1)", () => {
  it("parses lesson edits and applies them where they belong", async () => {
    const edits = parseLedgerEdits({ ledger: { lessons: [
      { where: "save", text: "The mine elevator works from day 5.", topic: "mines" },
      { where: "persona", text: "Check a schedule before retrying a blocked route.", topic: "policies" },
      { where: "nowhere", text: "dropped" },
      { text: "no where" },
    ] } });
    expect(edits?.lessons).toHaveLength(2);
    const core = await mind();
    const prepared = await core.prepareDream(3);
    expect(prepared.digest).toContain("MEMORY_ALREADY_KEPT");
    const outcome = await core.commitDream({ lessons: [
      { where: "save", text: "The mine elevator works from day 5.", topic: "mines" },
      { where: "persona", text: "Check a schedule before retrying a blocked route.", topic: "policies" },
    ] }, prepared, "大肥鱼", NOW);
    expect(outcome?.applied.join("\n")).toContain("kept (save)");
    expect(outcome?.applied.join("\n")).toContain("kept (persona)");
    expect((await core.ledger.facts(core.save)).map((fact) => fact.text)).toEqual(["The mine elevator works from day 5."]);
    expect((await core.library.lessons()).map((lesson) => lesson.text)).toEqual(["Check a schedule before retrying a blocked route."]);
    // The same dream lesson again is known, not a duplicate.
    const again = await core.commitDream({ lessons: [{ where: "persona", text: "Check a schedule before retrying a blocked route.", topic: "policies" }] }, prepared, "大肥鱼", later);
    expect(again?.applied.join("\n")).toContain("known (persona)");
    expect((await core.library.lessons())).toHaveLength(1);
    expect(lessonKey("A  B")).toBe("a b");
  });
});
