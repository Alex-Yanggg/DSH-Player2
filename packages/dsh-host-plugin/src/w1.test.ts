import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { socialBridgeTurnSchema, socialResponseSchema, type SocialBridgeTurn } from "@dsh-player2/contracts";
import { MIND_CONTEXT_TAG } from "@dsh-player2/dsh-companion-plugin";
import { socialTurnPrompt } from "./index.js";

const golden = (): SocialBridgeTurn =>
  socialBridgeTurnSchema.parse(
    JSON.parse(readFileSync(new URL("../../../fixtures/social-turn/stardew-social-memory.json", import.meta.url), "utf8")),
  );

describe("MindContext on the social lane (P2-0016)", () => {
  it("places the mind note after the memory note and before the envelope", () => {
    const note = `${MIND_CONTEXT_TAG} (your own memory):\n- mood: content, calm, steady, comfortable with the player`;
    const prompt = socialTurnPrompt(golden(), note);
    const memoryAt = prompt.indexOf("SOCIAL_MEMORY");
    const mindAt = prompt.indexOf(MIND_CONTEXT_TAG);
    expect(memoryAt).toBeGreaterThan(0);
    expect(mindAt).toBeGreaterThan(memoryAt);
    expect(mindAt).toBeLessThan(prompt.indexOf("PLAYER_SOCIAL_TURN="));
    expect(socialTurnPrompt(golden(), "")).not.toContain(MIND_CONTEXT_TAG);
  });

  it("keeps the Player result contract unchanged: extras are stripped from the written response", () => {
    const parsed = socialResponseSchema.parse({
      kind: "reply", text: "记得！", basedOnObservationIds: [], basedOnMemoryId: null,
      rememberLatestReceipt: false, memorySummary: null,
      episodeIds: ["ep-000000000001"], remember: { kind: "utterance", summary: "x" },
    });
    expect(Object.keys(parsed).sort()).toEqual(["basedOnMemoryId", "basedOnObservationIds", "kind", "memorySummary", "rememberLatestReceipt", "text"]);
  });
});
