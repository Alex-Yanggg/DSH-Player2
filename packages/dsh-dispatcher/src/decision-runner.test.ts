import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const close = vi.fn();

vi.mock("@deepseek-ai/dsh-sdk-client", () => ({
  DeepSeekHarness: class {
    public run = run;
    public close = close;
    public constructor(_options: unknown) {}
  },
}));

const { DshSessionDecisionRunner, RequestNotWrittenError } = await import("./index.js");

async function createBridge(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "player2-runner-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
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

let bridgeRoot = "";
let cleanupBridge: () => Promise<void> = async () => undefined;

afterEach(async () => {
  await cleanupBridge();
  vi.clearAllMocks();
});

describe("DshSessionDecisionRunner", () => {
  beforeEach(async () => {
    const bridge = await createBridge();
    bridgeRoot = bridge.root;
    cleanupBridge = bridge.cleanup;
  });

  it("wakes the same dedicated session and accepts a verified request", async () => {
    await mkdir(join(bridgeRoot, "outbox"), { recursive: true });
    await writeFile(
      join(bridgeRoot, "outbox", "request-5.json"),
      `${JSON.stringify(validRequest(5), null, 2)}\n`,
      "utf8",
    );
    run.mockResolvedValue({ finalResponse: "done", events: [{ type: "tool/call", data: { name: "game_observe" } }] });
    const runner = new DshSessionDecisionRunner({
      launch: { command: "dsh-jsonrpc-agent" },
      cwd: "C:/player2",
      sessionId: "player2-companion-farm",
      bridgeDirectory: bridgeRoot,
    });

    await expect(runner.runDecisionTurn(5)).resolves.toBeUndefined();
    await expect(runner.runDecisionTurn(5)).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(2);
    for (const [index, sequence] of [5, 5].entries()) {
      const [prompt, options] = run.mock.calls[index] as [string, { sessionId: string }];
      expect(prompt).toContain("PLAYER_DECISION_TURN=");
      expect(prompt).toContain(`"sequence":${sequence}`);
      expect(prompt).not.toContain(bridgeRoot);
      expect(options).toEqual({ sessionId: "player2-companion-farm" });
    }
    expect(runner.lastRunEvents).toEqual([{ type: "tool/call", data: { name: "game_observe" } }]);
  });

  it("rejects when the model returns without writing the request", async () => {
    run.mockResolvedValue({ finalResponse: "I asked the player.", events: [] });
    const runner = new DshSessionDecisionRunner({
      launch: { command: "dsh-jsonrpc-agent" },
      cwd: "C:/player2",
      sessionId: "player2-companion-farm",
      bridgeDirectory: bridgeRoot,
    });

    await expect(runner.runDecisionTurn(1)).rejects.toBeInstanceOf(RequestNotWrittenError);
  });

  it("rejects a request that declares another sequence", async () => {
    await mkdir(join(bridgeRoot, "outbox"), { recursive: true });
    await writeFile(
      join(bridgeRoot, "outbox", "request-3.json"),
      `${JSON.stringify(validRequest(9), null, 2)}\n`,
      "utf8",
    );
    run.mockResolvedValue({ finalResponse: "done", events: [] });
    const runner = new DshSessionDecisionRunner({
      launch: { command: "dsh-jsonrpc-agent" },
      cwd: "C:/player2",
      sessionId: "player2-companion-farm",
      bridgeDirectory: bridgeRoot,
    });

    await expect(runner.runDecisionTurn(3)).rejects.toThrow(/declares sequence 9/);
  });

  it("rejects a persisted request that violates the schema", async () => {
    await mkdir(join(bridgeRoot, "outbox"), { recursive: true });
    await writeFile(join(bridgeRoot, "outbox", "request-2.json"), "not json at all\n", "utf8");
    run.mockResolvedValue({ finalResponse: "done", events: [] });
    const runner = new DshSessionDecisionRunner({
      launch: { command: "dsh-jsonrpc-agent" },
      cwd: "C:/player2",
      sessionId: "player2-companion-farm",
      bridgeDirectory: bridgeRoot,
    });

    await expect(runner.runDecisionTurn(2)).rejects.toBeInstanceOf(RequestNotWrittenError);
  });

  it("closes the owned SDK process", async () => {
    const runner = new DshSessionDecisionRunner({
      launch: { command: "dsh-jsonrpc-agent" },
      cwd: "C:/player2",
      sessionId: "player2-companion-farm",
      bridgeDirectory: bridgeRoot,
    });

    await runner.close();

    expect(close).toHaveBeenCalledOnce();
  });
});
