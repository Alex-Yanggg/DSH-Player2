/**
 * The `remember` tool's argument check (P2-0016): at most one new episode
 * the companion nominates for memory per call. A malformed nomination is
 * refused with a reason the model can read; nothing is written.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/turn-extras
 */
import type { EpisodeKind } from "@dsh-player2/contracts";

/** Episode kinds a turn may nominate; receipts were only ever written by the old decision lane. */
export const NOMINABLE_KINDS = ["utterance", "correction", "milestone", "shared-event"] as const;

export interface EpisodeNomination {
  readonly kind: Exclude<EpisodeKind, "receipt">;
  readonly summary: string;
  readonly salience: number;
  readonly valence: number;
}

/** The nomination, or why it was refused. */
export function nominationOf(raw: unknown): EpisodeNomination | string {
  const remember = (typeof raw === "object" && raw !== null ? raw : {}) as { kind?: unknown; summary?: unknown; salience?: unknown; valence?: unknown };
  if (typeof remember.kind !== "string" || !(NOMINABLE_KINDS as readonly string[]).includes(remember.kind)) {
    return `kind must be one of ${NOMINABLE_KINDS.join(", ")}`;
  }
  if (typeof remember.summary !== "string" || remember.summary.trim() === "" || remember.summary.length > 240) {
    return "summary must be 1-240 characters";
  }
  return {
    kind: remember.kind as EpisodeNomination["kind"],
    summary: remember.summary.trim(),
    salience: numberIn(remember.salience, 0, 1, 0.5),
    valence: numberIn(remember.valence, -1, 1, 0),
  };
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
