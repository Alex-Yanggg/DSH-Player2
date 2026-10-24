/**
 * Mind Core (P2-0016 W1 "one mind"): the façade the companion plugin calls
 * around each turn of the save's one DSH session. Before a turn it retrieves
 * episodes and renders the MindContext note; during it the `remember` tool
 * stores what the companion nominates; after it the mood moves and why is
 * recorded. Everything is local file work beside the save's session folder.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/core
 */
import type { Episode } from "@dsh-player2/contracts";
import { dirname, join } from "node:path";
import { applyLedgerEdits, dreamEpisodes, ledgerDigest, parseLedgerEdits, type LedgerEditOutcome } from "./dream-ledger.js";
import { writeLedgerExport } from "./export.js";
import { byLessonScore, lessonLines, PersonaLibrary, type Lesson } from "./library.js";
import { PersonaLedger, type WhyRecord } from "./ledger.js";
import { isWhyQuestion, mindContextNote } from "./mind-context.js";
import { describeMood, type MoodEvent } from "./mood.js";
import { retrieveEpisodes, type EpisodeSelector, type RetrievedEpisode } from "./retrieval.js";
import type { EpisodeNomination } from "./turn-extras.js";

/** Character cap of the session-start memory note (persona lessons + save facts). */
export const MEMORY_NOTE_LIMIT = 900;

/** What a turn was given, kept until the turn commits. */
export interface PreparedMind {
  readonly note: string;
  readonly retrieved: readonly RetrievedEpisode[];
  readonly mood: string;
}

/** What a dream was shown, kept until its edits are applied. */
export interface PreparedDream {
  readonly digest: string;
  readonly shown: readonly Episode[];
  readonly game: string;
}

/** The game assumed for a save with no experience yet. */
export const DEFAULT_GAME = "stardew-valley";

export class MindCore {
  public readonly ledger: PersonaLedger;
  public readonly library: PersonaLibrary;
  public readonly save: string;

  /**
   * @param session the save's session folder (`…/projects/<person>/sessions/<save>`).
   * @param select the episode selector; the default is Player2's thin
   * flavor-cue pick, replaceable by a DSH-side recall.
   */
  public constructor(session: string, private readonly select: EpisodeSelector = retrieveEpisodes) {
    const located = PersonaLedger.forSession(session);
    this.ledger = located.ledger;
    this.save = located.save;
    this.library = new PersonaLibrary(dirname(dirname(session)));
  }

  /** Before a chat or day-start turn; `text` is the player's words (empty at day start). */
  public async prepareTurn(occasion: "chat" | "day-start", text: string, game: string, gameDay: number | null, now: Date): Promise<PreparedMind> {
    if (occasion === "day-start") await this.ledger.applyMood(this.save, [{ kind: "day-start" }], now);
    const { episodes } = await this.ledger.episodes(this.save);
    const retrieved = this.select(episodes.filter((episode) => episode.game === game), { text, gameDay, now });
    let why: { record: WhyRecord; episodes: Episode[] } | null = null;
    if (occasion === "chat" && isWhyQuestion(text)) {
      const record = await this.ledger.lastWhy(this.save);
      if (record !== null) {
        const ids = new Set([...record.cited, ...record.retrieved]);
        why = { record, episodes: episodes.filter((episode) => ids.has(episode.id)) };
      }
    }
    const [mood, story, person] = await Promise.all([this.ledger.mood(this.save, now), this.ledger.story(this.save), this.ledger.person()]);
    const note = mindContextNote({ game, mood, story, traits: person.traits, retrieved, why });
    return { note, retrieved, mood: describeMood(mood) };
  }

  /** Stores one episode the companion nominated with the `remember` tool. */
  public async remember(nomination: EpisodeNomination, game: string, gameDay: number | null, ref: string, now: Date): Promise<Episode[]> {
    const added = await this.ledger.appendEpisodes(this.save, [{
      at: now.toISOString(), gameDay, game,
      kind: nomination.kind, summary: nomination.summary,
      salience: nomination.salience, valence: nomination.valence,
      refs: [ref],
    }]);
    await this.ledger.applyMood(this.save, [{ kind: "episode", valence: nomination.valence, episodeKind: nomination.kind }], now);
    return added;
  }

  /**
   * The session-start memory note (P2-0020 T1): the persona library's lessons
   * and this save's own facts, most-used and newest first, under one hard
   * cap. The save key is the session folder name, the id the mod derives from
   * the game's `uniqueIDForThisGame`. Showing a line marks it used.
   */
  public async memoryNote(now: Date): Promise<string> {
    const [persona, facts] = await Promise.all([this.library.ordered(now), this.ledger.facts(this.save)]);
    const header = "MEMORY (what you already know; history, never the present):";
    const lines: string[] = [];
    const shownPersona: string[] = [];
    const shownFacts: string[] = [];
    let size = header.length;
    const take = (title: string, lessons: readonly Lesson[], shown: string[]): void => {
      if (lessons.length === 0 || size + title.length > MEMORY_NOTE_LIMIT) return;
      lines.push(title);
      size += title.length;
      for (const line of lessonLines(lessons)) {
        if (size + 1 + line.length > MEMORY_NOTE_LIMIT) continue;
        lines.push(line);
        size += 1 + line.length;
        shown.push(line.replace(/^- \[[^\]]*\] /, ""));
      }
    };
    take("YOUR LIBRARY (lessons you keep on every save):", persona, shownPersona);
    take("THIS SAVE, what your own days here taught (history, not the present):", [...facts].sort(byLessonScore(now)), shownFacts);
    if (lines.length === 0) return "";
    await Promise.all([this.library.markUsed(shownPersona, now), this.ledger.markFactsUsed(this.save, shownFacts, now)]);
    return [header, ...lines].join("\n");
  }

  /** Keeps one lesson of this save; the persona layer is the dream's to promote into. */
  public async learnLesson(text: string, topic: string, now: Date): Promise<"kept" | "known"> {
    return this.ledger.learnFact(this.save, text, topic, now);
  }

  /** After a chat or day-start turn: move the mood and record why the reply was said. */
  public async commitTurn(occasion: "chat" | "day-start", turnId: string, replyText: string, prepared: PreparedMind, now: Date): Promise<void> {
    const events: MoodEvent[] = occasion === "chat" ? [{ kind: "chat" }] : [];
    if (events.length > 0) await this.ledger.applyMood(this.save, events, now);
    await this.ledger.recordWhy(this.save, {
      turnId, at: now.toISOString(), reply: replyText,
      retrieved: prepared.retrieved.map((item) => item.episode.id), cited: [], mood: prepared.mood,
    });
  }

  /** Before a dream: the day's episodes, traits, story, and the memory already kept. */
  public async prepareDream(gameDay: number | null): Promise<PreparedDream> {
    const [{ episodes }, story, person, persona, facts] = await Promise.all([
      this.ledger.episodes(this.save), this.ledger.story(this.save), this.ledger.person(),
      this.library.ordered(new Date()), this.ledger.facts(this.save),
    ]);
    const game = episodes.at(-1)?.game ?? DEFAULT_GAME;
    const shown = dreamEpisodes(episodes, gameDay ?? episodes.at(-1)?.gameDay ?? 0);
    const memory = [...lessonLines(persona), ...lessonLines([...facts].sort(byLessonScore(new Date())))];
    return { digest: ledgerDigest(shown, person.traits, story, memory), shown, game };
  }

  /** A dream's ledger edits (the `dream_commit` arguments): validate, apply, distil its lessons, refresh the export. */
  public async commitDream(raw: unknown, prepared: PreparedDream, companionName: string, now: Date): Promise<LedgerEditOutcome | null> {
    const edits = parseLedgerEdits({ ledger: raw });
    let outcome: LedgerEditOutcome | null = null;
    if (edits !== null) {
      const { episodes } = await this.ledger.episodes(this.save);
      const story = await this.ledger.story(this.save);
      await this.ledger.updatePerson((person) => {
        outcome = applyLedgerEdits(edits, { person, story, shown: prepared.shown, known: episodes, game: prepared.game, now });
        return outcome.person;
      });
      const result = outcome as LedgerEditOutcome | null;
      if (result !== null) {
        if (result.story !== null && result.story !== story) await this.ledger.writeStory(this.save, result.story);
        if (result.forget.length > 0) await this.ledger.forgetEpisodes(this.save, result.forget);
        // The dream is the only writer of the persona layer: a lesson it
        // promotes has the day's evidence that the approach worked.
        const distilled: string[] = [];
        for (const lesson of edits.lessons) {
          try {
            const kept = lesson.where === "save"
              ? await this.ledger.learnFact(this.save, lesson.text, lesson.topic, now)
              : await this.library.learn(lesson.text, lesson.topic, now);
            distilled.push(`${kept === "known" ? "known" : "kept"} (${lesson.where}): ${lesson.text.slice(0, 60)}`);
          } catch (error) {
            distilled.push(`refused (${lesson.where}): ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (distilled.length > 0) outcome = { ...result, applied: [...result.applied, ...distilled] };
      }
    }
    await writeLedgerExport(this.ledger, companionName, now);
    return outcome;
  }
}
