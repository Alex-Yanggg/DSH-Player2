/**
 * The Mind Core's optional fields on a social reply (P2-0016): which
 * remembered episodes the words relied on, and at most one new episode the
 * companion nominates for memory. Both are stripped before the reply is
 * written for the game, so the Player result contract does not change.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/turn-extras
 */
import type { EpisodeKind } from "@dsh-player2/contracts";

/** Episode kinds a chat turn may nominate; receipts only come from receipts. */
const NOMINABLE: ReadonlySet<string> = new Set(["utterance", "correction", "milestone", "shared-event"]);

export interface EpisodeNomination {
  readonly kind: Exclude<EpisodeKind, "receipt">;
  readonly summary: string;
  readonly salience: number;
  readonly valence: number;
}

export interface SocialTurnExtras {
  readonly cited: string[];
  readonly nomination: EpisodeNomination | null;
  /** Why a malformed nomination was dropped, for the trace; never fatal. */
  readonly droppedNomination: string | null;
}

/**
 * Read the extras from the raw reply object. Citing an episode the turn did
 * not carry is a false memory and fails the turn, exactly like citing an
 * unknown observation; a malformed nomination is only dropped.
 */
export function socialTurnExtras(raw: unknown, citable: ReadonlySet<string>): SocialTurnExtras {
  const reply = (typeof raw === "object" && raw !== null ? raw : {}) as { episodeIds?: unknown; remember?: unknown };
  const cited: string[] = [];
  if (reply.episodeIds !== undefined && reply.episodeIds !== null) {
    if (!Array.isArray(reply.episodeIds) || reply.episodeIds.some((id) => typeof id !== "string")) {
      throw new Error("DSH social response episodeIds must be an array of episode ids");
    }
    for (const id of reply.episodeIds as string[]) {
      if (!citable.has(id)) throw new Error(`DSH social response cited an episode it was not given: ${id}`);
      if (!cited.includes(id)) cited.push(id);
    }
  }
  if (reply.remember === undefined || reply.remember === null) return { cited, nomination: null, droppedNomination: null };
  const remember = reply.remember as { kind?: unknown; summary?: unknown; salience?: unknown; valence?: unknown };
  if (typeof remember !== "object" || typeof remember.kind !== "string" || !NOMINABLE.has(remember.kind)) {
    return { cited, nomination: null, droppedNomination: "remember.kind must be utterance, correction, milestone, or shared-event" };
  }
  if (typeof remember.summary !== "string" || remember.summary.trim() === "" || remember.summary.length > 240) {
    return { cited, nomination: null, droppedNomination: "remember.summary must be 1-240 characters" };
  }
  return {
    cited,
    nomination: {
      kind: remember.kind as EpisodeNomination["kind"],
      summary: remember.summary.trim(),
      salience: numberIn(remember.salience, 0, 1, 0.5),
      valence: numberIn(remember.valence, -1, 1, 0),
    },
    droppedNomination: null,
  };
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
