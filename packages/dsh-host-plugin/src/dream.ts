/**
 * The dream lane's DSH-side helpers (P2-0014): the spine session id, the
 * persistence-backed spine store, the projected-timeline digest that is the
 * dream turn's only attention input, and the strict reply parser.
 */
import { createHash } from "node:crypto";
import { join, sep } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { SESSION_FORMAT_VERSION, SessionId } from "@deepseek-ai/dsh-session";
import type {
  DreamDraftInput,
  RelationshipState,
  SpineEvent,
  SpineStore,
} from "@dsh-player2/dsh-companion-plugin";

/** A stable spine session id for one person on one save, across all lanes. */
export function spineIdOf(root: string, session: string, presetId: string): string {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  const sessionRoot = session.startsWith(prefix) ? session.slice(prefix.length) : session;
  const digest = createHash("sha256").update(`${root}:${sessionRoot}:spine-v1:${presetId}`).digest("hex").slice(0, 16);
  return `player2-spine-${digest}`;
}

/**
 * The spine store over the app's session persistence service. The host
 * registers the spine header itself (`create` is a no-op here); a spine that
 * was registered but never appended to has no stored artifact yet, and an
 * empty log is the correct projection input for exactly that case.
 */
export function persistenceSpineStore(ctx: Context): SpineStore {
  return {
    create: async () => undefined,
    readFrom: async (id, fromSeq) => {
      try {
        const { events } = await ctx.sessionPersistence.readFrom(SessionId(id), fromSeq);
        return events.filter((event): event is SpineEvent => event.type.startsWith("companion/"));
      } catch (error) {
        if (messageOf(error).includes("not found")) return [];
        throw error;
      }
    },
    append: async (id, events) => {
      await ctx.sessionPersistence.append(SessionId(id), events);
    },
  };
}

/** The detached persistence header for one spine session. */
export function spineHeader(id: string): { version: number; id: ReturnType<typeof SessionId>; createdAt: number; cwd?: string } {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: Date.now() };
}

/**
 * Renders the projected relationship timeline as bounded prose. Receipts are
 * presented as facts with their sequence numbers — the only citation anchors
 * a dream growth proposal may use.
 */
export function relationshipDigest(state: RelationshipState, gameDay: number): string {
  const lines = [
    `GAME_DAY_ENDED=${gameDay}`,
    `APPLIED_GROWTH_REVISION=${state.growthRevision}`,
    `RECEIPTS(${state.receipts.length}):`,
    ...state.receipts.map((receipt) =>
      `- receipt #${receipt.sequence} ${receipt.status} (${receipt.capabilityId}, ${receipt.occurredAt})`),
    `PAST_DREAMS(${state.dreams.length}):`,
    ...state.dreams.map((dream) => `- dream #${dream.sequence} ${dream.outcome}`),
  ];
  return lines.join("\n");
}

/** Parses and shapes the dream reply; anything else fails the turn honestly. */
export function dreamOutcomeOf(text: string): DreamDraftInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("The dream turn did not end with the required JSON object.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The dream reply is not a JSON object.");
  }
  const kind = (parsed as { kind?: unknown }).kind;
  if (kind === "no-change") return { kind: "no-change" };
  if (kind !== "growth") {
    throw new Error('The dream reply kind must be "no-change" or "growth".');
  }
  const raw = parsed as { insights?: unknown; focus?: unknown };
  if (!Array.isArray(raw.insights)) {
    throw new Error("A dream growth reply requires an insights array.");
  }
  const insights = raw.insights.map((insight) => {
    const row = insight as { text?: unknown; basedOnReceiptSequences?: unknown };
    if (typeof row?.text !== "string" || !Array.isArray(row.basedOnReceiptSequences)) {
      throw new Error("Each dream insight requires text and basedOnReceiptSequences.");
    }
    return { text: row.text, basedOnReceiptSequences: row.basedOnReceiptSequences };
  });
  const focus = raw.focus === null || raw.focus === undefined ? null : raw.focus;
  if (focus !== null && typeof focus !== "string") {
    throw new Error("The dream focus must be a string or null.");
  }
  return { kind: "growth", insights, focus };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runtime state path for one spine's watermark file. */
export function spineStatePathOf(root: string, spineId: string): string {
  return join(root, "runtime", `spine-state-${spineId}.json`);
}
