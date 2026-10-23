import { z } from "zod";
import { bodyInputStepSchema, bodyUntilSchema } from "./body.js";

/**
 * The reflex tier's per-game data (P2-0019 T1): a tiny table of interrupts
 * evaluated against the raw body state between and during body calls. A row
 * says only "when these raw facts hold, play this raw input burst, and tell
 * the mind what fired". Rows are data: nothing here knows a goal, a route, or
 * what anything is for; the plugin-side engine maps `when` over the exported
 * state and plays `do` through the same body port the mind uses.
 */
export const reflexTableVersion = "1" as const;

/** One raw-state fact the engine can test without game knowledge. */
export const reflexConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("healthBelow"), value: z.number().min(1).max(1000) }),
  z.object({ kind: z.literal("staminaBelow"), value: z.number().min(1).max(1000) }),
  /** A monster of the body's location within this many tiles. */
  z.object({ kind: z.literal("monsterWithin"), tiles: z.number().min(0).max(20) }),
  /** The body holds an item matching category and/or name substring. */
  z.object({ kind: z.literal("hasItem"), category: z.string().min(1).max(40).optional(), name: z.string().min(1).max(80).optional() }),
  /** A movement task is running but the body has not moved for this long (ms). */
  z.object({ kind: z.literal("stuckFor"), ms: z.number().int().min(200).max(20_000) }),
]);
export type ReflexCondition = z.infer<typeof reflexConditionSchema>;

/** The item matcher shared by conditions and bursts. */
const itemMatchSchema = z.object({ category: z.string().min(1).max(40).optional(), name: z.string().min(1).max(80).optional() });

/**
 * One raw input burst. Button ids inside `steps` are the game's own; the
 * engine only supplies what raw state knows: selecting a matching toolbar
 * slot, facing the nearest monster, or holding the direction away from it
 * (through the declaration's movement-role buttons).
 */
export const reflexBurstSchema = z.discriminatedUnion("kind", [
  /** Play these steps verbatim (an unstick wiggle, a taunt). */
  z.object({ kind: z.literal("steps"), steps: z.array(bodyInputStepSchema).min(1).max(16) }),
  /** Select the first matching toolbar slot, then play these steps (eat: the use button). */
  z.object({ kind: z.literal("useItem"), match: itemMatchSchema, steps: z.array(bodyInputStepSchema).min(1).max(16) }),
  /** Face the nearest monster (and optionally select a matching slot), then play these steps (a weapon swing). */
  z.object({ kind: z.literal("swingAtMonster"), match: itemMatchSchema.optional(), steps: z.array(bodyInputStepSchema).min(1).max(16) }),
  /** Hold the direction away from the nearest monster for this long. */
  z.object({ kind: z.literal("stepAway"), ms: z.number().int().min(50).max(2000) }),
]);
export type ReflexBurst = z.infer<typeof reflexBurstSchema>;

export const reflexRowSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  when: z.object({ all: z.array(reflexConditionSchema).min(1).max(6), none: z.array(reflexConditionSchema).max(6).optional() }),
  do: reflexBurstSchema,
  /** Not this row again for this long after it fired. */
  cooldownMs: z.number().int().min(100).max(60_000).optional(),
  /** The fact the mind receives; {health} {stamina} {item} {monster} {distance} are filled in. */
  fact: z.string().min(3).max(200),
});
export type ReflexRow = z.infer<typeof reflexRowSchema>;

export const reflexTableSchema = z.object({
  version: z.literal(reflexTableVersion),
  game: z.string().min(1).max(64),
  rows: z.array(reflexRowSchema).min(1).max(24),
});
export type ReflexTable = z.infer<typeof reflexTableSchema>;

/** Parses and validates one table; an invalid table is an error, never a silent empty table. */
export function parseReflexTable(value: unknown): ReflexTable {
  return reflexTableSchema.parse(value);
}
