/**
 * Mind Core (P2-0016 W1 "one mind"): the façade the DSH host calls around
 * each lane turn. Before a turn it ingests new receipts, migrates growth,
 * retrieves episodes, and renders the MindContext note; after a turn it
 * validates citations, stores the nominated episode, moves the mood, and
 * records why. Everything is local file work beside the bridge project.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/core
 */
import type { DecisionTurnEnvelope, DreamRequest, Episode, Observation, SocialBridgeTurn } from "@dsh-player2/contracts";
import { applyLedgerEdits, dreamEpisodes, ledgerDigest, parseLedgerEdits, type LedgerEditOutcome } from "./dream-ledger.js";
import { writeLedgerExport } from "./export.js";
import { PersonaLedger, type WhyRecord } from "./ledger.js";
import { citableEpisodeIds, isWhyQuestion, mindContextNote } from "./mind-context.js";
import { describeMood, type MoodEvent } from "./mood.js";
import { retrieveEpisodes, type EpisodeSelector, type RetrievedEpisode } from "./retrieval.js";
import type { SocialTurnExtras } from "./turn-extras.js";

/** What a lane turn was given, kept until the turn commits. */
export interface PreparedMind {
  readonly note: string;
  readonly citable: ReadonlySet<string>;
  readonly retrieved: readonly RetrievedEpisode[];
  readonly mood: string;
  /** Receipts skipped as unreadable while ingesting, for the trace. */
  readonly skippedReceipts: number;
}

/** What a dream was shown, kept until its reply is applied. */
export interface PreparedDream {
  readonly digest: string;
  readonly shown: readonly Episode[];
  /** The game this save's experience belongs to (dream requests carry no adapter). */
  readonly game: string;
}

/** The game assumed for a save with no experience yet. */
export const DEFAULT_GAME = "stardew-valley";

export class MindCore {
  public readonly ledger: PersonaLedger;
  public readonly save: string;

  /**
   * @param select the episode selector; the default is Player2's thin
   * flavor-cue pick, replaceable by a DSH-side recall.
   */
  public constructor(private readonly session: string, private readonly select: EpisodeSelector = retrieveEpisodes) {
    const located = PersonaLedger.forSession(session);
    this.ledger = located.ledger;
    this.save = located.save;
  }

  /** Before a social or day-start turn. */
  public async prepareSocial(turn: SocialBridgeTurn, now: Date): Promise<PreparedMind> {
    const game = turn.adapter.gameId;
    const ingest = await this.catchUp(game, turn.gameDay, now);
    if (turn.occasion === "day-start") await this.ledger.applyMood(this.save, [{ kind: "day-start" }], now);
    const { episodes } = await this.ledger.episodes(this.save);
    const asksWhy = turn.occasion !== "day-start" && isWhyQuestion(turn.message.content);
    const query = [turn.occasion === "day-start" ? "" : turn.message.content, observationText(turn.observations)].join(" ");
    const retrieved = this.select(episodes.filter((episode) => episode.game === game), { text: query, gameDay: turn.gameDay, now });
    let why: { record: WhyRecord; episodes: Episode[] } | null = null;
    if (asksWhy) {
      const record = await this.ledger.lastWhy(this.save);
      if (record !== null) {
        const ids = new Set([...record.cited, ...record.retrieved]);
        why = { record, episodes: episodes.filter((episode) => ids.has(episode.id)) };
      }
    }
    const [mood, story, person] = await Promise.all([this.ledger.mood(this.save, now), this.ledger.story(this.save), this.ledger.person()]);
    const note = mindContextNote({
      game, mood, story, traits: person.traits, retrieved, why,
      omitTraitTexts: (turn.growth?.insights ?? []).map((insight) => insight.text),
    });
    return { note, citable: citableEpisodeIds({ retrieved, why }), retrieved, mood: describeMood(mood), skippedReceipts: ingest };
  }

  /**
   * After a social turn produced a valid reply whose extras were already
   * checked with {@link socialTurnExtras} (a false citation fails the turn
   * before anything is written): store the nomination, move the mood, and
   * record why.
   */
  public async commitSocial(turn: SocialBridgeTurn, extras: SocialTurnExtras, replyText: string, prepared: PreparedMind, now: Date): Promise<SocialTurnExtras> {
    const events: MoodEvent[] = turn.occasion === "day-start" ? [] : [{ kind: "chat" }];
    if (extras.nomination !== null) {
      await this.ledger.appendEpisodes(this.save, [{
        at: now.toISOString(), gameDay: turn.gameDay, game: turn.adapter.gameId,
        kind: extras.nomination.kind, summary: extras.nomination.summary,
        salience: extras.nomination.salience, valence: extras.nomination.valence,
        refs: [`social:${turn.id}`],
      }]);
      events.push({ kind: "episode", valence: extras.nomination.valence, episodeKind: extras.nomination.kind });
    }
    if (events.length > 0) await this.ledger.applyMood(this.save, events, now);
    await this.ledger.recordWhy(this.save, {
      turnId: turn.id, at: now.toISOString(), reply: replyText,
      retrieved: prepared.retrieved.map((item) => item.episode.id), cited: extras.cited, mood: prepared.mood,
    });
    return extras;
  }

  /** Before a decision turn: the same mind, without citations (proposals cite observations only). */
  public async prepareDecision(turn: DecisionTurnEnvelope, now: Date): Promise<PreparedMind> {
    const game = turn.adapter.gameId;
    const ingest = await this.catchUp(game, turn.gameDay, now);
    const { episodes } = await this.ledger.episodes(this.save);
    const retrieved = this.select(episodes.filter((episode) => episode.game === game), { text: observationText(turn.observations), gameDay: turn.gameDay, now, limit: 2 });
    const [mood, story, person] = await Promise.all([this.ledger.mood(this.save, now), this.ledger.story(this.save), this.ledger.person()]);
    const note = mindContextNote({ game, mood, story, traits: person.traits, retrieved, omitTraitTexts: (turn.growth?.insights ?? []).map((insight) => insight.text) });
    return { note, citable: new Set(), retrieved, mood: describeMood(mood), skippedReceipts: ingest };
  }

  /** Before a dream: today's episodes, traits, and story as the ledger half of the input. */
  public async prepareDream(request: DreamRequest, now: Date): Promise<PreparedDream> {
    const before = await this.ledger.episodes(this.save);
    const game = before.episodes.at(-1)?.game ?? DEFAULT_GAME;
    await this.catchUp(game, request.gameDay, now);
    const [{ episodes }, story, person] = await Promise.all([this.ledger.episodes(this.save), this.ledger.story(this.save), this.ledger.person()]);
    const shown = dreamEpisodes(episodes, request.gameDay);
    return { digest: ledgerDigest(shown, person.traits, story), shown, game };
  }

  /** After a dream: validate and apply its optional ledger edits, then refresh the export. */
  public async commitDream(request: DreamRequest, raw: unknown, prepared: PreparedDream, now: Date): Promise<LedgerEditOutcome | null> {
    const edits = parseLedgerEdits(raw);
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
    await writeLedgerExport(this.ledger, request.companion.name, now);
    return outcome;
  }

  /** Ingest new receipts and migrate growth; returns skipped receipt count. */
  private async catchUp(game: string, gameDay: number, now: Date): Promise<number> {
    const { skipped } = await this.ledger.ingestReceipts(this.session, this.save, game, gameDay, now);
    await this.ledger.migrateGrowth(this.session, this.save, now);
    return skipped;
  }
}

/** Flatten observation facts into retrieval text (kinds and scalar values). */
export function observationText(observations: readonly Observation[]): string {
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") parts.push(String(value));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
  };
  for (const observation of observations) {
    parts.push(observation.kind);
    walk(observation.facts);
  }
  return parts.join(" ").slice(0, 2_000);
}
