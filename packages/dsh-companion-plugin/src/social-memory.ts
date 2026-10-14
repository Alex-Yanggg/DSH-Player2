/**
 * The bounded memory note a fast social turn carries (P2-0015 T0.3).
 *
 * The fast chat composition skips the temperament pre-step, so this note is
 * how a chat reply still speaks from shared history: yesterday's citable
 * receipt-backed outcome, the newest receipt, and the applied growth asset.
 * It is rendered from the validated envelope only — no file reads on the
 * chat critical path — and never exceeds {@link socialMemoryNoteLimit}.
 *
 * @module @dsh-player2/dsh-companion-plugin/social-memory
 */
import { socialMemoryNoteLimit, type SocialBridgeTurn } from "@dsh-player2/contracts";

/** Marker prefix of the note; the policy tells the model how to read it. */
export const SOCIAL_MEMORY_TAG = "SOCIAL_MEMORY";

const LINE_TEXT_LIMIT = 160;

/**
 * Render the note for one social turn, or an empty string when the turn carries
 * no history. Lines are added most-citable first and dropped whole once the
 * next one would cross the limit, so the note is never cut mid-fact.
 */
export function socialMemoryNote(
  turn: Pick<SocialBridgeTurn, "priorMemory" | "latestReceipt" | "growth">,
  limit: number = socialMemoryNoteLimit,
): string {
  const lines: string[] = [];
  const memory = turn.priorMemory;
  if (memory !== null && memory !== undefined) {
    lines.push(`- yesterday [cite as basedOnMemoryId "${memory.id}"]: ${memory.status}, ${clip(memory.summary)}`);
  }
  const receipt = turn.latestReceipt;
  if (receipt !== null && receipt !== undefined && receipt.proposalId !== memory?.sourceProposalId) {
    // A receipt is never a memory id; only a completed or failed one may be remembered (rememberLatestReceipt).
    const rememberable = receipt.status === "completed" || receipt.status === "failed";
    lines.push(`- latest receipt: ${receipt.status} ${receipt.capabilityId}, ${clip(receipt.detail)} [not citable; ${rememberable ? "may be remembered" : "do not remember"}]`);
  }
  const growth = turn.growth;
  if (growth !== null && growth !== undefined) {
    if (growth.focus !== null && growth.focus.trim() !== "") lines.push(`- your focus: ${clip(growth.focus)}`);
    for (const insight of [...growth.insights].reverse()) lines.push(`- you learned: ${clip(insight.text)}`);
  }
  if (lines.length === 0) return "";
  // Without a yesterday line nothing is citable; saying so stops the model from citing a receipt's proposal id,
  // which the validator rejects on every later turn of the save.
  const header = memory !== null && memory !== undefined
    ? `${SOCIAL_MEMORY_TAG} (shared history, never current facts; only the yesterday id is citable):`
    : `${SOCIAL_MEMORY_TAG} (shared history, never current facts; nothing here is citable, so basedOnMemoryId must be null):`;
  let note = header;
  for (const line of lines) {
    if (note.length + 1 + line.length > limit) break;
    note = `${note}\n${line}`;
  }
  return note === header ? "" : note;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LINE_TEXT_LIMIT ? `${flat.slice(0, LINE_TEXT_LIMIT - 1)}…` : flat;
}
