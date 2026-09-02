/**
 * Temperament-layer checkpoints for one companion composition: pre-step
 * attention, pre-execute reflection, and turn-stopping closure.
 *
 * These are the third and fourth personality layers the bridge previously
 * lacked. Everything here is an enhancement layered over the wire contract:
 * hook failures fail open (the decision files remain the sole authority), and
 * every injected message is bounded data addressed to the model, never a
 * hidden instruction channel.
 *
 * @module @dsh-player2/dsh-companion-plugin/temperament
 */
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  socialResponseSchema,
  socialBridgeTurnSchema,
  type DecisionTurnEnvelope,
  type SocialBridgeTurn,
} from "@dsh-player2/contracts";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import type { DecisionFileBridge } from "./decision-file-bridge.js";
import { DECISION_TOOL_NAMES } from "./decision-loop.js";
import { bridgeFileLimit } from "@dsh-player2/contracts";
import { collectReceiptDigest, type ReceiptDigest, type ReceiptDigestEntry } from "./memory/receipt-digest.js";

/** Marker prefix of the model-facing attention message injected before a turn. */
export const TEMPERAMENT_ATTENTION_TAG = "TEMPERAMENT_ATTENTION";

/** Reflections per turn before the temperament stops objecting to a close. */
export const MAX_STOP_REFLECTIONS = 2;

const ATTENTION_MAX_CHARS = 1800;
const ATTENTION_DETAIL_MAX_CHARS = 160;
const ATTENTION_KEEP_TURNS = 32;

/** One recalled receipt annotated with its relation to the current turn. */
export interface ScoredReceipt {
  readonly entry: ReceiptDigestEntry;
  /** True when the receipt's target touches a target the current turn mentions. */
  readonly related: boolean;
}

/** What one first step message revealed about the turn being entered. */
export type TurnReference =
  | { readonly lane: "decision"; readonly sequence: number }
  | { readonly lane: "social"; readonly envelope: SocialBridgeTurn };

/** Read-only view the temperament needs from the composition. */
export interface TemperamentDeps {
  readonly mode: "social" | "decision";
  readonly bridgeDirectory: string;
  /** Decision-lane bridge; present exactly when mode is "decision". */
  readonly bridge?: DecisionFileBridge;
}

/** Shared mutable state of one composition's temperament checkpoints. */
export interface TemperamentState {
  /** Turn number of the step currently entering; maintained by pre-step. */
  currentTurn: number;
  /** Turn number -> the turn reference its first step advertised. */
  readonly attendedTurns: Map<number, TurnReference>;
  /** Turn number -> reflections already steered for it. */
  readonly stopReflections: Map<number, number>;
  /** Per-turn sets of sequences observed and proposed through the guard. */
  readonly observed: Map<number, Set<number>>;
  readonly proposed: Map<number, Set<number>>;
}

export function createTemperamentState(): TemperamentState {
  return { currentTurn: -1, attendedTurns: new Map(), stopReflections: new Map(), observed: new Map(), proposed: new Map() };
}

/** Extracts the text of one model-facing message defensively. */
export function messageText(message: UserMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block !== null && typeof block === "object" && "text" in block ? String((block as { text?: unknown }).text ?? "") : ""))
    .join("\n");
}

/**
 * Reads the turn marker the host embeds in a first step message.
 * Decision prompts embed `{version, sequence}`; social prompts embed the full
 * validated envelope, which is re-validated here before any use.
 */
export function extractTurnReference(text: string): TurnReference | null {
  const decision = /PLAYER_DECISION_TURN=(\{[\s\S]*\})/.exec(text);
  if (decision !== null) {
    try {
      const parsed = JSON.parse(decision[1]) as { sequence?: unknown };
      if (typeof parsed.sequence === "number" && Number.isSafeInteger(parsed.sequence) && parsed.sequence > 0) {
        return { lane: "decision", sequence: parsed.sequence };
      }
    } catch {
      // Fall through to the social marker; neither marker matching is fatal.
    }
  }
  const social = /PLAYER_SOCIAL_TURN=(\{[\s\S]*\})/.exec(text);
  if (social !== null) {
    try {
      const parsed = socialBridgeTurnSchema.safeParse(JSON.parse(social[1]));
      if (parsed.success) return { lane: "social", envelope: parsed.data };
    } catch {
      // Unparseable turn data is the host's problem, not attention's.
    }
  }
  return null;
}

/** Collects the semantic targets the current turn actually mentions. */
export function collectEnvelopeTargets(envelope: {
  observations: readonly { facts?: unknown }[];
  priorMemory?: { target?: unknown } | null;
  latestReceipt?: { target?: unknown } | null;
}): string[] {
  const targets = new Set<string>();
  for (const observation of envelope.observations) {
    const facts = observation.facts;
    const target = facts !== null && typeof facts === "object" && "target" in facts
      ? (facts as { target?: unknown }).target
      : undefined;
    if (typeof target === "string" && target.trim() !== "") targets.add(target.trim());
  }
  for (const memory of [envelope.priorMemory, envelope.latestReceipt]) {
    const target = memory?.target;
    if (typeof target === "string" && target.trim() !== "") targets.add(target.trim());
  }
  return [...targets];
}

/**
 * Ranks recalled receipts against the current turn's targets. Exact target
 * matches outrank shared location prefixes; ties keep the newest-first order
 * the digest already produced. Pure and stable.
 */
export function scoreReceipts(entries: readonly ReceiptDigestEntry[], targets: readonly string[]): ScoredReceipt[] {
  const prefixes = targets
    .map((target) => target.split(":").slice(0, 2).join(":"))
    .filter((prefix) => prefix.length > 0);
  return entries
    .map((entry) => {
      if (entry.target !== null && targets.includes(entry.target)) return { entry, related: true, score: 2 };
      if (entry.target !== null && prefixes.some((prefix) => entry.target!.startsWith(prefix))) return { entry, related: true, score: 1 };
      return { entry, related: false, score: 0 };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ entry, related }) => ({ entry, related }));
}

/** Renders the bounded attention message body injected ahead of a turn. */
export function buildAttentionBlock(input: { entries: readonly ScoredReceipt[]; maxChars?: number }): string {
  const max = input.maxChars ?? ATTENTION_MAX_CHARS;
  const header = `${TEMPERAMENT_ATTENTION_TAG}: receipt-backed memories worth weighing this turn (history, never current facts; never citable as observation ids):`;
  const footer = "Weigh what these outcomes imply for continuity, then ground this turn in the fresh observations only.";
  const lines: string[] = [header];
  let size = header.length + footer.length + 1;
  for (const { entry, related } of input.entries) {
    const line =
      `- ${related ? "[related] " : ""}seq ${entry.sequence} ${entry.status} ${entry.capabilityId}` +
      ` @ ${entry.target ?? "(no target)"}: ${truncate(entry.detail, ATTENTION_DETAIL_MAX_CHARS)}`;
    if (size + line.length + 1 > max) break;
    lines.push(line);
    size += line.length + 1;
  }
  lines.push(footer);
  return lines.join("\n");
}

/** Pure pre-execute reflection: denies consequential calls that skip a grounding step. */
export function reflectOnToolCall(state: TemperamentState, turn: number, name: string, args: unknown): string | undefined {
  const sequence = readSequence(args);
  if (sequence === null) return undefined;
  if (name === DECISION_TOOL_NAMES.propose) {
    const observed = state.observed.get(turn);
    if (observed === undefined || !observed.has(sequence)) {
      return `Reflection before acting: ground this proposal first — call ${DECISION_TOOL_NAMES.observe} for sequence ${sequence} before ${DECISION_TOOL_NAMES.propose}.`;
    }
    return undefined;
  }
  if (name === DECISION_TOOL_NAMES.requestAction) {
    const proposed = state.proposed.get(turn);
    if (proposed === undefined || !proposed.has(sequence)) {
      return `Reflection before acting: sequence ${sequence} has no grounded proposal this turn. Call ${DECISION_TOOL_NAMES.propose} first, or close the turn without ordering an action when the facts do not support one.`;
    }
    return undefined;
  }
  return undefined;
}

/** Records one successful grounding tool call so later reflections can pass. */
export function recordToolSuccess(state: TemperamentState, turn: number, name: string, args: unknown): void {
  const sequence = readSequence(args);
  if (sequence === null) return;
  if (name === DECISION_TOOL_NAMES.observe) {
    pushToSet(state.observed, turn, sequence);
  }
  if (name === DECISION_TOOL_NAMES.propose) {
    pushToSet(state.proposed, turn, sequence);
  }
}

/** The corrective steer message when a decision turn closes without its order. */
export function decisionStopReflection(sequence: number): string {
  return [
    `Temperament reflection: this turn is closing without a completion order for sequence ${sequence}.`,
    `If your proposal still stands, call ${DECISION_TOOL_NAMES.requestAction} with its proposal id now.`,
    "If the facts do not support an action, you may close without one — say so explicitly in your final message instead of stopping silently.",
  ].join(" ");
}

/** The corrective steer message when a social turn would end without structured output. */
export function socialStopReflection(): string {
  return "Temperament reflection: your final message must be exactly the JSON object the companion skill requires (kind, text, basedOnObservationIds, basedOnMemoryId, rememberLatestReceipt, memorySummary), with no prose fence.";
}

function readSequence(args: unknown): number | null {
  if (args !== null && typeof args === "object" && "sequence" in args) {
    const sequence = (args as { sequence?: unknown }).sequence;
    if (typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > 0) return sequence;
  }
  return null;
}

function pushToSet(map: Map<number, Set<number>>, turn: number, sequence: number): void {
  let set = map.get(turn);
  if (set === undefined) {
    set = new Set();
    map.set(turn, set);
  }
  set.add(sequence);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function pruneKeys(map: Map<number, unknown>, keep: number): void {
  while (map.size > keep) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

async function exists(path: string): Promise<boolean> {
  const handle = await open(path, "r").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (handle === null) return false;
  await handle.close();
  return true;
}

async function readJsonBounded(path: string): Promise<unknown> {
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    if (stats.size > bridgeFileLimit) throw new Error(`receipt exceeds the ${bridgeFileLimit} byte limit`);
    const buffer = Buffer.alloc(bridgeFileLimit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > bridgeFileLimit) throw new Error(`receipt exceeds the ${bridgeFileLimit} byte limit`);
    return JSON.parse(buffer.subarray(0, offset).toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}

/** Social-lane receipt digest read directly from the bridge receipts directory. */
async function recallSocialReceipts(bridgeDirectory: string): Promise<ReceiptDigest> {
  return collectReceiptDigest(
    () => readdir(join(bridgeDirectory, "receipts")).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
      throw error;
    }),
    (name) => readJsonBounded(join(bridgeDirectory, "receipts", name)),
  );
}

function attentionMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });
}

function lastAssistantText(events: readonly { type: string; data: unknown }[]): string | null {
  let text: string | null = null;
  for (const event of events) {
    if (event.type !== "assistant/message") continue;
    const content = (event.data as { message?: { content?: { type: string; text?: string }[] } }).message?.content ?? [];
    const candidate = content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
    if (candidate !== "") text = candidate;
  }
  return text;
}

/**
 * Builds the four temperament checkpoint handlers over one shared state.
 * Handlers never throw: an internal failure logs and leaves the step, call,
 * or turn boundary exactly as the machine proposed it.
 */
export function createTemperamentHandlers(deps: TemperamentDeps, state = createTemperamentState()) {
  const recall = async (reference: TurnReference): Promise<ReceiptDigest> => {
    if (reference.lane === "decision" && deps.bridge !== undefined) return deps.bridge.recall();
    return recallSocialReceipts(deps.bridgeDirectory);
  };
  const currentTargets = async (reference: TurnReference): Promise<string[]> => {
    if (reference.lane === "decision") {
      if (deps.bridge === undefined) return [];
      const envelope: DecisionTurnEnvelope = await deps.bridge.observe(reference.sequence);
      return collectEnvelopeTargets({ observations: envelope.observations, priorMemory: null, latestReceipt: null });
    }
    return collectEnvelopeTargets(reference.envelope);
  };

  return {
    state,
    async preStep(
      payload: { turn: number; messages: UserMessage[] },
      next: () => Promise<{ kind: "reject" } | { kind: "enter"; messages: UserMessage[] }>,
    ): Promise<{ kind: "reject" } | { kind: "enter"; messages: UserMessage[] }> {
      state.currentTurn = payload.turn;
      const decision = await next();
      try {
        if (decision.kind !== "enter" || state.attendedTurns.has(payload.turn)) return decision;
        const reference = extractTurnReference(payload.messages.map(messageText).join("\n"));
        if (reference === null) return decision;
        const [digest, targets] = await Promise.all([recall(reference), currentTargets(reference)]);
        const block = buildAttentionBlock({ entries: scoreReceipts(digest.entries, targets) });
        state.attendedTurns.set(payload.turn, reference);
        pruneKeys(state.attendedTurns, ATTENTION_KEEP_TURNS);
        return { kind: "enter", messages: [attentionMessage(block), ...decision.messages] };
      } catch (error) {
        console.error(`player2-companion: temperament pre-step failed: ${messageOf(error)}`);
        return decision;
      }
    },
    toolGuard(name: string, args: unknown): string | undefined {
      try {
        return reflectOnToolCall(state, state.currentTurn, name, args);
      } catch {
        return undefined;
      }
    },
    recordToolSuccess(name: string, args: unknown): void {
      try {
        recordToolSuccess(state, state.currentTurn, name, args);
      } catch {
        // Bookkeeping only; never let it break dispatch.
      }
    },
    async turnStopping(payload: { turn: number; agent: { steer(message: UserMessage): void; session: { events: readonly { type: string; data: unknown }[] } } }): Promise<void> {
      try {
        const reference = state.attendedTurns.get(payload.turn);
        if (reference === undefined) return;
        const attempts = state.stopReflections.get(payload.turn) ?? 0;
        if (attempts >= MAX_STOP_REFLECTIONS) return;
        if (reference.lane === "decision") {
          if (await exists(join(deps.bridgeDirectory, "outbox", `request-${reference.sequence}.json`))) return;
          state.stopReflections.set(payload.turn, attempts + 1);
          payload.agent.steer(attentionMessage(decisionStopReflection(reference.sequence)));
          return;
        }
        const text = lastAssistantText(payload.agent.session.events);
        if (text === null) return;
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          parsed = null;
        }
        if (parsed !== null && socialResponseSchema.safeParse(parsed).success) return;
        state.stopReflections.set(payload.turn, attempts + 1);
        payload.agent.steer(attentionMessage(socialStopReflection()));
      } catch (error) {
        console.error(`player2-companion: temperament turn-stopping failed: ${messageOf(error)}`);
      }
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
