import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionRequestSchema } from "@dsh-player2/contracts";
import { BridgeDispatcher, type DecisionTurnRunner } from "./index.js";

async function createBridge(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "player2-dispatch-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function writeTurn(root: string, sequence: number): Promise<void> {
  await mkdir(join(root, "inbox"), { recursive: true });
  await writeFile(join(root, "inbox", `turn-${sequence}.json`), `${JSON.stringify({ sequence })}\n`, "utf8");
}

function validRequest(sequence: number): unknown {
  return {
    version: "0.0.3",
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
    },
  };
}

async function writeRequest(root: string, sequence: number, body: unknown = validRequest(sequence)): Promise<void> {
  await mkdir(join(root, "outbox"), { recursive: true });
  await writeFile(join(root, "outbox", `request-${sequence}.json`), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

/** Stub runner that plays the role of the DSH tool pipeline for one sequence. */
function scriptedRunner(root: string, behavior: (sequence: number) => Promise<void> = async () => undefined) {
  const calls: number[] = [];
  const events: Array<{ sequence: number; phase: "start" | "end" }> = [];
  const runner: DecisionTurnRunner = {
    async runDecisionTurn(sequence: number) {
      calls.push(sequence);
      events.push({ sequence, phase: "start" });
      await behavior(sequence);
      events.push({ sequence, phase: "end" });
    },
  };
  return { calls, events, runner };
}

const bridges: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((cleanup) => cleanup()));
  vi.restoreAllMocks();
});

async function newBridge(): Promise<{ root: string }> {
  const { root, cleanup } = await createBridge();
  bridges.push(cleanup);
  return { root };
}

const quietLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("BridgeDispatcher", () => {
  it("dispatches each pending turn once and skips already answered sequences", async () => {
    const { root } = await newBridge();
    await writeTurn(root, 1);
    await writeTurn(root, 2);
    await writeRequest(root, 2);
    const script = scriptedRunner(root, async (sequence) => writeRequest(root, sequence));
    const dispatcher = new BridgeDispatcher({
      bridgeDirectory: root,
      runner: script.runner,
      useWatcher: false,
      logger: quietLogger,
    });

    await dispatcher.start();
    expect(script.calls).toEqual([1]);
    expect(dispatcher.stats).toEqual({ dispatched: 1, failed: 0 });

    await dispatcher.stop();
    await writeTurn(root, 3);
    await dispatcher.dispatchPending();

    expect(script.calls).toEqual([1, 3]);
    const persisted = JSON.parse(await readFile(join(root, "outbox", "request-1.json"), "utf8"));
    expect(() => actionRequestSchema.parse(persisted)).not.toThrow();
  });

  it("gives a sequence up after bounded attempts and keeps serving later turns", async () => {
    const { root } = await newBridge();
    await writeTurn(root, 7);
    let attempts = 0;
    const script = scriptedRunner(root, async (sequence) => {
      if (sequence === 7) {
        attempts += 1;
        throw new Error("DSH runtime unavailable");
      }
      await writeRequest(root, sequence);
    });
    const dispatcher = new BridgeDispatcher({
      bridgeDirectory: root,
      runner: script.runner,
      useWatcher: false,
      maxAttempts: 2,
      retryBackoffMs: 1,
      logger: quietLogger,
    });

    await dispatcher.start();

    expect(attempts).toBe(2);
    expect(dispatcher.stats).toEqual({ dispatched: 0, failed: 1 });

    await writeTurn(root, 8);
    await dispatcher.dispatchPending();
    await dispatcher.stop();

    expect(script.calls.filter((sequence) => sequence === 7)).toHaveLength(2);
    expect(script.calls.filter((sequence) => sequence === 8)).toHaveLength(1);
  });

  it("processes overlapping turns serially in ascending sequence order", async () => {
    const { root } = await newBridge();
    await writeTurn(root, 1);
    await writeTurn(root, 2);
    const script = scriptedRunner(root, async (sequence) => {
      await new Promise((resolve) => setTimeout(resolve, sequence === 1 ? 20 : 1));
      await writeRequest(root, sequence);
    });
    const dispatcher = new BridgeDispatcher({
      bridgeDirectory: root,
      runner: script.runner,
      useWatcher: false,
      logger: quietLogger,
    });

    await dispatcher.start();
    await dispatcher.stop();

    expect(script.events.map((event) => event.phase)).toEqual([
      "start",
      "end",
      "start",
      "end",
    ]);
    expect(script.events.map((event) => event.sequence)).toEqual([1, 1, 2, 2]);
  });

  it("stop waits for the in-flight turn before returning", async () => {
    const { root } = await newBridge();
    await writeTurn(root, 1);
    let releaseInFlight: () => void = () => undefined;
    const inFlight = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    let started = false;
    const script = scriptedRunner(root, async () => {
      started = true;
      await inFlight;
      await writeRequest(root, 1);
    });
    const dispatcher = new BridgeDispatcher({
      bridgeDirectory: root,
      runner: script.runner,
      useWatcher: false,
      logger: quietLogger,
    });

    const starting = dispatcher.start();
    await vi.waitFor(() => expect(started).toBe(true));
    const stopping = dispatcher.stop();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(false);

    releaseInFlight();
    await starting;
    await stopping;
    expect(stopped).toBe(true);
    expect(dispatcher.stats).toEqual({ dispatched: 1, failed: 0 });
  });

  it("uses the inbox watcher to dispatch between polls", async () => {
    const { root } = await newBridge();
    const script = scriptedRunner(root, async (sequence) => writeRequest(root, sequence));
    const dispatcher = new BridgeDispatcher({
      bridgeDirectory: root,
      runner: script.runner,
      pollIntervalMs: 60_000,
      logger: quietLogger,
    });

    await dispatcher.start();
    await writeTurn(root, 4);

    await vi.waitFor(async () => {
      expect(script.calls).toEqual([4]);
    }, { timeout: 5_000 });
    await dispatcher.stop();
  });

  it("refuses to start when the bridge directory does not exist", async () => {
    const missing = join(tmpdir(), `player2-missing-${Date.now()}`);
    const script = scriptedRunner(missing);
    const dispatcher = new BridgeDispatcher({
      bridgeDirectory: missing,
      runner: script.runner,
      useWatcher: false,
      logger: quietLogger,
    });

    await expect(dispatcher.start()).rejects.toThrow(/does not exist/);
  });
});
