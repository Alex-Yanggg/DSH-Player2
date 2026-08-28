import {
  permissionGrantSchema,
  proposalSchema,
  receiptSchema,
  type ActionReceipt,
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
}

/** Coordinates observation, decision, permission, execution, and receipt across game adapters. */
export class TurnCoordinator {
  private readonly now: () => Date;

  public constructor(options: TurnCoordinatorOptions = {}) {
    this.now = options.now ?? (() => new Date());
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
