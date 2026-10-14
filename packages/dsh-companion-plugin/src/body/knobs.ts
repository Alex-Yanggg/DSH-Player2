import { createHash } from "node:crypto";
import type { PersonaKnobs } from "@dsh-player2/contracts";

/**
 * Persona knobs and dice (P2-0021 T21.6, D18). Hard randomness only decides
 * "does this turn consider doing X" (speak up after a step, ask for help when
 * stuck, follow the wording closely or bring its own judgment, take the bolder
 * option). What to say and how stays with the model and the persona. Failure
 * and blockage are reported unconditionally; no die is ever rolled for them.
 * Every roll uses a fixed seed, so a run can be replayed.
 */

export type KnobName = keyof PersonaKnobs;

export interface DiceRoll {
  readonly seed: string;
  readonly turn: number;
  readonly knob: KnobName;
  readonly question: string;
  readonly p: number;
  readonly roll: number;
  readonly yes: boolean;
}

/** Deterministic uniform [0, 1) for (seed, turn, label). */
export function seededUniform(seed: string, turn: number, label: string): number {
  const digest = createHash("sha256").update(`${seed}\u0000${turn}\u0000${label}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

/** The probability a knob value maps to for one question; 0.5 is the neutral middle. */
export function probability(knob: number, floor = 0.05, ceiling = 0.95): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(knob) ? knob : 0.5));
  return floor + (ceiling - floor) * clamped;
}

export class PersonaDice {
  public constructor(
    private readonly knobs: PersonaKnobs,
    private readonly seed: string,
  ) {}

  /** Rolls one "consider doing it this turn?" question for a knob. */
  public async roll(turn: number, knob: KnobName, question: string, invert = false): Promise<DiceRoll> {
    const p = probability(invert ? 1 - this.knobs[knob] : this.knobs[knob]);
    const roll = seededUniform(this.seed, turn, `${knob}:${question}`);
    return { seed: this.seed, turn, knob, question, p, roll, yes: roll < p };
  }

  /** Reaction delay and aim error for reflex scripts, from the skill knob. */
  public hands(): { reactionMs: number; aimError: number } {
    const skill = Math.min(1, Math.max(0, this.knobs.skill));
    return { reactionMs: Math.round(450 - 390 * skill), aimError: 0.3 - 0.28 * skill };
  }
}

/** The persona's standing tendencies, as words in the system prompt. */
export function tendencyLines(knobs: PersonaKnobs): string[] {
  const band = (value: number, low: string, mid: string, high: string) => value < 0.35 ? low : value > 0.65 ? high : mid;
  return [
    `Talkativeness ${knobs.talkativeness.toFixed(2)}: ${band(knobs.talkativeness, "you are quiet while working", "you chat now and then", "you are a chatterbox")}.`,
    `Help-seeking ${knobs.helpSeeking.toFixed(2)}: ${band(knobs.helpSeeking, "you prefer to figure things out alone", "you ask when it clearly helps", "you readily ask the player")}.`,
    `Risk ${knobs.risk.toFixed(2)}: ${band(knobs.risk, "you play it safe", "you take measured risks", "you go for bold moves")}.`,
    `Obedience ${knobs.obedience.toFixed(2)}: ${band(knobs.obedience, "you follow your own judgment more than the exact wording", "you balance the player's wording and your judgment", "you follow the player's instructions to the letter")}.`,
    `Skill ${knobs.skill.toFixed(2)}: ${band(knobs.skill, "your hands are clumsy", "your hands are average", "your hands are sharp")}.`,
  ];
}

/** This turn's dice nudges, added before the turn's messages. */
export async function turnNudges(dice: PersonaDice, turn: number, stuck: boolean): Promise<string[]> {
  const nudges: string[] = [];
  const talk = await dice.roll(turn, "talkativeness", "speak-up");
  nudges.push(talk.yes
    ? "This turn, consider saying a line to the player if something fits your persona."
    : "This turn, there is no need to chat; speak only if something important happens.");
  const obey = await dice.roll(turn, "obedience", "own-initiative", true);
  nudges.push(obey.yes
    ? "This turn, feel free to use your own judgment about how to reach the goal, even beyond the player's exact wording."
    : "This turn, stay close to what the player actually asked.");
  const bold = await dice.roll(turn, "risk", "bolder-option");
  if (bold.yes) nudges.push("This turn, consider the bolder or faster option if one exists.");
  if (stuck) {
    const help = await dice.roll(turn, "helpSeeking", "ask-for-help");
    nudges.push(help.yes
      ? "You seem stuck. Consider asking the player for help or advice, in your own words."
      : "You seem stuck. Try another approach on your own first.");
  }
  return nudges;
}
