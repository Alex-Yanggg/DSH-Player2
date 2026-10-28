/**
 * Mind Core (P2-0016 W1 "one mind"): the façade the companion plugin calls
 * around each turn of the save's one DSH session. Before a turn it retrieves
 * episodes and renders the MindContext note; during it the `remember` tool
 * stores what the companion nominates; after it the mood moves and why is
 * recorded. Everything is local file work beside the save's session folder.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/core
 */
import type { Episode, ReflexRow } from "@dsh-player2/contracts";
import { applyLedgerEdits, dreamEpisodes, ledgerDigest, parseLedgerEdits, type LedgerEditOutcome } from "./dream-ledger.js";
import { writeLedgerExport } from "./export.js";
import { PersonaLedger, PERSONA_SAVE, lessonKey, lessonLines, lessonScore, type Lesson, type WhyRecord } from "./ledger.js";
import { isWhyQuestion, mindContextNote } from "./mind-context.js";
import { describeMood, type MoodEvent } from "./mood.js";
import { applyReflexEdits, provenAcrossSaves, readReflexBook, recordReflexOutcome, reflexDigest, rowsInPlay, type ReflexBook } from "./reflex-growth.js";
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
   * The session-start memory note (P2-0019b T1): the persona's own lessons and
   * this save's facts, most-used and newest first, under one hard cap. The
   * save key is the session folder name, the id the mod derives from the
   * game's `uniqueIDForThisGame`.
   */
  public async memoryNote(now: Date): Promise<string> {
    const byScore = (a: Lesson, b: Lesson) => lessonScore(b, now) - lessonScore(a, now);
    const [persona, facts] = await Promise.all([this.ledger.facts(PERSONA_SAVE), this.ledger.facts(this.save)]);
    const header = "MEMORY (what you already know; history, never the present):";
    const lines: string[] = [];
    let size = header.length;
    const take = (title: string, lessons: readonly Lesson[]): void => {
      if (lessons.length === 0 || size + title.length > MEMORY_NOTE_LIMIT) return;
      lines.push(title);
      size += title.length;
      for (const line of lessonLines(lessons)) {
        if (size + 1 + line.length > MEMORY_NOTE_LIMIT) continue;
        lines.push(line);
        size += 1 + line.length;
      }
    };
    take("YOUR LIBRARY (lessons you keep on every save):", [...persona].sort(byScore));
    take("THIS SAVE, what your own days here taught (history, not the present):", [...facts].sort(byScore));
    return lines.length === 0 ? "" : [header, ...lines].join("\n");
  }

  /** Keeps one lesson of this save. */
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
      this.ledger.facts(PERSONA_SAVE), this.ledger.facts(this.save),
    ]);
    const game = episodes.at(-1)?.game ?? DEFAULT_GAME;
    const shown = dreamEpisodes(episodes, gameDay ?? episodes.at(-1)?.gameDay ?? 0);
    const byScore = (a: Lesson, b: Lesson) => lessonScore(b, new Date()) - lessonScore(a, new Date());
    const memory = [...lessonLines([...persona].sort(byScore)), ...lessonLines([...facts].sort(byScore))];
    return { digest: ledgerDigest(shown, person.traits, story, memory), shown, game };
  }

  /**
   * A dream's ledger edits (the `dream_commit` arguments): validate, apply,
   * distil its lessons, promote what two saves verified, refresh the export.
   */
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
        const distilled: string[] = [];
        for (const lesson of edits.lessons) {
          try {
            const kept = await this.ledger.learnFact(this.save, lesson.text, lesson.topic, now, lesson.worked);
            distilled.push(`${kept === "known" ? "known" : "kept"}: ${lesson.text.slice(0, 60)}`);
          } catch (error) {
            distilled.push(`refused: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (distilled.length > 0) outcome = { ...result, applied: [...result.applied, ...distilled] };
      }
    }
    // The persona layer's only writer is this code rule (P2-0019c): a save
    // lesson marked worked reaches the library once two saves verified it.
    const promoted = await this.promoteVerifiedLessons(now);
    if (promoted.length > 0) outcome = { ...(outcome ?? { person: await this.ledger.person(), story: await this.ledger.story(this.save), forget: [], applied: [], rejected: [] }), applied: [...(outcome?.applied ?? []), ...promoted] };
    await writeLedgerExport(this.ledger, companionName, now);
    return outcome;
  }

  /** The reflex rows in play for this save: its own and the persona's grown rows over the shipped ones. */
  public async reflexRows(shipped: readonly ReflexRow[]): Promise<ReflexRow[]> {
    return rowsInPlay(shipped, await Promise.all([this.reflexBook(this.save), this.reflexBook(PERSONA_SAVE)]));
  }

  /** One judged firing; a candidate that failed its trial leaves a lesson. Returns the trial's verdict line, or null. */
  public async reflexOutcome(id: string, good: boolean, now: Date): Promise<string | null> {
    const verdict = await this.ledger.exclusive(async () => {
      const book = await this.reflexBook(this.save);
      const line = recordReflexOutcome(book, id, good);
      await this.ledger.writeJson(this.ledger.savePath(this.save, "reflexes.json"), book);
      return line;
    });
    if (verdict?.endsWith("dropped") === true) await this.ledger.learnFact(this.save, `My ${verdict}.`, "reflexes", now);
    return verdict;
  }

  /** The dream's reflex section; reading it starts a new day's tally. */
  public async reflexDream(shipped: readonly ReflexRow[]): Promise<string> {
    return this.ledger.exclusive(async () => {
      const [book, persona] = await Promise.all([this.reflexBook(this.save), this.reflexBook(PERSONA_SAVE)]);
      const digest = reflexDigest(rowsInPlay(shipped, [book, persona]), [book, persona], book.today);
      await this.ledger.writeJson(this.ledger.savePath(this.save, "reflexes.json"), { ...book, today: {} });
      return digest;
    });
  }

  /** The dream's `reflexes` edits, then any row now active in two saves joins the persona. */
  public async growReflexes(raw: unknown, shipped: readonly ReflexRow[], buttons: ReadonlySet<string>, now: Date): Promise<{ applied: string[]; rejected: string[] }> {
    return this.ledger.exclusive(async () => {
      const [book, persona] = await Promise.all([this.reflexBook(this.save), this.reflexBook(PERSONA_SAVE)]);
      const outcome = applyReflexEdits(raw, book, rowsInPlay(shipped, [book, persona]), buttons, now);
      await this.ledger.writeJson(this.ledger.savePath(this.save, "reflexes.json"), book);
      const proven = provenAcrossSaves(await Promise.all((await this.ledger.saves()).map((save) => this.reflexBook(save))), persona);
      if (proven.length > 0) {
        persona.grown.push(...proven);
        await this.ledger.writeJson(this.ledger.savePath(PERSONA_SAVE, "reflexes.json"), persona);
        outcome.applied.push(...proven.map((entry) => `reflex ${entry.row.id} proved out in two saves and joins every save`));
      }
      return outcome;
    });
  }

  private reflexBook(save: string): Promise<ReflexBook> {
    return readReflexBook(this.ledger.savePath(save, "reflexes.json"));
  }

  /**
   * The persona-level learning trigger: a save lesson whose approach was
   * verified successful (marked `worked`) in two different saves is promoted
   * into the persona's own lesson store, so every save of this person starts
   * with it (the session-start note shows them under the existing cap).
   */
  private async promoteVerifiedLessons(now: Date): Promise<string[]> {
    const promoted: string[] = [];
    const held = new Set((await this.ledger.facts(PERSONA_SAVE)).map((lesson) => lessonKey(lesson.text)));
    const verified = new Map<string, { text: string; topic: string; saves: Set<string> }>();
    for (const save of await this.ledger.saves()) {
      for (const fact of await this.ledger.facts(save)) {
        if (fact.worked !== true) continue;
        const key = lessonKey(fact.text);
        const entry = verified.get(key) ?? { text: fact.text, topic: fact.topic, saves: new Set<string>() };
        entry.text = fact.text;
        entry.saves.add(save);
        verified.set(key, entry);
      }
    }
    for (const entry of verified.values()) {
      const key = lessonKey(entry.text);
      if (entry.saves.size < 2 || held.has(key)) continue;
      await this.ledger.learnFact(PERSONA_SAVE, entry.text, entry.topic, now);
      held.add(key);
      promoted.push(`promoted to your library (verified in ${entry.saves.size} saves): ${entry.text.slice(0, 60)}`);
    }
    return promoted;
  }
}
