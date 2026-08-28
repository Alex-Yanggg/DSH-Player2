import {
  observationSchema,
  playerMessageSchema,
  receiptSchema,
  sharedOutcomeMemorySchema,
  socialResponseSchema,
  socialTurnTraceSchema,
  type ActionReceipt,
  type ConversationPolicy,
  type GameAdapter,
  type PlayerMessage,
  type SharedOutcomeMemory,
  type SocialPresenter,
  type SocialResponse,
  type SocialTurnTrace,
} from "@dsh-player2/contracts";

/** The game-facing subset needed for a social turn. It deliberately excludes execute(). */
export interface SocialTurnAdapter {
  readonly descriptor: GameAdapter["descriptor"];
  observe(request: { readonly kinds: readonly string[] }): Promise<readonly unknown[]>;
}

export interface SocialTurnRequest {
  readonly id: string;
  readonly gameDay: number;
  readonly message: PlayerMessage;
  readonly priorMemory: SharedOutcomeMemory | null;
  readonly latestReceipt: ActionReceipt | null;
}

export interface SocialTurnResult {
  readonly response: SocialResponse;
  readonly retainedMemory: SharedOutcomeMemory | null;
  readonly trace: SocialTurnTrace;
  readonly usedFallback: boolean;
}

export interface SocialTurnCoordinatorOptions {
  readonly now?: () => Date;
}

/**
 * Runs one free-text companion exchange against semantic observations only.
 *
 * It makes no adapter action available to a policy. Invalid or unavailable model output
 * becomes an explicit uncertainty response instead of a fabricated claim.
 */
export class SocialTurnCoordinator {
  private readonly now: () => Date;
  private readonly settledTurns = new Map<string, SocialTurnResult>();

  public constructor(options: SocialTurnCoordinatorOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  public async run(
    adapter: SocialTurnAdapter,
    presenter: SocialPresenter,
    policy: ConversationPolicy,
    request: SocialTurnRequest,
  ): Promise<SocialTurnResult> {
    const existing = this.settledTurns.get(request.message.id);
    if (existing !== undefined) {
      return existing;
    }

    playerMessageSchema.parse(request.message);
    this.assertPositiveGameDay(request.gameDay);
    const observedAt = this.now().toISOString();
    const observations = (await adapter.observe({ kinds: ["world", "action-result"] }))
      .map((entry) => observationSchema.parse(entry))
      .filter((observation) => observation.expiresAt === null || new Date(observation.expiresAt) > this.now());
    const priorMemory = this.getEligiblePriorMemory(request.priorMemory, request.gameDay);
    const latestReceipt = request.latestReceipt === null ? null : receiptSchema.parse(request.latestReceipt);
    const traceEvents: SocialTurnTrace["events"] = [
      { type: "observations", at: observedAt, observations },
      { type: "player-message", at: observedAt, message: request.message },
      { type: "latest-receipt", at: observedAt, receipt: latestReceipt },
    ];

    const attempted = await this.respondSafely(policy, {
      adapter: adapter.descriptor,
      gameDay: request.gameDay,
      observations,
      priorMemory,
      latestReceipt,
      message: request.message,
    });
    let response: SocialResponse;
    let usedFallback = false;

    try {
      response = socialResponseSchema.parse(attempted.response);
      this.validateGrounding(response, observations.map((observation) => observation.id), priorMemory, latestReceipt);
    } catch (error) {
      response = this.createUncertaintyResponse();
      usedFallback = true;
      traceEvents.push({ type: "policy-fallback", at: this.now().toISOString(), reason: this.errorReason(error) });
    }

    if (attempted.failureReason !== null) {
      usedFallback = true;
      traceEvents.push({ type: "policy-fallback", at: this.now().toISOString(), reason: attempted.failureReason });
    }

    const retainedMemory = this.createMemory(response, latestReceipt, request.gameDay);
    traceEvents.push({ type: "response", at: this.now().toISOString(), response });
    if (retainedMemory !== null) {
      traceEvents.push({ type: "memory-retained", at: this.now().toISOString(), memory: retainedMemory });
    }

    const result: SocialTurnResult = {
      response,
      retainedMemory,
      trace: socialTurnTraceSchema.parse({
        version: "0.0.2",
        id: request.id,
        gameDay: request.gameDay,
        messageId: request.message.id,
        events: traceEvents,
      }),
      usedFallback,
    };
    await presenter.presentSocial(result.response);
    this.settledTurns.set(request.message.id, result);
    return result;
  }

  private async respondSafely(
    policy: ConversationPolicy,
    context: Parameters<ConversationPolicy["respond"]>[0],
  ): Promise<{ response: unknown; failureReason: string | null }> {
    try {
      return { response: await policy.respond(context), failureReason: null };
    } catch (error) {
      return { response: this.createUncertaintyResponse(), failureReason: this.errorReason(error) };
    }
  }

  private getEligiblePriorMemory(memory: SharedOutcomeMemory | null, gameDay: number): SharedOutcomeMemory | null {
    if (memory === null) {
      return null;
    }

    const parsed = sharedOutcomeMemorySchema.parse(memory);
    return parsed.gameDay === gameDay - 1 ? parsed : null;
  }

  private validateGrounding(
    response: SocialResponse,
    observationIds: readonly string[],
    priorMemory: SharedOutcomeMemory | null,
    latestReceipt: ActionReceipt | null,
  ): void {
    const knownObservationIds = new Set(observationIds);
    if (response.basedOnObservationIds.some((id) => !knownObservationIds.has(id))) {
      throw new Error("The response cited an observation outside this turn.");
    }
    if (response.basedOnMemoryId !== (priorMemory?.id ?? null)) {
      throw new Error("The response cited unavailable memory.");
    }
    if (response.kind === "uncertain" && (response.basedOnObservationIds.length > 0 || response.basedOnMemoryId !== null)) {
      throw new Error("An uncertainty response cannot present evidence as certainty.");
    }
    if (response.rememberLatestReceipt && (latestReceipt === null || !this.isMemorableReceipt(latestReceipt))) {
      throw new Error("Only a completed or failed receipt can become shared memory.");
    }
  }

  private createMemory(
    response: SocialResponse,
    receipt: ActionReceipt | null,
    gameDay: number,
  ): SharedOutcomeMemory | null {
    if (!response.rememberLatestReceipt) {
      return null;
    }
    if (receipt === null || response.memorySummary === null || !this.isMemorableReceipt(receipt)) {
      throw new Error("Validated response was missing a memorable receipt.");
    }

    return sharedOutcomeMemorySchema.parse({
      id: `outcome:${receipt.proposalId}`,
      sourceProposalId: receipt.proposalId,
      gameDay,
      occurredAt: receipt.occurredAt,
      status: receipt.status,
      target: receipt.target,
      scope: receipt.scope,
      summary: response.memorySummary,
    });
  }

  private isMemorableReceipt(receipt: ActionReceipt): receipt is ActionReceipt & { status: "completed" | "failed" } {
    return receipt.status === "completed" || receipt.status === "failed";
  }

  private createUncertaintyResponse(): SocialResponse {
    return {
      kind: "uncertain",
      text: "I am not certain enough to answer that from what I can verify right now.",
      basedOnObservationIds: [],
      basedOnMemoryId: null,
      rememberLatestReceipt: false,
      memorySummary: null,
    };
  }

  private assertPositiveGameDay(gameDay: number): void {
    if (!Number.isInteger(gameDay) || gameDay < 1) {
      throw new Error("A social turn requires a positive integer game day.");
    }
  }

  private errorReason(error: unknown): string {
    return error instanceof Error ? error.message : "The policy failed without an error message.";
  }
}
