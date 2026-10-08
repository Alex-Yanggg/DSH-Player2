import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DreamFileLane, type DreamDraftInput } from "./spine-dream.js";
import { foldSpineEvent, SpineFileStore, SpineTimeline, spineStateFileAt, type RelationshipState, type SpineStore } from "./spine.js";
import type { ReceiptDigestEntry } from "./memory/receipt-digest.js";

const RECEIPT_21: ReceiptDigestEntry = {
  sequence: 21,
  proposalId: "turn-21:proposal",
  capabilityId: "visual-receipt",
  status: "completed",
  occurredAt: "2026-09-05T00:00:00.000Z",
  target: null,
  scope: "visual marker + sound only",
  detail: "d",
};

function receiptObserved(seq: number, sequence: number) {
  return {
    type: "companion/receipt-observed",
    seq,
    time: 1,
    ignorable: true,
    data: { sequence, proposalId: `turn-${sequence}:proposal`, capabilityId: "visual-receipt", status: "completed", occurredAt: "2026-09-05T00:00:00.000Z" },
  } as const;
}

describe("companion event spine (P2-0014)", () => {
  it("folds the same causal sequence idempotently and reads only the suffix past the watermark after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "player2-spine-"));
    try {
      const readFromCalls: number[] = [];
      const store: SpineStore = {
        create: async () => undefined,
        readFrom: async (_id, fromSeq) => {
          readFromCalls.push(fromSeq);
          return inner.readFrom("spine", fromSeq);
        },
        append: (id, events) => inner.append(id, events),
      };
      const inner = new SpineFileStore(directory);
      const spineId = "player2-spine-test";

      const first = new SpineTimeline(store, spineId, spineStateFileAt(join(directory, "state.json")));
      await first.hydrate();
      await first.record("companion/receipt-observed", {
        sequence: RECEIPT_21.sequence,
        proposalId: RECEIPT_21.proposalId,
        capabilityId: RECEIPT_21.capabilityId,
        status: RECEIPT_21.status,
        occurredAt: RECEIPT_21.occurredAt,
      });
      await first.record("companion/growth-applied", { sequence: 22, revision: 22 });
      expect(first.snapshot().watermark).toBe(1);
      expect(first.snapshot().receipts.map((receipt) => receipt.sequence)).toEqual([21]);

      // Restart: the persisted watermark means the suffix read starts past it.
      const second = new SpineTimeline(store, spineId, spineStateFileAt(join(directory, "state.json")));
      await second.hydrate();
      expect(readFromCalls.at(-1)).toBe(2);
      expect(second.snapshot().growthRevision).toBe(22);
      await second.record("companion/dream-closed", { sequence: 23, outcome: "growth" });
      expect(second.snapshot().watermark).toBe(2);
      expect(second.snapshot().dreams.map((dream) => dream.sequence)).toEqual([23]);

      // A duplicate of an already-folded event changes nothing (negative path 3).
      const before: RelationshipState = second.snapshot();
      const after = foldSpineEvent({ ...before, watermark: 1 }, receiptObserved(1, 21));
      expect(after.receipts.map((receipt) => receipt.sequence)).toEqual(before.receipts.map((receipt) => receipt.sequence));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("closes a dream with no-change or one grounded growth proposal and rejects unknown receipt citations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "player2-dream-"));
    try {
      const inner = new SpineFileStore(directory);
      const timeline = new SpineTimeline(inner, "player2-spine-test", spineStateFileAt(join(directory, "state.json")));
      await timeline.hydrate();
      await timeline.record("companion/receipt-observed", {
        sequence: RECEIPT_21.sequence,
        proposalId: RECEIPT_21.proposalId,
        capabilityId: RECEIPT_21.capabilityId,
        status: RECEIPT_21.status,
        occurredAt: RECEIPT_21.occurredAt,
      });
      const lane = new DreamFileLane(directory, timeline);

      await expect(lane.decide(23, {
        kind: "growth",
        insights: [{ text: "groundless", basedOnReceiptSequences: [99] }],
        focus: null,
      } satisfies DreamDraftInput)).rejects.toThrow("does not contain");

      expect(await lane.decide(23, { kind: "no-change" })).toBe("no-change");
      await expect(lane.decide(23, {
        kind: "growth",
        insights: [{ text: "The shared marker plan held; the player follows through.", basedOnReceiptSequences: [21] }],
        focus: "Plan one grounded marker.",
      } satisfies DreamDraftInput)).rejects.toThrow("already closed with a different outcome");
      const marker = JSON.parse(await readFile(join(directory, "outbox", "dream-nochange-23.json"), "utf8"));
      expect(marker).toMatchObject({ sequence: 23, outcome: "no-change" });
      expect(timeline.snapshot().dreams.map((dream) => dream.sequence)).toEqual([23]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
