import { randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  actionRequestSchema,
  autonomousStatus,
  awaitingPlayerStatus,
  bridgeFileLimit,
  decisionTurnEnvelopeSchema,
  decisionTurnVersion,
  growthProposalSchema,
  proposalSchema,
  type ActionRequest,
  type AutonomyMode,
  type DecisionTurnEnvelope,
  type GrowthProposal,
  type Proposal,
} from "@dsh-player2/contracts";
import { collectReceiptDigest, type ReceiptDigest, type ReceiptDigestEntry } from "./memory/receipt-digest.js";
import type { SpineTimeline } from "./spine.js";

const MAX_CITED_OBSERVATIONS = 8;
const MAX_TARGET_LENGTH = 256;
const MAX_SCOPE_LENGTH = 400;
const MAX_REASON_LENGTH = 800;
const MAX_UTTERANCE_LENGTH = 800;
const MAX_REFLECTION_INSIGHTS = 3;
const MAX_INSIGHT_LENGTH = 240;
const MAX_CITED_RECEIPTS = 8;
const MAX_FOCUS_LENGTH = 160;

export type { ReceiptDigest, ReceiptDigestEntry } from "./memory/receipt-digest.js";

/** Model-supplied fields from which Player2 constructs a proposal identity. */
export interface ProposalDraftInput {
  readonly capabilityId: string;
  readonly basedOnObservationIds: readonly string[];
  readonly target: string;
  readonly scope: string;
  readonly reason: string;
  readonly utterance: string;
}

/** Model-supplied fields of one bounded self-reflection about shared history. */
export interface ReflectDraftInput {
  readonly insights: ReadonlyArray<{
    readonly text: string;
    readonly basedOnReceiptSequences: readonly number[];
  }>;
  readonly focus: string | null;
}

/** A fixed-path, write-once bridge between Player and one DSH decision composition. */
export class DecisionFileBridge {
  private readonly root: string;
  private readonly autonomy: AutonomyMode;
  private readonly spine?: SpineTimeline;

  /**
   * @param bridgeDirectory - trusted deployment directory; model arguments never contribute paths.
   * @param autonomy - the composition's resolved autonomy tier; consult keeps the consent flow.
   * @param spine - optional P2-0014 watermark projection; when present, bridge
   *   I/O also records reference events on the companion event spine.
   */
  public constructor(bridgeDirectory: string, autonomy: AutonomyMode = "consult", spine?: SpineTimeline) {
    if (bridgeDirectory.trim().length === 0) {
      throw new Error("Decision mode requires a non-empty bridgeDirectory.");
    }
    this.root = resolve(bridgeDirectory);
    this.autonomy = autonomy;
    this.spine = spine;
  }

  /**
   * Read and validate one immutable Player-authored decision turn.
   * @param sequence - positive monotonic turn number.
   * @returns the validated envelope whose embedded sequence matches its fixed filename.
   */
  public async observe(sequence: number): Promise<DecisionTurnEnvelope> {
    this.assertSequence(sequence);
    const parsed = decisionTurnEnvelopeSchema.safeParse(await this.readJson(this.turnPath(sequence), "decision turn"));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `The persisted decision turn does not match the bridge contract at "${issue.path.join(".") || "(root)"}": ${issue.message}. ` +
        "If the SMAPI mod was built at a different time than this plugin, rebuild and redeploy the mod so both bridge sides share one contract, then start a new game day.",
      );
    }
    const envelope = parsed.data;
    if (envelope.sequence !== sequence) {
      throw new Error(`Decision turn sequence ${envelope.sequence} does not match requested sequence ${sequence}.`);
    }
    if (this.spine !== undefined) {
      await this.spine.hydrate();
      if (envelope.growth !== undefined && envelope.growth.revision > this.spine.snapshot().growthRevision) {
        await this.spine.record("companion/growth-applied", { sequence: envelope.sequence, revision: envelope.growth.revision });
      }
    }
    return envelope;
  }

  /**
   * Validate cited facts and capability, then persist one deterministic proposal without overwrite.
   * @param sequence - decision turn owning this proposal.
   * @param input - bounded model-authored proposal fields.
   * @returns the newly written or byte-equivalent existing proposal.
   */
  public async propose(sequence: number, input: ProposalDraftInput): Promise<Proposal> {
    const turn = await this.observe(sequence);
    const target = this.boundedText(input.target, "target", MAX_TARGET_LENGTH);
    const scope = this.boundedText(input.scope, "scope", MAX_SCOPE_LENGTH);
    const reason = this.boundedText(input.reason, "reason", MAX_REASON_LENGTH);
    const utterance = this.boundedText(input.utterance, "utterance", MAX_UTTERANCE_LENGTH);
    const observationIds = new Set(turn.observations.map((observation) => observation.id));
    const citedIds = [...input.basedOnObservationIds];
    if (citedIds.length > MAX_CITED_OBSERVATIONS) {
      throw new Error(`A proposal may cite at most ${MAX_CITED_OBSERVATIONS} observations.`);
    }
    if (citedIds.length === 0 || new Set(citedIds).size !== citedIds.length) {
      throw new Error("A proposal requires distinct cited observation ids.");
    }
    const unknownObservation = citedIds.find((id) => !observationIds.has(id));
    if (unknownObservation !== undefined) {
      throw new Error(`Proposal cited unknown observation ${JSON.stringify(unknownObservation)}.`);
    }
    const capability = turn.adapter.capabilities.find((candidate) => candidate.id === input.capabilityId);
    if (capability === undefined) {
      throw new Error(`Proposal selected unknown capability ${JSON.stringify(input.capabilityId)}.`);
    }
    if (input.scope !== capability.scope) {
      throw new Error(
        `Proposal scope must copy the advertised capability scope verbatim: ${JSON.stringify(capability.scope)}.`);
    }
    const world = turn.observations.find((observation) => observation.kind === "world");
    const locationDisplayName = world?.facts.locationDisplayName;
    if (typeof locationDisplayName !== "string" || locationDisplayName.trim().length === 0) {
      throw new Error("The world observation is missing its player-facing locationDisplayName.");
    }
    if (!utterance.includes(locationDisplayName)) {
      throw new Error(`Companion speech must naturally name the observed game location ${JSON.stringify(locationDisplayName)}.`);
    }
    if (utterance.includes(target) || this.containsTargetCoordinates(utterance, target)) {
      throw new Error("Companion speech must not expose the machine target or tile coordinates to the player.");
    }

    const proposal = proposalSchema.parse({
      id: this.proposalId(sequence),
      createdAt: turn.createdAt,
      basedOnObservationIds: citedIds,
      capabilityId: input.capabilityId,
      intent: { target },
      scope,
      reason,
      utterance,
    });
    return this.writeOnce(this.proposalPath(sequence), proposal, proposalSchema, "proposal");
  }

  private containsTargetCoordinates(utterance: string, target: string): boolean {
    const match = /:tile:(\d+),(\d+)$/.exec(target);
    if (match === null) return false;
    const [, x, y] = match;
    return utterance.includes(`${x},${y}`) ||
      utterance.includes(`${x}, ${y}`) ||
      utterance.includes(`${x}，${y}`);
  }

  /**
   * Promote the exact persisted proposal into an immutable bridge order.
   *
   * Consult tier: an awaiting-player request that waits for Player consent.
   * Full tier: an autonomous order the Player host executes directly. Neither
   * form ever executes a game capability from this side.
   *
   * @param sequence - decision turn owning the proposal.
   * @param proposalId - deterministic proposal id returned by {@link propose}.
   */
  public async requestAction(sequence: number, proposalId: string): Promise<ActionRequest> {
    this.assertSequence(sequence);
    const expectedId = this.proposalId(sequence);
    if (proposalId !== expectedId) {
      throw new Error(`Action request expected proposal ${JSON.stringify(expectedId)}.`);
    }
    const proposal = proposalSchema.parse(await this.readJson(this.proposalPath(sequence), "proposal"));
    if (proposal.id !== expectedId) {
      throw new Error(`Persisted proposal id ${JSON.stringify(proposal.id)} does not match sequence ${sequence}.`);
    }
    const request = actionRequestSchema.parse({
      version: decisionTurnVersion,
      sequence,
      status: this.autonomy === "full" ? autonomousStatus : awaitingPlayerStatus,
      proposal,
    });
    return this.writeOnce(this.requestPath(sequence), request, actionRequestSchema, "action request");
  }

  /**
   * Project the newest persisted receipts into a bounded read-only digest via
   * the receipt-memory module. Entries are historical context: they are never
   * current observations and never grant authority.
   */
  public async recall(): Promise<ReceiptDigest> {
    const digest = await collectReceiptDigest(
      () => readdir(join(this.root, "receipts")).catch((error: unknown) => {
        if (this.isNotFound(error)) {
          return [] as string[];
        }
        throw error;
      }),
      async (name) => this.readJson(join(this.root, "receipts", name), "receipt"),
    );
    if (this.spine !== undefined) {
      // Receipts stay the fact source; the spine only records that one entered
      // the relationship timeline, so the dream lane never rescans this
      // directory for attention.
      await this.spine.hydrate();
      const known = new Set(this.spine.snapshot().receipts.map((receipt) => receipt.sequence));
      for (const entry of digest.entries) {
        if (!known.has(entry.sequence)) {
          await this.spine.record("companion/receipt-observed", {
            sequence: entry.sequence,
            proposalId: entry.proposalId,
            capabilityId: entry.capabilityId,
            status: entry.status,
            occurredAt: entry.occurredAt,
          });
        }
      }
    }
    return digest;
  }

  /**
   * Persist one write-once self-reflection for this turn: bounded insights
   * that must cite receipt sequences the recall digest actually returned, plus
   * an optional self-chosen focus. The proposal is data for Player validation
   * and application to the Player-owned growth asset — it never changes this
   * companion's soul, tools, or authority, and it never executes anything.
   *
   * @param sequence - decision turn owning this reflection.
   * @param input - bounded model-authored reflection fields.
   * @returns the newly written or byte-equivalent existing growth proposal.
   */
  public async reflect(sequence: number, input: ReflectDraftInput): Promise<GrowthProposal> {
    this.assertSequence(sequence);
    if (input.insights.length === 0 || input.insights.length > MAX_REFLECTION_INSIGHTS) {
      throw new Error(
        `A growth proposal requires between 1 and ${MAX_REFLECTION_INSIGHTS} insights.`);
    }
    const digest = await this.recall();
    const recalledSequences = new Set(digest.entries.map((entry) => entry.sequence));
    const insights = input.insights.map((insight) => ({
      text: this.boundedText(insight.text, "insight text", MAX_INSIGHT_LENGTH),
      basedOnReceiptSequences: this.citedReceiptSequences(insight.basedOnReceiptSequences, recalledSequences),
    }));
    const focus = input.focus === null || input.focus === undefined
      ? null
      : this.boundedText(input.focus, "focus", MAX_FOCUS_LENGTH);
    const proposal = growthProposalSchema.parse({
      version: decisionTurnVersion,
      sequence,
      insights,
      focus,
    });
    const written = await this.writeOnce(this.growthPath(sequence), proposal, growthProposalSchema, "growth proposal");
    if (this.spine !== undefined) {
      await this.spine.hydrate();
      await this.spine.record("companion/reflection-proposed", { sequence, source: "reflect" });
    }
    return written;
  }

  /** Validates that cited receipt sequences are distinct and were actually recalled. */
  private citedReceiptSequences(cited: readonly number[], recalled: ReadonlySet<number>): number[] {
    if (cited.length === 0 || cited.length > MAX_CITED_RECEIPTS || new Set(cited).size !== cited.length) {
      throw new Error(
        `Each insight requires distinct cited receipt sequences, at most ${MAX_CITED_RECEIPTS}.`);
    }
    const unknown = cited.find((sequence) => !recalled.has(sequence));
    if (unknown !== undefined) {
      throw new Error(
        `Growth insight cited receipt sequence ${unknown}, which companion_recall did not return this turn. ` +
        "Growth must stay grounded in recalled shared outcomes.");
    }
    return [...cited];
  }

  private async writeOnce<T>(
    path: string,
    value: T,
    schema: { parse(input: unknown): T },
    label: string,
  ): Promise<T> {
    await mkdir(dirname(path), { recursive: true });
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporaryPath, "wx");
      try {
        await handle.writeFile(serialized, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporaryPath, path);
        return value;
      } catch (error) {
        if (!this.isAlreadyExists(error)) {
          throw error;
        }
      }
    } finally {
      await unlink(temporaryPath).catch((error: unknown) => {
        if (!this.isNotFound(error)) {
          throw error;
        }
      });
    }
    const existing = schema.parse(await this.readJson(path, label));
    if (JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error(`Refusing to overwrite conflicting ${label} for this sequence.`);
    }
    return existing;
  }

  private async readJson(path: string, label: string): Promise<unknown> {
    let handle;
    try {
      handle = await open(path, "r");
    } catch (error) {
      if (this.isNotFound(error)) {
        throw new Error(`No ${label} exists for the requested sequence.`);
      }
      throw error;
    }
    let serialized: string;
    try {
      const stats = await handle.stat();
      if (stats.size > bridgeFileLimit) {
        throw new Error(`The persisted ${label} exceeds the ${bridgeFileLimit} byte limit.`);
      }
      const buffer = Buffer.alloc(bridgeFileLimit + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) {
          break;
        }
        offset += bytesRead;
      }
      if (offset > bridgeFileLimit) {
        throw new Error(`The persisted ${label} exceeds the ${bridgeFileLimit} byte limit.`);
      }
      serialized = buffer.subarray(0, offset).toString("utf8");
    } finally {
      await handle.close();
    }
    try {
      return JSON.parse(serialized) as unknown;
    } catch {
      throw new Error(`The persisted ${label} is not valid JSON.`);
    }
  }

  private boundedText(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new Error(`A proposal requires a non-empty ${label}.`);
    }
    if (normalized.length > maxLength) {
      throw new Error(`A proposal ${label} may contain at most ${maxLength} characters.`);
    }
    return normalized;
  }

  private turnPath(sequence: number): string {
    return resolve(this.root, "inbox", `turn-${sequence}.json`);
  }

  private proposalPath(sequence: number): string {
    return resolve(this.root, "drafts", `proposal-${sequence}.json`);
  }

  private requestPath(sequence: number): string {
    return resolve(this.root, "outbox", `request-${sequence}.json`);
  }

  private growthPath(sequence: number): string {
    return resolve(this.root, "outbox", `growth-${sequence}.json`);
  }

  private proposalId(sequence: number): string {
    return `turn-${sequence}:proposal`;
  }

  private assertSequence(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("Decision sequence must be a positive safe integer.");
    }
  }

  private isAlreadyExists(error: unknown): boolean {
    return this.errorCode(error) === "EEXIST";
  }

  private isNotFound(error: unknown): boolean {
    return this.errorCode(error) === "ENOENT";
  }

  private errorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  }
}
