/**
 * The companion autonomy switch (P2-0011).
 *
 * Two tiers only: `consult` keeps the proposal → consent → execute chain,
 * `full` lets the character order grounded executions without per-action
 * consent — the Player host still performs every action through the game
 * adapter and writes every receipt afterwards. The tier is chosen where the
 * plugin is mounted (the DSH composition/preset settings page), never inferred
 * from turn data, and an invalid value must fail the mount loudly instead of
 * silently degrading to another tier.
 *
 * @module autonomy
 */

/** Autonomy tier of one companion composition. */
export type AutonomyMode = "consult" | "full";

export const AUTONOMY_MODES: readonly AutonomyMode[] = ["consult", "full"];

/** The autonomy scopes in shadowing order: agent wins over preset wins over global. */
export interface AutonomyScopeInput {
  /** Composition/agent-level choice from the plugin settings page. Empty means "not set here". */
  readonly agent?: string | undefined;
  /** Recommendation carried by the companion role (preset) directory. Empty means "no recommendation". */
  readonly preset?: string | undefined;
  /** Deployment-wide fallback. Empty means the built-in default. */
  readonly global?: string | undefined;
}

function parseMode(value: string | undefined, origin: string): AutonomyMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }
  if ((AUTONOMY_MODES as readonly string[]).includes(normalized)) {
    return normalized as AutonomyMode;
  }
  throw new Error(
    `companion.autonomy at the ${origin} scope must be "consult" or "full"; got ${JSON.stringify(value)}. ` +
      "Refusing to mount the companion with a guessed autonomy tier.",
  );
}

/**
 * Resolve the effective autonomy tier with nearest-scope shadowing.
 *
 * Every scope that carries a value is validated first, so an invalid value
 * fails the mount even when a nearer scope would have shadowed it: the
 * companion must never silently start as a different kind of companion than
 * configured.
 */
export function resolveAutonomy(scopes: AutonomyScopeInput): AutonomyMode {
  const agent = parseMode(scopes.agent, "agent");
  const preset = parseMode(scopes.preset, "preset");
  const global = parseMode(scopes.global, "global");
  return agent ?? preset ?? global ?? "consult";
}
