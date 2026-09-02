import { describe, expect, it, vi } from "vitest";
import type {
  ActionReceipt,
  DecisionPolicy,
  GameAdapter,
  PermissionGrant,
  Proposal,
} from "@dsh-player2/contracts";
import { TurnCoordinator } from "./index.js";

const now = new Date("2026-08-28T00:00:00.000Z");
const proposal: Proposal = {
  id: "proposal-1",
  createdAt: now.toISOString(),
  basedOnObservationIds: ["weather-1"],
  capabilityId: "visual-receipt",
  intent: { targetTile: [12, 8] },
  scope: "visual marker + sound only",
  reason: "The player explicitly agreed to a bounded world receipt.",
};

const grant = (granted: boolean, expiresAt = "2026-08-28T00:05:00.000Z"): PermissionGrant => ({
  proposalId: proposal.id,
  granted,
  grantedAt: now.toISOString(),
  expiresAt,
});

const createAdapter = (): GameAdapter => ({
  descriptor: {
    id: "stardew-smapi",
    gameId: "stardew-valley",
    accessMode: "semantic",
    capabilities: [
      {
        id: "visual-receipt",
        title: "Show a bounded world receipt",
        accessMode: "semantic",
        requiresExplicitConsent: true,
        isReversible: true,
        inputSchemaRef: "player2/visual-receipt@0.1",
      },
    ],
  },
  observe: vi.fn().mockResolvedValue([
    {
      id: "weather-1",
      kind: "weather",
      observedAt: now.toISOString(),
      expiresAt: null,
      source: "stardew-smapi",
      accessMode: "semantic",
      confidence: 1,
      facts: { weather: "rain" },
    },
  ]),
  execute: vi.fn().mockResolvedValue({
    proposalId: proposal.id,
    capabilityId: proposal.capabilityId,
    status: "completed",
    occurredAt: now.toISOString(),
    target: "tile 12, 8",
    scope: proposal.scope,
    detail: "A temporary marker was shown.",
  } satisfies ActionReceipt),
  present: vi.fn().mockResolvedValue(undefined),
});

describe("TurnCoordinator", () => {
  it("passes structured observations to the decision policy", async () => {
    const adapter = createAdapter();
    const policy: DecisionPolicy = { decide: vi.fn().mockResolvedValue(proposal) };

    const created = await new TurnCoordinator({ now: () => now }).createProposal(adapter, policy);

    expect(created).toEqual(proposal);
    expect(adapter.observe).toHaveBeenCalledOnce();
    expect(policy.decide).toHaveBeenCalledWith({
      adapter: adapter.descriptor,
      observations: await adapter.observe({ kinds: [] }),
    });
  });

  it("does not execute a proposal the player declined", async () => {
    const adapter = createAdapter();

    const receipt = await new TurnCoordinator({ now: () => now }).settleProposal(adapter, proposal, grant(false));

    expect(receipt.status).toBe("declined");
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(adapter.present).not.toHaveBeenCalled();
  });

  it("executes and presents a proposal with current matching permission", async () => {
    const adapter = createAdapter();

    const receipt = await new TurnCoordinator({ now: () => now }).settleProposal(adapter, proposal, grant(true));

    expect(receipt.status).toBe("completed");
    expect(adapter.execute).toHaveBeenCalledWith({ proposal, grant: grant(true) });
    expect(adapter.present).toHaveBeenCalledWith(receipt);
  });

  it("rejects permission for a different proposal", async () => {
    const adapter = createAdapter();

    await expect(
      new TurnCoordinator({ now: () => now }).settleProposal(adapter, proposal, { ...grant(true), proposalId: "other" }),
    ).rejects.toThrow("does not belong");
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("executes a proposal autonomously on a full coordinator with a marked authorization record", async () => {
    const adapter = createAdapter();

    const receipt = await new TurnCoordinator({ now: () => now, autonomy: "full" })
      .settleAutonomously(adapter, proposal);

    expect(receipt.status).toBe("completed");
    expect(adapter.execute).toHaveBeenCalledOnce();
    const command = (adapter.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as { grant: PermissionGrant };
    expect(command.grant).toMatchObject({
      proposalId: proposal.id,
      granted: true,
      autonomy: "full",
    });
    expect(command.grant.grantedAt).toBe(now.toISOString());
    expect(adapter.present).toHaveBeenCalledWith(receipt);
  });

  it("refuses autonomous settlement on a consult coordinator and rejects an unknown tier", async () => {
    const adapter = createAdapter();

    await expect(new TurnCoordinator({ now: () => now }).settleAutonomously(adapter, proposal))
      .rejects.toThrow('requires a TurnCoordinator constructed with autonomy "full"');
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(() => new TurnCoordinator({ autonomy: "cheat" as never })).toThrow(
      'companion.autonomy must be "consult" or "full"',
    );
  });
});
