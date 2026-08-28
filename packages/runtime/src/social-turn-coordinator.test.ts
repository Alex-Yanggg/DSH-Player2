import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActionReceipt,
  ConversationPolicy,
  SocialPresenter,
  SocialResponse,
} from "@dsh-player2/contracts";
import { SocialTurnCoordinator, type SocialTurnAdapter } from "./social-turn-coordinator.js";

const now = new Date("2026-08-28T00:00:00.000Z");
const adapter: SocialTurnAdapter = {
  descriptor: {
    id: "stardew-smapi",
    gameId: "stardew-valley",
    accessMode: "semantic",
    capabilities: [],
  },
  observe: vi.fn().mockResolvedValue([
    {
      id: "weather-42",
      kind: "world",
      observedAt: now.toISOString(),
      expiresAt: null,
      source: "stardew-smapi",
      accessMode: "semantic",
      confidence: 1,
      facts: { weather: "rain", location: "Farm" },
    },
  ]),
};
const presenter: SocialPresenter = { presentSocial: vi.fn().mockResolvedValue(undefined) };
const message = { id: "message-1", content: "Should we prepare for the mine tomorrow?", createdAt: now.toISOString() };
const receipt: ActionReceipt = {
  proposalId: "proposal-1",
  capabilityId: "visual-receipt",
  status: "completed",
  occurredAt: now.toISOString(),
  target: "tile 12, 8",
  scope: "visual marker + sound only",
  detail: "A temporary marker was shown.",
};
const response = (overrides: Partial<SocialResponse> = {}): SocialResponse => ({
  kind: "suggestion",
  text: "Rain gives us room to prepare the mine supplies for tomorrow.",
  basedOnObservationIds: ["weather-42"],
  basedOnMemoryId: null,
  rememberLatestReceipt: true,
  memorySummary: "We marked the rain-day plan together.",
  ...overrides,
});
const request = (overrides: Record<string, unknown> = {}) => ({
  id: "social-1",
  gameDay: 42,
  message,
  priorMemory: null,
  latestReceipt: receipt,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SocialTurnCoordinator", () => {
  it("records a grounded free-text exchange and one receipt-backed memory", async () => {
    const policy: ConversationPolicy = { respond: vi.fn().mockResolvedValue(response()) };

    const result = await new SocialTurnCoordinator({ now: () => now }).run(adapter, presenter, policy, request());

    expect(result.response.kind).toBe("suggestion");
    expect(result.retainedMemory).toMatchObject({
      id: "outcome:proposal-1",
      sourceProposalId: "proposal-1",
      gameDay: 42,
      status: "completed",
    });
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "observations",
      "player-message",
      "latest-receipt",
      "response",
      "memory-retained",
    ]);
    expect(presenter.presentSocial).toHaveBeenCalledWith(result.response);
    expect(result.trace.events.find((event) => event.type === "player-message")).toMatchObject({ message });
    expect(result.trace.events.find((event) => event.type === "latest-receipt")).toMatchObject({ receipt });
  });

  it("only provides yesterday's shared outcome to the policy", async () => {
    const yesterday = {
      id: "outcome:proposal-0",
      sourceProposalId: "proposal-0",
      gameDay: 41,
      occurredAt: now.toISOString(),
      status: "failed" as const,
      target: null,
      scope: "visual marker + sound only",
      summary: "Yesterday's marker failed to appear.",
    };
    const policy: ConversationPolicy = { respond: vi.fn().mockResolvedValue(response({
      kind: "reply",
      basedOnMemoryId: yesterday.id,
      rememberLatestReceipt: false,
      memorySummary: null,
    })) };

    await new SocialTurnCoordinator({ now: () => now }).run(adapter, presenter, policy, request({ priorMemory: yesterday }));

    expect(policy.respond).toHaveBeenCalledWith(expect.objectContaining({ priorMemory: yesterday }));
  });

  it("does not expose stale memory", async () => {
    const stale = {
      id: "outcome:proposal-0",
      sourceProposalId: "proposal-0",
      gameDay: 40,
      occurredAt: now.toISOString(),
      status: "completed" as const,
      target: null,
      scope: "visual marker + sound only",
      summary: "An old outcome.",
    };
    const policy: ConversationPolicy = { respond: vi.fn().mockResolvedValue(response({
      kind: "reply",
      basedOnMemoryId: null,
      rememberLatestReceipt: false,
      memorySummary: null,
    })) };

    await new SocialTurnCoordinator({ now: () => now }).run(adapter, presenter, policy, request({ priorMemory: stale }));

    expect(policy.respond).toHaveBeenCalledWith(expect.objectContaining({ priorMemory: null }));
  });

  it("falls back when a policy invents an observation", async () => {
    const policy: ConversationPolicy = { respond: vi.fn().mockResolvedValue(response({ basedOnObservationIds: ["invented"] })) };

    const result = await new SocialTurnCoordinator({ now: () => now }).run(adapter, presenter, policy, request());

    expect(result.usedFallback).toBe(true);
    expect(result.response.kind).toBe("uncertain");
    expect(result.retainedMemory).toBeNull();
    expect(result.trace.events.some((event) => event.type === "policy-fallback")).toBe(true);
  });

  it("does not expose expired observations to a policy", async () => {
    const expiredAdapter: SocialTurnAdapter = {
      ...adapter,
      observe: vi.fn().mockResolvedValue([{
        id: "old-weather",
        kind: "world",
        observedAt: now.toISOString(),
        expiresAt: "2026-08-27T23:59:59.000Z",
        source: "stardew-smapi",
        accessMode: "semantic",
        confidence: 1,
        facts: { weather: "rain" },
      }]),
    };
    const policy: ConversationPolicy = { respond: vi.fn().mockResolvedValue(response({
      basedOnObservationIds: ["old-weather"],
    })) };

    const result = await new SocialTurnCoordinator({ now: () => now }).run(expiredAdapter, presenter, policy, request());

    expect(policy.respond).toHaveBeenCalledWith(expect.objectContaining({ observations: [] }));
    expect(result.response.kind).toBe("uncertain");
  });

  it("falls back when a policy tries to retain a non-result receipt", async () => {
    const policy: ConversationPolicy = { respond: vi.fn().mockResolvedValue(response()) };
    const declinedReceipt = { ...receipt, status: "declined" as const };

    const result = await new SocialTurnCoordinator({ now: () => now }).run(
      adapter,
      presenter,
      policy,
      request({ latestReceipt: declinedReceipt }),
    );

    expect(result.response.kind).toBe("uncertain");
    expect(result.retainedMemory).toBeNull();
  });

  it("falls back honestly when the policy throws", async () => {
    const policy: ConversationPolicy = { respond: vi.fn().mockRejectedValue(new Error("provider unavailable")) };

    const result = await new SocialTurnCoordinator({ now: () => now }).run(adapter, presenter, policy, request());

    expect(result.usedFallback).toBe(true);
    expect(result.response).toMatchObject({ kind: "uncertain", basedOnObservationIds: [] });
  });

  it("returns the first result for a duplicate message without asking the policy again", async () => {
    const policy: ConversationPolicy = { respond: vi.fn().mockResolvedValue(response()) };
    const coordinator = new SocialTurnCoordinator({ now: () => now });

    const first = await coordinator.run(adapter, presenter, policy, request());
    const repeated = await coordinator.run(adapter, presenter, policy, request({ id: "social-2" }));

    expect(repeated).toBe(first);
    expect(policy.respond).toHaveBeenCalledTimes(1);
    expect(presenter.presentSocial).toHaveBeenCalledTimes(1);
  });
});
