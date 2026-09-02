import {
  permissionGrantSchema,
  proposalSchema,
  receiptSchema,
  type ActionReceipt,
  type AutonomyMode,
  type DecisionPolicy,
  type GameAdapter,
  type PermissionGrant,
  type Proposal,
} from "@dsh-player2/contracts";

export {
  SocialTurnCoordinator,
  type SocialTurnAdapter,
  type SocialTurnCoordinatorOptions,
  type SocialTurnRequest,
  type SocialTurnResult,
} from "./social-turn-coordinator.js";
export { RuleConversationPolicy } from "./rule-conversation-policy.js";
export { DshConversationPolicy, type DshTextRunner } from "./dsh-conversation-policy.js";

export interface TurnCoordinatorOptions {
  now?: () => Date;
  /**
   * Autonomy tier of the coordinator. `consult` (default) settles proposals
   * only with a matching player grant. `full` additionally offers
   * {@link TurnCoordinator.settleAutonomously}, which executes grounded
   * proposals without a player answer and marks every artifact it produces.
   */
  autonomy?: AutonomyMode;
}

/** Coordinates observation, decision, permission, execution, and receipt across game adapters. */
export class TurnCoordinator {
  private readonly now: () => Date;
  private readonly autonomy: AutonomyMode;

  public constructor(options: TurnCoordinatorOptions = {}) {
    this.now = options.now ?? (() => new Date());
    if (options.autonomy !== undefined && options.autonomy !== "consult" && options.autonomy !== "full") {
      throw new Error(`companion.autonomy must be "consult" or "full"; got ${JSON.stringify(options.autonomy)}.`);
    }
    this.autonomy = options.autonomy ?? "consult";
  }

  public async createProposal(adapter: GameAdapter, policy: DecisionPolicy): Promise<Proposal | null> {
    const observations = await adapter.observe({ kinds: [] });
    const proposal = await policy.decide({ adapter: adapter.descriptor, observations });

    return proposal === null ? null : proposalSchema.parse(proposal);
  }

  public async settleProposal(
    adapter: GameAdapter,
    proposal: Proposal,
    grant: PermissionGrant,
  ): Promise<ActionReceipt> {
    permissionGrantSchema.parse(grant);

    if (grant.proposalId !== proposal.id) {
      throw new Error("Permission grant does not belong to the proposal.");
    }

    if (!grant.granted) {
      return this.createTerminalReceipt(proposal, "declined", "The player declined this proposal.");
    }

    if (new Date(grant.expiresAt) <= this.now()) {
      return this.createTerminalReceipt(proposal, "expired", "The player permission has expired.");
    }

    return this.executeCapability(adapter, proposal, grant);
  }

  /**
   * Execute one grounded proposal without a player answer.
   *
   * Available only on a `full` autonomy coordinator. The synthetic grant is
   * the Player-side autonomous authorization record — it is created here,
   * never accepted from the DSH side, and carries the marker that keeps the
   * execution distinguishable from a consulted one.
   */
  public async settleAutonomously(adapter: GameAdapter, proposal: Proposal): Promise<ActionReceipt> {
    if (this.autonomy !== "full") {
      throw new Error(
        "Autonomous settlement requires a TurnCoordinator constructed with autonomy \"full\"; refusing to skip consent on a consult coordinator.",
      );
    }
    const now = this.now();
    const authorization = permissionGrantSchema.parse({
      proposalId: proposal.id,
      granted: true,
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      autonomy: "full",
    });
    return this.executeCapability(adapter, proposal, authorization);
  }

  private async executeCapability(
    adapter: GameAdapter,
    proposal: Proposal,
    grant: PermissionGrant,
  ): Promise<ActionReceipt> {
    const capability = adapter.descriptor.capabilities.find((entry) => entry.id === proposal.capabilityId);
    if (capability === undefined) {
      throw new Error(`Adapter does not expose capability '${proposal.capabilityId}'.`);
    }

    const receipt = receiptSchema.parse(await adapter.execute({ proposal, grant }));
    await adapter.present(receipt);
    return receipt;
  }

  private createTerminalReceipt(
    proposal: Proposal,
    status: "declined" | "expired",
    detail: string,
  ): ActionReceipt {
    return receiptSchema.parse({
      proposalId: proposal.id,
      capabilityId: proposal.capabilityId,
      status,
      occurredAt: this.now().toISOString(),
      target: null,
      scope: proposal.scope,
      detail,
    });
  }
}
