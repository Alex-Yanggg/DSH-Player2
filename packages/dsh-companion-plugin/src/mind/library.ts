import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The persona library (P2-0020 T1): one companion's own layer of memory,
 * shared by every save of that persona, under the persona's user data folder:
 *
 * ```text
 * <bridge>/projects/<person>/library/
 *   lessons.json   durable lessons and policies (the store)
 *   lessons.md     the same, player-readable
 *   skills/        saved skills, by name (see body/skills)
 * ```
 *
 * The save layer (facts about one world) lives in the Persona Ledger beside
 * it; this module only owns the persona layer. Lessons are short, deduped by
 * their normalized text, and bounded; the prompt shows them most-used and
 * newest first under a hard cap. A lesson reaches this library only through
 * promotion (the dream distils it, or it was learned on a save where the
 * approach it suggests already worked).
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/library
 */

/** Lessons kept in the persona library. */
export const PERSONA_LESSON_LIMIT = 64;
/** Characters of one lesson's text. */
export const LESSON_TEXT_LIMIT = 240;

/** One durable lesson, as `lessons.json` holds it. */
export interface Lesson {
  readonly text: string;
  readonly topic: string;
  readonly createdAt: string;
  uses: number;
  lastUsedAt: string | null;
}

/** Ordering for the prompt: most-used and newest first. */
export function lessonScore(lesson: Lesson, now: Date): number {
  const ageDays = Math.max(0, now.getTime() - Date.parse(lesson.createdAt)) / 86_400_000;
  return lesson.uses / (1 + ageDays);
}

/** Sorts most-used and newest first. */
export function byLessonScore(now: Date): (left: Lesson, right: Lesson) => number {
  return (left, right) => lessonScore(right, now) - lessonScore(left, now) || right.createdAt.localeCompare(left.createdAt);
}

/** Whitespace-collapsed, case-folded key two lessons must share to be the same. */
export function lessonKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** One prompt line per lesson. */
export function lessonLines(lessons: readonly Lesson[]): string[] {
  return lessons.map((lesson) => `- [${lesson.topic}${lesson.uses > 1 ? ` x${lesson.uses}` : ""}] ${lesson.text}`);
}

export class PersonaLibrary {
  public readonly root: string;

  /** @param personaDirectory the persona's user data folder (`…/projects/<person>`). */
  public constructor(personaDirectory: string) {
    this.root = join(personaDirectory, "library");
  }

  public skillsDir(): string {
    return join(this.root, "skills");
  }

  public async lessons(): Promise<Lesson[]> {
    const raw: unknown = JSON.parse(await readFile(join(this.root, "lessons.json"), "utf8").catch(() => "[]"));
    return Array.isArray(raw)
      ? raw.filter((one): one is Lesson => typeof (one as Lesson)?.text === "string" && typeof (one as Lesson)?.topic === "string")
      : [];
  }

  /**
   * Keeps one lesson; a paraphrase of a lesson already held is folded into it
   * (uses counted once), so near-duplicates do not accumulate.
   */
  public async learn(text: string, topic: string, now: Date): Promise<"kept" | "known"> {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, LESSON_TEXT_LIMIT);
    if (clean.length < 3) throw new Error("a lesson needs at least 3 characters");
    const lessons = await this.lessons();
    const key = lessonKey(clean);
    const known = lessons.find((lesson) => lessonKey(lesson.text) === key);
    if (known !== undefined) {
      known.uses += 1;
      await this.write(lessons, now);
      return "known";
    }
    lessons.push({ text: clean, topic: topic.replace(/\s+/g, " ").trim().slice(0, 40) || "general", createdAt: now.toISOString(), uses: 1, lastUsedAt: null });
    await this.write(lessons, now);
    return "kept";
  }

  /** Marks the shown lessons used, so the prompt's ordering follows what serves. */
  public async markUsed(shown: readonly string[], now: Date): Promise<void> {
    const keys = new Set(shown.map(lessonKey));
    if (keys.size === 0) return;
    const lessons = await this.lessons();
    let touched = false;
    for (const lesson of lessons) {
      if (keys.has(lessonKey(lesson.text)) && lesson.lastUsedAt !== now.toISOString()) {
        lesson.uses += 1;
        lesson.lastUsedAt = now.toISOString();
        touched = true;
      }
    }
    if (touched) await this.write(lessons, now);
  }

  /** All lessons, most-used and newest first (the caller applies the prompt cap). */
  public async ordered(now: Date): Promise<Lesson[]> {
    return [...(await this.lessons())].sort(byLessonScore(now));
  }

  /** Bounded write, plus the player-readable Markdown export. */
  private async write(lessons: Lesson[], now: Date): Promise<void> {
    const kept = [...lessons]
      .sort((left, right) => lessonScore(right, now) - lessonScore(left, now))
      .slice(0, PERSONA_LESSON_LIMIT);
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, "lessons.json"), `${JSON.stringify(kept, null, 2)}\n`, "utf8");
    const md = [
      `# Lessons (kept everywhere this person plays)`,
      ``,
      `Exported ${now.toISOString()}. Local file; delete \`library/\` to empty it.`,
      ``,
      ...kept.map((lesson) => `- ${lesson.text} — ${lesson.topic}${lesson.uses > 1 ? `, used ${lesson.uses}×` : ""}`),
      "",
    ];
    await writeFile(join(this.root, "lessons.md"), md.join("\n"), "utf8");
  }
}
