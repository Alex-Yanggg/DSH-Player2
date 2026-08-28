import { describe, expect, it } from "vitest";
import type { SocialContext } from "@dsh-player2/contracts";
import { RuleConversationPolicy } from "./rule-conversation-policy.js";

const now = "2026-08-28T00:00:00.000Z";
const context = (content: string, observations = true): SocialContext => ({
  adapter: { id: "fixture", gameId: "fixture-game", accessMode: "semantic", capabilities: [] },
  gameDay: 42,
  observations: observations ? [{
    id: "weather-42",
    kind: "world",
    observedAt: now,
    expiresAt: null,
    source: "fixture",
    accessMode: "semantic",
    confidence: 1,
    facts: { weather: "rain" },
  }] : [],
  priorMemory: null,
  latestReceipt: {
    proposalId: "proposal-1",
    capabilityId: "visual-receipt",
    status: "completed",
    occurredAt: now,
    target: "tile 12, 8",
    scope: "visual marker + sound only",
    detail: "A temporary marker was shown.",
  },
  message: { id: "message-1", content, createdAt: now },
});

describe("RuleConversationPolicy", () => {
  it("has a deterministic, keyless social response for every 0.0.2 conversational outcome", async () => {
    const policy = new RuleConversationPolicy();

    await expect(policy.respond(context("为什么？"))).resolves.toMatchObject({ kind: "reply" });
    await expect(policy.respond(context("今天该做什么？"))).resolves.toMatchObject({
      kind: "suggestion",
      rememberLatestReceipt: true,
    });
    await expect(policy.respond(context("去浇水吧"))).resolves.toMatchObject({ kind: "disagreement" });
    await expect(policy.respond(context("你好"))).resolves.toMatchObject({ kind: "question" });
    await expect(policy.respond(context("你好", false))).resolves.toMatchObject({ kind: "uncertain" });
  });
});
