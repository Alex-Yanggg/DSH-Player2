import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionFileBridge } from "./decision-file-bridge.js";

const roots: string[] = [];

async function createBridge() {
  const root = await mkdtemp(join(tmpdir(), "player2-decision-"));
  roots.push(root);
  await mkdir(join(root, "inbox"), { recursive: true });
  await writeFile(join(root, "inbox", "turn-1.json"), JSON.stringify({
    version: "0.1.0",
    sequence: 1,
    createdAt: "2026-08-29T00:00:00.000Z",
    gameDay: 12,
    adapter: {
      id: "stardew-semantic",
      gameId: "stardew-valley",
      accessMode: "semantic",
      capabilities: [{
        id: "mark-target",
        title: "Mark one agreed target",
        scope: "one temporary marker",
        accessMode: "semantic",
        requiresExplicitConsent: true,
        isReversible: true,
        inputSchemaRef: "player2://mark-target/0.1",
      }],
    },
    observations: [{
      id: "weather-12",
      kind: "world",
      observedAt: "2026-08-29T00:00:00.000Z",
      expiresAt: null,
      source: "stardew-mod",
      accessMode: "semantic",
      confidence: 1,
      facts: { weather: "rain" },
    }],
  }), "utf8");
  return { root, bridge: new DecisionFileBridge(root) };
}

function receiptFile(sequence: number, status: string): string {
  return JSON.stringify({
    proposalId: `turn-${sequence}:proposal`,
    capabilityId: "mark-target",
    status,
    occurredAt: "2026-08-29T00:00:00.000Z",
    target: "farm:tile:12,8",
    scope: "one temporary marker",
    detail: `Day ${sequence} shared outcome.`,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DecisionFileBridge", () => {
  it("persists an idempotent observe-propose-request chain", async () => {
    const { root, bridge } = await createBridge();
    const input = {
      capabilityId: "mark-target",
      basedOnObservationIds: ["weather-12"],
      target: "farm:tile:12,8",
      scope: "one temporary marker",
      reason: "Rain makes a shared planning marker useful.",
    };

    await expect(bridge.observe(1)).resolves.toMatchObject({ sequence: 1, gameDay: 12 });
    const [proposal, concurrentProposal] = await Promise.all([
      bridge.propose(1, input),
      bridge.propose(1, input),
    ]);
    expect(concurrentProposal).toEqual(proposal);
    await expect(bridge.propose(1, input)).resolves.toEqual(proposal);
    const request = await bridge.requestAction(1, proposal.id);
    await expect(bridge.requestAction(1, proposal.id)).resolves.toEqual(request);

    expect(request).toMatchObject({ sequence: 1, status: "awaiting-player" });
    expect(JSON.parse(await readFile(join(root, "outbox", "request-1.json"), "utf8"))).toEqual(request);
    expect((await readdir(join(root, "drafts"))).sort()).toEqual(["proposal-1.json"]);
    expect((await readdir(join(root, "outbox"))).sort()).toEqual(["request-1.json"]);
  });

  it("rejects unknown evidence, capabilities, skipped proposals, and conflicting rewrites", async () => {
    const { bridge } = await createBridge();
    const valid = {
      capabilityId: "mark-target",
      basedOnObservationIds: ["weather-12"],
      target: "farm:tile:12,8",
      scope: "one temporary marker",
      reason: "Use the observed rain.",
    };

    await expect(bridge.propose(1, { ...valid, basedOnObservationIds: ["invented"] }))
      .rejects.toThrow("unknown observation");
    await expect(bridge.propose(1, { ...valid, capabilityId: "water-everything" }))
      .rejects.toThrow("unknown capability");
    await expect(bridge.requestAction(1, "turn-1:proposal"))
      .rejects.toThrow("No proposal exists");

    await bridge.propose(1, valid);
    await expect(bridge.propose(1, { ...valid, reason: "A conflicting reason." }))
      .rejects.toThrow("Refusing to overwrite conflicting proposal");
    await expect(bridge.observe(2)).rejects.toThrow("No decision turn exists");
  });

  it("explains a turn envelope written by an older mod build", async () => {
    const { root, bridge } = await createBridge();
    const legacy = JSON.parse(await readFile(join(root, "inbox", "turn-1.json"), "utf8")) as {
      adapter: { capabilities: Array<Record<string, unknown>> };
    };
    delete legacy.adapter.capabilities[0].scope;
    await writeFile(join(root, "inbox", "turn-1.json"), JSON.stringify(legacy), "utf8");

    const error = await bridge.observe(1).then(
      () => null,
      (value: unknown) => value,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("does not match the bridge contract");
    expect((error as Error).message).toContain("adapter.capabilities.0.scope");
    expect((error as Error).message).toContain("rebuild and redeploy the mod");
  });

  it("rejects oversized bridge input and proposal fields before persistence", async () => {
    const { root, bridge } = await createBridge();
    const valid = {
      capabilityId: "mark-target",
      basedOnObservationIds: ["weather-12"],
      target: "farm:tile:12,8",
      scope: "one temporary marker",
      reason: "Use the observed rain.",
    };

    await expect(bridge.propose(1, { ...valid, target: "x".repeat(257) }))
      .rejects.toThrow("target may contain at most 256 characters");
    await expect(bridge.propose(1, {
      ...valid,
      basedOnObservationIds: Array.from({ length: 9 }, (_, index) => `observation-${index}`),
    })).rejects.toThrow("cite at most 8 observations");

    await writeFile(
      join(root, "inbox", "turn-1.json"),
      JSON.stringify({ padding: "x".repeat(64 * 1024) }),
      "utf8",
    );
    await expect(bridge.observe(1)).rejects.toThrow("exceeds the 65536 byte limit");
  });

  it("recalls a bounded newest-first digest and skips damaged receipts", async () => {
    const { root, bridge } = await createBridge();
    await mkdir(join(root, "receipts"), { recursive: true });
    const receipt = (sequence: number, status: string) => JSON.stringify({
      proposalId: `turn-${sequence}:proposal`,
      capabilityId: "mark-target",
      status,
      occurredAt: "2026-08-29T00:00:00.000Z",
      target: "farm:tile:12,8",
      scope: "one temporary marker",
      detail: `Day ${sequence} shared outcome.`,
    });
    for (const [sequence, status] of [[3, "completed"], [5, "failed"], [7, "declined"]]) {
      await writeFile(join(root, "receipts", `receipt-${sequence}.json`), receipt(sequence, status), "utf8");
    }
    await writeFile(join(root, "receipts", "receipt-9.json"), "{ not json", "utf8");
    await writeFile(join(root, "receipts", "notes.txt"), "ignored", "utf8");

    const digest = await bridge.recall();

    expect(digest.entries.map((entry) => [entry.sequence, entry.status])).toEqual([
      [7, "declined"],
      [5, "failed"],
      [3, "completed"],
    ]);
    expect(digest.skipped).toBe(1);
  });

  it("returns an empty digest when no receipts exist", async () => {
    const { bridge } = await createBridge();

    await expect(bridge.recall()).resolves.toEqual({ entries: [], skipped: 0 });
  });

  it("returns only the eight newest receipts when more exist", async () => {
    const { root, bridge } = await createBridge();
    await mkdir(join(root, "receipts"), { recursive: true });
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      await writeFile(
        join(root, "receipts", `receipt-${sequence}.json`),
        receiptFile(sequence, "completed"),
        "utf8",
      );
    }

    const digest = await bridge.recall();

    expect(digest.entries.map((entry) => entry.sequence)).toEqual([12, 11, 10, 9, 8, 7, 6, 5]);
    expect(digest.skipped).toBe(0);
  });

  it("truncates oversized scope and detail in the digest", async () => {
    const { root, bridge } = await createBridge();
    await mkdir(join(root, "receipts"), { recursive: true });
    await writeFile(
      join(root, "receipts", "receipt-2.json"),
      JSON.stringify({
        proposalId: "turn-2:proposal",
        capabilityId: "mark-target",
        status: "completed",
        occurredAt: "2026-08-29T00:00:00.000Z",
        target: "farm:tile:12,8",
        scope: "s".repeat(300),
        detail: "d".repeat(500),
      }),
      "utf8",
    );

    const digest = await bridge.recall();

    expect(digest.entries).toHaveLength(1);
    expect(digest.entries[0].scope).toHaveLength(121);
    expect(digest.entries[0].scope.endsWith("…")).toBe(true);
    expect(digest.entries[0].detail).toHaveLength(201);
    expect(digest.entries[0].detail.endsWith("…")).toBe(true);
  });

  it("writes an autonomous order on the full autonomy tier", async () => {
    const { root, bridge } = await createBridge();
    const fullBridge = new DecisionFileBridge(root, "full");
    const input = {
      capabilityId: "mark-target",
      basedOnObservationIds: ["weather-12"],
      target: "farm:tile:12,8",
      scope: "one temporary marker",
      reason: "Rain makes a shared planning marker useful.",
    };

    const proposal = await fullBridge.propose(1, input);
    const order = await fullBridge.requestAction(1, proposal.id);

    expect(order).toMatchObject({ sequence: 1, status: "autonomous", proposal: { id: "turn-1:proposal" } });
    // The consult bridge stays byte-consistent with the same proposal: the
    // tier changes only the request status, never the proposal identity.
    const consultRequest = await bridge.requestAction(1, proposal.id).then(
      (value) => value,
      (error: unknown) => error,
    );
    expect(consultRequest).toBeInstanceOf(Error);
    expect((consultRequest as Error).message).toContain("Refusing to overwrite conflicting action request");
  });

  it("surfaces the autonomous marker of past receipts in the digest", async () => {
    const { root, bridge } = await createBridge();
    await mkdir(join(root, "receipts"), { recursive: true });
    await writeFile(join(root, "receipts", "receipt-6.json"), JSON.stringify({
      ...JSON.parse(receiptFile(6, "completed")),
      autonomy: "full",
    }), "utf8");
    await writeFile(join(root, "receipts", "receipt-5.json"), receiptFile(5, "declined"), "utf8");

    const digest = await bridge.recall();

    expect(digest.entries).toHaveLength(2);
    expect(digest.entries[0]).toMatchObject({ sequence: 6, autonomy: "full" });
    expect(digest.entries[1]).toMatchObject({ sequence: 5 });
    expect(digest.entries[1].autonomy).toBeUndefined();
  });
});
