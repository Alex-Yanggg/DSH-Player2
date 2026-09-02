/**
 * Package-owned composition invariants for the Player2 companion (P2-0012).
 *
 * Registered against DSH's `ctx.invariants` registry (optional seam: the
 * companion mounts unchanged when the deployment composes no registry) and
 * validated on the global `session/event` stream, so the checks follow the
 * official package-owned invariant idiom: pure stream validation with a
 * package-attributed `fail`, independent of any agent scope.
 *
 * The stream checks re-validate what the tool layer enforces — the growth
 * contract on `companion_reflect` calls and the proposal identity on
 * `game_request_action` calls — so a future execution-path regression cannot
 * silently let a malformed call reach Player validation.
 *
 * @module @dsh-player2/dsh-companion-plugin/invariants
 */
import type { Context } from "@deepseek-ai/cordis";
import type { InvariantInstaller } from "@deepseek-ai/dsh-invariants";
import { DECISION_TOOL_NAMES } from "./decision-loop.js";

/** The npm package name that owns the companion's invariant registration. */
export const COMPANION_PACKAGE_NAME = "@dsh-player2/dsh-companion-plugin";

const MAX_REFLECTION_INSIGHTS = 3;
const MAX_INSIGHT_LENGTH = 240;
const MAX_CITED_RECEIPTS = 8;
const MAX_FOCUS_LENGTH = 160;

/** Package-attributed failure reporter, mirrored from the kernel's installer type. */
type Fail = (message: string) => never;

/** Validates one model-authored reflect call against the growth contract. */
export function validateReflectArguments(args: unknown, fail: Fail): void {
  if (args === null || typeof args !== "object") {
    return fail("companion_reflect call arguments must be an object");
  }
  const { insights, focus } = args as { insights?: unknown; focus?: unknown };
  if (!Array.isArray(insights) || insights.length < 1 || insights.length > MAX_REFLECTION_INSIGHTS) {
    return fail(`companion_reflect call carries between 1 and ${MAX_REFLECTION_INSIGHTS} insights`);
  }
  for (const insight of insights) {
    if (insight === null || typeof insight !== "object") {
      return fail("every companion_reflect insight must be an object");
    }
    const { text, basedOnReceiptSequences } = insight as { text?: unknown; basedOnReceiptSequences?: unknown };
    if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_INSIGHT_LENGTH) {
      return fail(`a companion_reflect insight text must be 1..${MAX_INSIGHT_LENGTH} characters`);
    }
    if (
      !Array.isArray(basedOnReceiptSequences) ||
      basedOnReceiptSequences.length < 1 ||
      basedOnReceiptSequences.length > MAX_CITED_RECEIPTS ||
      !basedOnReceiptSequences.every((sequence): sequence is number => Number.isSafeInteger(sequence) && sequence > 0) ||
      new Set(basedOnReceiptSequences as number[]).size !== basedOnReceiptSequences.length
    ) {
      return fail(`a companion_reflect insight cites 1..${MAX_CITED_RECEIPTS} distinct positive receipt sequences`);
    }
  }
  if (focus !== undefined && focus !== null && (typeof focus !== "string" || focus.trim().length === 0 || focus.length > MAX_FOCUS_LENGTH)) {
    return fail(`the companion_reflect focus must be null or 1..${MAX_FOCUS_LENGTH} characters`);
  }
}

/** Validates one model-authored action order against the proposal identity contract. */
export function validateRequestActionArguments(args: unknown, fail: Fail): void {
  if (args === null || typeof args !== "object") {
    return fail("game_request_action call arguments must be an object");
  }
  const { sequence, proposalId } = args as { sequence?: unknown; proposalId?: unknown };
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
    return fail("game_request_action call carries a positive integer sequence");
  }
  if (proposalId !== `turn-${sequence}:proposal`) {
    return fail(`game_request_action proposalId must be the grounded proposal identity "turn-${sequence}:proposal"`);
  }
}

/**
 * Builds the invariant installer: global stream validation for the companion's
 * decision-tool call contract.
 */
export function createCompanionInvariantInstaller(): InvariantInstaller {
  const install = (ctx: Context, fail: Fail): void => {
    ctx.on("session/event", (_session, event) => {
      if (event.type !== "tool/call") {
        return;
      }
      const data = event.data as { name?: unknown; arguments?: unknown };
      if (data.name === DECISION_TOOL_NAMES.reflect) {
        validateReflectArguments(data.arguments, fail);
      }
      if (data.name === DECISION_TOOL_NAMES.requestAction) {
        validateRequestActionArguments(data.arguments, fail);
      }
    }, { global: true });
  };
  return install;
}
