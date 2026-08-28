import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    version: "0.0.3",
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
    const proposal = await bridge.propose(1, input);
    await expect(bridge.propose(1, input)).resolves.toEqual(proposal);
    const request = await bridge.requestAction(1, proposal.id);
    await expect(bridge.requestAction(1, proposal.id)).resolves.toEqual(request);

    expect(request).toMatchObject({ sequence: 1, status: "awaiting-player" });
    expect(JSON.parse(await readFile(join(root, "outbox", "request-1.json"), "utf8"))).toEqual(request);
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
});
