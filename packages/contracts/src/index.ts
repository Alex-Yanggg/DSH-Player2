import { z } from "zod";

/**
 * Player2's own data shapes: the companion's soul, its persona knobs, the
 * Persona Ledger, and the game body's state wire. Turns, goals, tools and
 * logs are DSH's own (acp profile); nothing here duplicates them.
 */

/**
 * Persona Ledger (P2-0016 W1). One ledger per companion person, kept by the
 * DSH-side Mind Core beside the bridge project: experience (episodes), the
 * narrative of "our story", slowly changing traits, and a four-scalar mood.
 * Every entry is local, player-readable, exportable, and deletable. The
 * ledger is memory, never authority: nothing in it is a current observation,
 * grants a capability, or rewrites the soul.
 */
export const ledgerVersion = "0.1" as const;

export const episodeKindSchema = z.enum(["shared-event", "utterance", "receipt", "correction", "milestone"]);
export type EpisodeKind = z.infer<typeof episodeKindSchema>;

/** One remembered experience; append-only, bounded per save. */
export const episodeSchema = z.object({
  id: z.string().regex(/^ep-[0-9a-f]{12}$/),
  at: z.string().datetime(),
  gameDay: z.number().int().positive().nullable(),
  game: z.string().min(1),
  save: z.string().min(1),
  kind: episodeKindSchema,
  summary: z.string().trim().min(1).max(240),
  salience: z.number().min(0).max(1),
  valence: z.number().min(-1).max(1),
  /** Provenance anchors, such as `receipt:12` or `social:<turn id>`. */
  refs: z.array(z.string().min(1).max(120)).max(8),
});
export type Episode = z.infer<typeof episodeSchema>;

/** One slowly changing tendency, always backed by episode evidence. */
export const traitSchema = z.object({
  id: z.string().regex(/^tr-[0-9a-f]{12}$/),
  text: z.string().trim().min(1).max(160),
  evidence: z.array(z.string().min(1)).min(1).max(16),
  confidence: z.number().min(0).max(1),
  /** `person` travels across games; `game:<id>` stays with one game. */
  scope: z.string().regex(/^(person|game:[a-z0-9-]+)$/),
  status: z.enum(["active", "candidate", "retired"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Trait = z.infer<typeof traitSchema>;

/** Deterministic, decaying affect; it colours tone, it is not a persona claim. */
export const moodSchema = z.object({
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  energy: z.number().min(0).max(1),
  closeness: z.number().min(0).max(1),
  updatedAt: z.string().datetime(),
});
export type Mood = z.infer<typeof moodSchema>;

/** The dream-rewritten narrative of one save, injected into every lane. */
export const storySchema = z.object({
  revision: z.number().int().nonnegative(),
  text: z.string().max(600),
  basedOnEpisodeIds: z.array(z.string().min(1)).max(40),
  updatedAt: z.string().datetime(),
});
export type Story = z.infer<typeof storySchema>;

/** The person-level ledger file: traits plus bookkeeping. */
export const personLedgerSchema = z.object({
  version: z.literal(ledgerVersion),
  traits: z.array(traitSchema).max(64),
});
export type PersonLedger = z.infer<typeof personLedgerSchema>;

export * from "./body.js";
export * from "./knobs.js";
export * from "./persona.js";
export * from "./reflex.js";
