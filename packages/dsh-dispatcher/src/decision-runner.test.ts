import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RequestNotWrittenError, verifyRequestWritten } from "./index.js";

function validRequest(sequence: number): unknown {
  return {
    version: "0.1.1",
    sequence,
    status: "awaiting-player",
    proposal: {
      id: `turn-${sequence}:proposal`,
      createdAt: "2026-08-29T00:00:00.000Z",
      basedOnObservationIds: ["weather-12"],
      capabilityId: "mark-target",
      intent: { target: "farm:tile:12,8" },
      scope: "one temporary marker",
      reason: "The observed rain makes a shared planning marker useful.",
      utterance: "The rain has bought us a quiet minute on the Farm; want me to mark our planning spot?",
    },
  };
}

let bridgeRoot = "";

async function writeRequest(sequence: number, body: string): Promise<void> {
  await mkdir(join(bridgeRoot, "outbox"), { recursive: true });
  await writeFile(join(bridgeRoot, "outbox", `request-${sequence}.json`), body, "utf8");
}

describe("verifyRequestWritten", () => {
  beforeEach(async () => {
    bridgeRoot = await mkdtemp(join(tmpdir(), "player2-request-"));
  });
  afterEach(async () => {
    await rm(bridgeRoot, { recursive: true, force: true });
  });

  it("accepts a persisted request for exactly this sequence", async () => {
    await writeRequest(5, `${JSON.stringify(validRequest(5), null, 2)}\n`);
    await expect(verifyRequestWritten(bridgeRoot, 5)).resolves.toBeUndefined();
  });

  it("rejects when no request was written", async () => {
    await expect(verifyRequestWritten(bridgeRoot, 1)).rejects.toBeInstanceOf(RequestNotWrittenError);
  });

  it("rejects a request that declares another sequence", async () => {
    await writeRequest(3, `${JSON.stringify(validRequest(9), null, 2)}\n`);
    await expect(verifyRequestWritten(bridgeRoot, 3)).rejects.toThrow(/declares sequence 9/);
  });

  it("rejects a persisted request that is not valid JSON", async () => {
    await writeRequest(2, "not json at all\n");
    await expect(verifyRequestWritten(bridgeRoot, 2)).rejects.toBeInstanceOf(RequestNotWrittenError);
  });
});
