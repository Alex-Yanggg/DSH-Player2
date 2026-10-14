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
import { applyLedgerEdits, dreamEpisodes, ledgerDigest, parseLedgerEdits, type LedgerEditOutcome } from "./dream-ledger.js";
import { writeLedgerExport } from "./export.js";
import { PersonaLedger, type WhyRecord } from "./ledger.js";
import { isWhyQuestion, mindContextNote } from "./mind-context.js";
import { describeMood, type MoodEvent } from "./mood.js";
import { retrieveEpisodes, type EpisodeSelector, type RetrievedEpisode } from "./retrieval.js";
import type { EpisodeNomination } from "./turn-extras.js";

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

  /** After a chat or day-start turn: move the mood and record why the reply was said. */
  public async commitTurn(occasion: "chat" | "day-start", turnId: string, replyText: string, prepared: PreparedMind, now: Date): Promise<void> {
    const events: MoodEvent[] = occasion === "chat" ? [{ kind: "chat" }] : [];
    if (events.length > 0) await this.ledger.applyMood(this.save, events, now);
    await this.ledger.recordWhy(this.save, {
      turnId, at: now.toISOString(), reply: replyText,
      retrieved: prepared.retrieved.map((item) => item.episode.id), cited: [], mood: prepared.mood,
    });
  }

  /** Before a dream: the day's episodes, traits, and story. */
  public async prepareDream(gameDay: number | null): Promise<PreparedDream> {
    const [{ episodes }, story, person] = await Promise.all([this.ledger.episodes(this.save), this.ledger.story(this.save), this.ledger.person()]);
    const game = episodes.at(-1)?.game ?? DEFAULT_GAME;
    const shown = dreamEpisodes(episodes, gameDay ?? episodes.at(-1)?.gameDay ?? 0);
    return { digest: ledgerDigest(shown, person.traits, story), shown, game };
  }

  /** A dream's ledger edits (the `dream_commit` arguments): validate, apply, refresh the export. */
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
      }
    }
    await writeLedgerExport(this.ledger, companionName, now);
    return outcome;
  }
}
