/**
 * L3 mood (P2-0016): four deterministic scalars that colour tone. Events
 * move them by fixed rules and wall-clock time decays them toward a resting
 * baseline, so the same line of evidence reads differently on a good day
 * and a bad one without any model inventing feelings.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/mood
 */
import type { Mood } from "@dsh-player2/contracts";

type Scalar = "valence" | "arousal" | "energy" | "closeness";

/** Resting values each scalar decays toward. */
const BASELINE: Readonly<Record<Scalar, number>> = { valence: 0.1, arousal: 0.2, energy: 0.6, closeness: 0.3 };
/** Half-lives in wall-clock minutes: excitement fades fast, closeness slowly. */
const HALF_LIFE_MINUTES: Readonly<Record<Scalar, number>> = { valence: 90, arousal: 20, energy: 240, closeness: 60 * 24 * 7 };

/** The things that move a mood. */
export type MoodEvent =
  | { readonly kind: "receipt"; readonly status: "completed" | "failed" | "declined" | "expired" }
  | { readonly kind: "chat" }
  | { readonly kind: "day-start" }
  | { readonly kind: "episode"; readonly valence: number; readonly episodeKind: string };

const DELTAS: Readonly<Record<string, Partial<Record<Scalar, number>>>> = {
  "receipt:completed": { valence: 0.25, arousal: 0.15, closeness: 0.06 },
  "receipt:failed": { valence: -0.2, arousal: 0.2 },
  "receipt:declined": { valence: -0.05, closeness: -0.03 },
  "receipt:expired": { closeness: -0.03 },
  chat: { arousal: 0.08, closeness: 0.02, energy: -0.01 },
  correction: { valence: -0.05, arousal: 0.05, closeness: 0.02 },
};

/** A fresh mood at its resting baseline. */
export function restingMood(now: Date): Mood {
  return { ...BASELINE, updatedAt: now.toISOString() };
}

/** Decay a mood to `now`; never moves backwards in time. */
export function decayMood(mood: Mood, now: Date): Mood {
  const minutes = Math.max(0, (now.getTime() - Date.parse(mood.updatedAt)) / 60_000);
  if (minutes === 0) return mood;
  const next: Mood = { ...mood, updatedAt: now.toISOString() };
  for (const scalar of Object.keys(BASELINE) as Scalar[]) {
    const keep = 0.5 ** (minutes / HALF_LIFE_MINUTES[scalar]);
    next[scalar] = round(BASELINE[scalar] + (mood[scalar] - BASELINE[scalar]) * keep);
  }
  return next;
}

/** Apply one event after decaying to `now`. Pure and deterministic. */
export function applyMoodEvent(mood: Mood, event: MoodEvent, now: Date): Mood {
  const next = { ...decayMood(mood, now) };
  if (event.kind === "day-start") {
    // A night's sleep: rested, settled, yesterday's sting mostly gone.
    next.energy = 0.85;
    next.arousal = BASELINE.arousal;
    next.valence = round((next.valence + BASELINE.valence) / 2);
    return clampMood(next);
  }
  const key = event.kind === "receipt" ? `receipt:${event.status}`
    : event.kind === "episode" && event.episodeKind === "correction" ? "correction"
    : event.kind;
  for (const [scalar, delta] of Object.entries(DELTAS[key] ?? {}) as [Scalar, number][]) next[scalar] += delta;
  if (event.kind === "episode") next.valence += 0.2 * event.valence;
  return clampMood(next);
}

/** One short, stable English line for the prompt; bands, not raw numbers. */
export function describeMood(mood: Mood): string {
  const valence = mood.valence >= 0.45 ? "happy" : mood.valence >= 0.15 ? "content" : mood.valence > -0.15 ? "neutral" : mood.valence > -0.45 ? "a bit down" : "upset";
  const arousal = mood.arousal >= 0.6 ? "excited" : mood.arousal >= 0.3 ? "lively" : "calm";
  const energy = mood.energy >= 0.7 ? "well rested" : mood.energy >= 0.4 ? "steady" : "tired";
  const closeness = mood.closeness >= 0.65 ? "very close to the player" : mood.closeness >= 0.35 ? "comfortable with the player" : "still getting to know the player";
  return `${valence}, ${arousal}, ${energy}, ${closeness}`;
}

function clampMood(mood: Mood): Mood {
  return {
    valence: round(Math.min(1, Math.max(-1, mood.valence))),
    arousal: round(Math.min(1, Math.max(0, mood.arousal))),
    energy: round(Math.min(1, Math.max(0, mood.energy))),
    closeness: round(Math.min(1, Math.max(0, mood.closeness))),
    updatedAt: mood.updatedAt,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
