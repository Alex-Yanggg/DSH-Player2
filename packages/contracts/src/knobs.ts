import { z } from "zod";

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
