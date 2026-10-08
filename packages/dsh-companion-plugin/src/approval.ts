/**
 * The companion's autonomy tier as its in-session approval policy (P2-0012).
 *
 * DSH's `ctx.approval` seam resolves `ask` decisions through an answerer
 * waterfall that fails closed with no answerer. The companion registers one
 * answerer so the tier the player chose where the plugin is mounted stays the
 * only in-session authority:
 *
 * - `consult` (default): every ask about a companion-owned tool is rejected —
 *   the player's per-action consent lives in the game consent bridge, and no
 *   in-session answerer may speak for the player.
 * - `full`: the player's standing authorization allows companion-owned tools
 *   once per ask.
 * - Any other tool (composed by another plugin into the same agent) falls
 *   through to later answerers: autonomy never widens someone else's surface.
 *
 * @module @dsh-player2/dsh-companion-plugin/approval
 */
import type { ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import type { AutonomyMode } from "./autonomy.js";

/** The in-session decision for one ask, or undefined to defer to later answerers. */
export type CompanionAskDecision = ApprovalOutcome | undefined;

/**
 * Decide one approval ask for a companion composition. Pure and exported for
 * direct testing; the composition wraps it in the `approval/request` cascade.
 */
export function answerCompanionAsk(
  autonomy: AutonomyMode,
  toolName: string,
  companionTools: ReadonlySet<string>,
): CompanionAskDecision {
  if (!companionTools.has(toolName)) {
    return undefined;
  }
  return autonomy === "full" ? "allowed-once" : "rejected";
}
