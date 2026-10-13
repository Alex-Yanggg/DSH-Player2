import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { socialBridgeTurnSchema, socialResponseSchema, type SocialBridgeTurn } from "@dsh-player2/contracts";
import { parseModelJson, unwrapJsonFence } from "./json-reply.js";
import { latencyLine, socialTurnPrompt, validateSocialResponse } from "./index.js";

const golden = (): SocialBridgeTurn =>
  socialBridgeTurnSchema.parse(
    JSON.parse(readFileSync(new URL("../../../fixtures/social-turn/stardew-social-memory.json", import.meta.url), "utf8")),
  );

const reply = (overrides: Partial<ReturnType<typeof socialResponseSchema.parse>> = {}) =>
  socialResponseSchema.parse({
    kind: "reply",
    text: "昨天的标记就在防风草旁边。",
    basedOnObservationIds: ["world-12"],
    basedOnMemoryId: null,
    rememberLatestReceipt: false,
    memorySummary: null,
    ...overrides,
  });

describe("model JSON transport", () => {
  it("unwraps exactly one outer fence, with or without a language tag", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson(' {"a":1} ')).toEqual({ a: 1 });
    expect(unwrapJsonFence("prefix ```json\n{}\n```")).toBe("prefix ```json\n{}\n```");
    expect(() => parseModelJson("```json\nnot json\n```")).toThrow();
  });
});

describe("social turn grounding (P2-0015 T0.3)", () => {
  it("accepts the carried memory id and rejects an invented one", () => {
    const turn = golden();
    expect(() => validateSocialResponse(turn, reply({ basedOnMemoryId: "memory-receipt-3" }))).not.toThrow();
    expect(() => validateSocialResponse(turn, reply({ basedOnMemoryId: "memory-receipt-404" }))).toThrow(/unavailable memory/);
    expect(() => validateSocialResponse({ ...turn, priorMemory: null }, reply({ basedOnMemoryId: "memory-receipt-3" }))).toThrow(/unavailable memory/);
  });

  it("remembers only a completed or failed receipt the turn carried", () => {
    const turn = golden();
    const remember = reply({ rememberLatestReceipt: true, memorySummary: "We marked the parsnips." });
    expect(() => validateSocialResponse(turn, remember)).not.toThrow();
    expect(() => validateSocialResponse({ ...turn, latestReceipt: null }, remember)).toThrow(/never carried/);
    expect(() => validateSocialResponse({ ...turn, latestReceipt: { ...turn.latestReceipt!, status: "declined" } }, remember)).toThrow(/never carried/);
  });

  it("puts the bounded memory note ahead of the envelope", () => {
    const prompt = socialTurnPrompt(golden());
    const noteAt = prompt.indexOf("SOCIAL_MEMORY");
    expect(noteAt).toBeGreaterThan(0);
    expect(noteAt).toBeLessThan(prompt.indexOf("PLAYER_SOCIAL_TURN="));
    expect(prompt).toContain("Answer this PLAYER_SOCIAL_TURN directly");
  });

  it("frames a day-start turn as the companion opening the day", () => {
    const turn = { ...golden(), occasion: "day-start" as const, message: { ...golden().message, content: "[day-start]" } };
    const prompt = socialTurnPrompt(turn);
    expect(prompt).toContain("Open this new game day");
    expect(prompt).toContain("The player has not spoken");
  });
});

describe("latency trace (P2-0015 T0.1)", () => {
  it("writes the same line shape as the Mod trace", () => {
    const line = JSON.parse(latencyLine("social", "turn-1", "first-token", Date.UTC(2026, 7, 30, 0, 0, 0, 125)));
    expect(line).toEqual({ at: "2026-08-30T00:00:00.125Z", source: "host", lane: "social", key: "turn-1", stage: "first-token", detail: null });
  });
});
