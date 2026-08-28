import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  actionRequestSchema,
  decisionTurnEnvelopeSchema,
  decisionTurnVersion,
  proposalSchema,
  type ActionRequest,
  type DecisionTurnEnvelope,
  type Proposal,
} from "@dsh-player2/contracts";

/** Model-supplied fields from which Player2 constructs a proposal identity. */
export interface ProposalDraftInput {
  readonly capabilityId: string;
  readonly basedOnObservationIds: readonly string[];
  readonly target: string;
  readonly scope: string;
  readonly reason: string;
}

/** A fixed-path, write-once bridge between Player and one DSH decision composition. */
export class DecisionFileBridge {
  private readonly root: string;

  /**
   * @param bridgeDirectory - trusted deployment directory; model arguments never contribute paths.
   */
  public constructor(bridgeDirectory: string) {
    if (bridgeDirectory.trim().length === 0) {
      throw new Error("Decision mode requires a non-empty bridgeDirectory.");
    }
    this.root = resolve(bridgeDirectory);
  }

  /**
   * Read and validate one immutable Player-authored decision turn.
   * @param sequence - positive monotonic turn number.
   * @returns the validated envelope whose embedded sequence matches its fixed filename.
   */
  public async observe(sequence: number): Promise<DecisionTurnEnvelope> {
    this.assertSequence(sequence);
    const envelope = decisionTurnEnvelopeSchema.parse(await this.readJson(this.turnPath(sequence), "decision turn"));
    if (envelope.sequence !== sequence) {
      throw new Error(`Decision turn sequence ${envelope.sequence} does not match requested sequence ${sequence}.`);
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
    const observationIds = new Set(turn.observations.map((observation) => observation.id));
    const citedIds = [...input.basedOnObservationIds];
    if (citedIds.length === 0 || new Set(citedIds).size !== citedIds.length) {
      throw new Error("A proposal requires distinct cited observation ids.");
    }
    const unknownObservation = citedIds.find((id) => !observationIds.has(id));
    if (unknownObservation !== undefined) {
      throw new Error(`Proposal cited unknown observation ${JSON.stringify(unknownObservation)}.`);
    }
    if (!turn.adapter.capabilities.some((capability) => capability.id === input.capabilityId)) {
      throw new Error(`Proposal selected unknown capability ${JSON.stringify(input.capabilityId)}.`);
    }

    const proposal = proposalSchema.parse({
      id: this.proposalId(sequence),
      createdAt: turn.createdAt,
      basedOnObservationIds: citedIds,
      capabilityId: input.capabilityId,
      intent: { target: input.target },
      scope: input.scope,
      reason: input.reason,
    });
    return this.writeOnce(this.proposalPath(sequence), proposal, proposalSchema, "proposal");
  }

  /**
   * Promote the exact persisted proposal into an immutable request for Player consent.
   * @param sequence - decision turn owning the proposal.
   * @param proposalId - deterministic proposal id returned by {@link propose}.
   * @returns an awaiting-player request; this method never executes a game capability.
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
      status: "awaiting-player",
      proposal,
    });
    return this.writeOnce(this.requestPath(sequence), request, actionRequestSchema, "action request");
  }

  private async writeOnce<T>(
    path: string,
    value: T,
    schema: { parse(input: unknown): T },
    label: string,
  ): Promise<T> {
    await mkdir(dirname(path), { recursive: true });
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    try {
      await writeFile(path, serialized, { encoding: "utf8", flag: "wx" });
      return value;
    } catch (error) {
      if (!this.isAlreadyExists(error)) {
        throw error;
      }
    }
    const existing = schema.parse(await this.readJson(path, label));
    if (JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error(`Refusing to overwrite conflicting ${label} for this sequence.`);
    }
    return existing;
  }

  private async readJson(path: string, label: string): Promise<unknown> {
    let serialized: string;
    try {
      serialized = await readFile(path, "utf8");
    } catch (error) {
      if (this.isNotFound(error)) {
        throw new Error(`No ${label} exists for the requested sequence.`);
      }
      throw error;
    }
    try {
      return JSON.parse(serialized) as unknown;
    } catch {
      throw new Error(`The persisted ${label} is not valid JSON.`);
    }
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
