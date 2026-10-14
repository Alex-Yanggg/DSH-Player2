import { z } from "zod";

/**
 * Goal lane (P2-0021). The player's explicit request is the authorization: a
 * goal the companion takes on runs without a consent dialogue, and the
 * persona decides how to pursue it. Engineering budgets only stop runaway
 * loops; they never constrain what the companion chooses to do.
 */
export const goalVersion = "0.1" as const;

/** Persona knobs, each 0..1. Dice decide "how often", the model decides "what". */
export const personaKnobsSchema = z.object({
  /** How often it speaks up on its own (0 quiet, 1 chatterbox). */
  talkativeness: z.number().min(0).max(1),
  /** How soon it considers asking the player for help when stuck. */
  helpSeeking: z.number().min(0).max(1),
  /** Appetite for risk (spending, danger, long detours). */
  risk: z.number().min(0).max(1),
  /** How literally it follows the player's instructions versus its own judgment. */
  obedience: z.number().min(0).max(1),
  /** Hands skill for reflexes: reaction delay and aim error. */
  skill: z.number().min(0).max(1),
});
export type PersonaKnobs = z.infer<typeof personaKnobsSchema>;

export const defaultPersonaKnobs: PersonaKnobs = { talkativeness: 0.5, helpSeeking: 0.5, risk: 0.5, obedience: 0.5, skill: 0.5 };

/** A goal operation the social lane read from the player's own words. */
export const goalOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), text: z.string().trim().min(1).max(400) }),
  z.object({ op: z.literal("stop") }),
]);
export type GoalOp = z.infer<typeof goalOpSchema>;

/** A spoken cheat switch read from the player's own words; only for the current save. */
export const cheatOpSchema = z.object({
  op: z.enum(["grant", "revoke"]),
  quote: z.string().trim().min(1).max(200),
});
export type CheatOp = z.infer<typeof cheatOpSchema>;

export const goalStatusValues = ["active", "done", "failed", "stopped", "budget-exceeded"] as const;
export const goalTerminalStatuses = new Set(["done", "failed", "stopped", "budget-exceeded"]);

/** Engineering loop budget (anti-runaway, not a limit on choices). */
export const goalBudgetSchema = z.object({
  maxTurns: z.number().int().positive(),
  maxToolCalls: z.number().int().positive(),
  maxGameDays: z.number().int().positive(),
});
export type GoalBudget = z.infer<typeof goalBudgetSchema>;

export const defaultGoalBudget: GoalBudget = { maxTurns: 40, maxToolCalls: 600, maxGameDays: 7 };

/** Host-owned goal record, `<session>/goal/current.json`. */
export const goalRecordSchema = z.object({
  version: z.literal(goalVersion),
  goalId: z.string().uuid(),
  text: z.string().min(1).max(400),
  status: z.enum(goalStatusValues),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Game day the goal started on (from the body state), when known. */
  startDay: z.number().int().positive().nullable(),
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  budget: goalBudgetSchema,
  /** The companion's own closing words, when it finished. */
  summary: z.string().max(800).nullable(),
  /** Short notes the companion keeps about its route, newest last. */
  notes: z.array(z.string().max(240)).max(24),
  /** Fixed dice seed for this goal; every roll is logged with it. */
  seed: z.string().min(1),
  /** The persona knobs the goal rolls its dice with. */
  knobs: personaKnobsSchema,
  /** Why the goal ended when the player or the budget ended it. */
  endReason: z.string().max(240).nullable(),
});
export type GoalRecord = z.infer<typeof goalRecordSchema>;

/** Mod -> host: the player's own stop command, `<session>/goal/interrupt-<ms>.json`. */
export const goalInterruptSchema = z.object({
  version: z.literal(goalVersion),
  at: z.string().datetime(),
  command: z.string().min(1).max(32),
});
export type GoalInterrupt = z.infer<typeof goalInterruptSchema>;

/** Spoken cheat grant for one save, `<session>/goal/cheat.json`. */
export const cheatGrantSchema = z.object({
  version: z.literal(goalVersion),
  granted: z.boolean(),
  at: z.string().datetime(),
  quote: z.string().max(200),
});
export type CheatGrant = z.infer<typeof cheatGrantSchema>;
