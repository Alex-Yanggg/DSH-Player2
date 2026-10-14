import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { socialBridgeTurnSchema, socialMemoryNoteLimit, type SocialBridgeTurn } from "@dsh-player2/contracts";
import { SOCIAL_MEMORY_TAG, socialMemoryNote } from "./social-memory.js";

/** The golden envelope the C# Player writer is pinned to (SocialMemoryTests). */
const golden = (): SocialBridgeTurn =>
  socialBridgeTurnSchema.parse(
    JSON.parse(readFileSync(new URL("../../../fixtures/social-turn/stardew-social-memory.json", import.meta.url), "utf8")),
  );

describe("social memory note (P2-0015 T0.3)", () => {
  it("parses the shared golden envelope written by the Player", () => {
    const turn = golden();
    expect(turn.priorMemory?.id).toBe("memory-receipt-3");
    expect(turn.latestReceipt?.status).toBe("completed");
    expect(turn.growth?.revision).toBe(7);
    expect(turn.occasion).toBeNull();
  });

  it("renders the citable yesterday id, growth focus and insights within the limit", () => {
    const note = socialMemoryNote(golden());
    expect(note.startsWith(SOCIAL_MEMORY_TAG)).toBe(true);
    expect(note).toContain('basedOnMemoryId "memory-receipt-3"');
    expect(note).toContain("your focus: Learn which plans the player grants.");
    expect(note).toContain("you learned: Markers near the crops");
    // The latest receipt is the same proposal as yesterday's memory: one line, not two.
    expect(note).not.toContain("latest receipt:");
    expect(note.length).toBeLessThanOrEqual(socialMemoryNoteLimit);
  });

  it("is empty when the turn carries no history", () => {
    expect(socialMemoryNote({ priorMemory: null, latestReceipt: null, growth: null })).toBe("");
  });

  it("drops whole lines instead of cutting a fact past the limit", () => {
    const turn = golden();
    const insights = Array.from({ length: 12 }, (_, index) => ({
      id: `growth-7-${index + 1}`,
      text: `${"long insight ".repeat(20)}#${index + 1}`,
      basedOnReceiptSequences: [3],
      createdAt: "2026-08-29T20:00:00.000Z",
    }));
    const note = socialMemoryNote({ ...turn, growth: { ...turn.growth!, insights } });
    expect(note.length).toBeLessThanOrEqual(socialMemoryNoteLimit);
    for (const line of note.split("\n").slice(1)) expect(line.startsWith("- ")).toBe(true);
    expect(note).toContain("memory-receipt-3");
  });

  it("mentions a newer receipt that is not yesterday's memory", () => {
    const turn = golden();
    const note = socialMemoryNote({
      ...turn,
      latestReceipt: { ...turn.latestReceipt!, proposalId: "proposal-day-12", status: "declined", detail: "The player said no." },
    });
    expect(note).toContain("latest receipt: declined visual-receipt, The player said no. [not citable; do not remember]");
  });

  it("says nothing is citable when a declined receipt is the only history", () => {
    const turn = golden();
    const note = socialMemoryNote({
      priorMemory: null,
      growth: null,
      latestReceipt: { ...turn.latestReceipt!, proposalId: "turn-1:proposal", status: "declined", detail: "The player declined this proposal." },
    });
    expect(note.split("\n")[0]).toContain("nothing here is citable, so basedOnMemoryId must be null");
    expect(note).toContain("[not citable; do not remember]");
    expect(note).not.toContain("turn-1:proposal");
  });
});
