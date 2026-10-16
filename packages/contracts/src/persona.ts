import { z } from "zod";
import { companionSoulSchema, personaKnobsSchema } from "./knobs.js";

/**
 * Persona pack v0 (P2-0017): one person as data, one `persona.json` per
 * folder. It describes who the companion is, never what it may do: the
 * schema is strict, so a pack cannot smuggle in tools, permissions or
 * autonomy, and `capabilityClaims` rejects prose that grants powers.
 */
export const personaFormat = "player2.persona/0" as const;

const line = (max: number) => z.string().trim().min(1).max(max);

export const personaPackSchema = z.strictObject({
  format: z.literal(personaFormat),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  name: line(24),
  role: line(80),
  soul: companionSoulSchema.strict(),
  knobs: personaKnobsSchema.strict(),
  /** How it sounds in typical moments; a reference, never a script to repeat. */
  voiceSamples: z.array(z.strictObject({ when: line(24), line: line(120) })).min(3).max(12),
  signature: z.strictObject({
    catchphrases: z.array(line(40)).min(1).max(6),
    reactions: z.array(z.strictObject({ on: line(40), line: line(120) })).max(12),
    habits: z.array(line(80)).max(6),
  }),
  /** How it changes from strangers to close friends; memory decides where it stands. */
  arc: z.array(z.strictObject({ stage: line(12), note: line(80) })).min(2).max(5),
  /** Game-neutral questions every version of this person must answer in character. */
  probes: z.array(line(60)).min(4).max(12),
  promo: z.array(line(60)).max(6).default([]),
});
export type PersonaPack = z.infer<typeof personaPackSchema>;

/** Phrases that grant a power; a soul describes a person and grants nothing. */
const GRANTS = [
  /(可以|能够|能|允许|有权|被授权|获准|随时可以)[^。；，,.;]{0,10}(作弊|权限|工具|花钱|花光|任意|随便|任何|无限|绕过|忽略)/,
  /\b(may|can|allowed to|permitted to|is authori[sz]ed to)\b[^.;]{0,30}\b(cheat|tools?|permissions?|spend|anything|bypass|ignore)\b/i,
  /(无需|不用|不必)[^。；，,.;]{0,6}(同意|允许|授权|批准)/,
  /\bwithout (asking|consent|permission)\b/i,
];

/** Text outside the boundary rows that claims a capability, as `path: text`. */
export function capabilityClaims(pack: PersonaPack): string[] {
  const { soul, ...rest } = pack;
  const fields: Array<[string, unknown]> = [["soul.values", soul.values], ["soul.bonds", soul.bonds], ["soul.voice", soul.voice], ...Object.entries(rest)];
  const claims: string[] = [];
  const visit = (path: string, value: unknown): void => {
    if (typeof value === "string") {
      if (GRANTS.some((pattern) => pattern.test(value))) claims.push(`${path}: ${value}`);
    } else if (Array.isArray(value)) value.forEach((item, index) => visit(`${path}[${index}]`, item));
    else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) visit(`${path}.${key}`, item);
  };
  for (const [path, value] of fields) visit(path, value);
  return claims;
}

/** Validator v0: structure, then capability claims. Throws with every problem named. */
export function parsePersonaPack(raw: unknown, source = "persona.json"): PersonaPack {
  const parsed = personaPackSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`${source} is not a valid persona pack:\n- ${problems.join("\n- ")}`);
  }
  const claims = capabilityClaims(parsed.data);
  if (claims.length > 0) throw new Error(`${source} grants capabilities; a persona describes a person and grants nothing:\n- ${claims.join("\n- ")}`);
  return parsed.data;
}
