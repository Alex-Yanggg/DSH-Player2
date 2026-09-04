import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import {
  buildAttentionBlock,
  collectEnvelopeTargets,
  createTemperamentHandlers,
  createTemperamentState,
  decisionStopReflection,
  extractTurnReference,
  MAX_STOP_REFLECTIONS,
  reflectOnToolCall,
  scoreReceipts,
  socialStopReflection,
  TEMPERAMENT_ATTENTION_TAG,
  type ReceiptDigestEntry,
} from "./temperament.js";

const roots: string[] = [];
const testSoul = {
  values: ["kindness"],
  bonds: ["the player"],
  voice: "playful and honest",
  boundaries: ["never invent facts"],
};

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "player2-temperament-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function userMessage(text: string): UserMessage {
  return { id: `m-${Math.random()}`, role: "user", content: [{ type: "text", text }], source: { kind: "user" } } as UserMessage;
}

const decisionPrompt = [
  "Handle this PLAYER_DECISION_TURN using the installed Player2 companion skill and tools.",
  'PLAYER_DECISION_TURN={"version":"0.1.1","sequence":7}',
].join("\n");

function receiptEntry(overrides: Partial<ReceiptDigestEntry> = {}): ReceiptDigestEntry {
  return {
    sequence: 3,
    proposalId: "turn-3:proposal",
    capabilityId: "visual-receipt",
    status: "completed",
    occurredAt: "2026-08-29T00:00:00.000Z",
    target: "stardew-location:Farm:tile:12,8",
    scope: "visual marker + sound only",
    detail: "A temporary world marker was shown.",
    ...overrides,
  };
}

describe("temperament attention", () => {
  it("extracts the decision turn reference from the host prompt", () => {
    const reference = extractTurnReference(decisionPrompt);
    expect(reference).toEqual({ lane: "decision", sequence: 7 });
    expect(extractTurnReference("no marker here")).toBeNull();
  });

  it("re-validates the embedded social envelope before using it", () => {
    const envelope = {
      version: "0.0.9",
      id: "f4e3c2b1-aaaa-4bbb-8ccc-1234567890ab",
      createdAt: "2026-08-30T00:00:00.000Z",
      gameDay: 2,
      companion: { name: "Mira", role: "farm partner", soul: testSoul },
      adapter: { id: "stardew-semantic", gameId: "stardew-valley", accessMode: "semantic", capabilities: [] },
      observations: [{
        id: "world-1", kind: "world", observedAt: "2026-08-30T00:00:00.000Z", expiresAt: null,
        source: "stardew-smapi", accessMode: "semantic", confidence: 1, facts: { target: "stardew-location:Farm:tile:1,1" },
      }],
      priorMemory: null,
      latestReceipt: null,
      message: { id: "message-1", content: "hi", createdAt: "2026-08-30T00:00:00.000Z" },
    };
    const reference = extractTurnReference(`PLAYER_SOCIAL_TURN=${JSON.stringify(envelope)}`);
    expect(reference?.lane).toBe("social");
    expect(extractTurnReference('PLAYER_SOCIAL_TURN={"version":"9.9.9"}')).toBeNull();
  });

  it("collects targets from observation facts and receipt memories", () => {
    const targets = collectEnvelopeTargets({
      observations: [{ facts: { target: "stardew-location:Farm:tile:12,8" } }, { facts: {} }],
      priorMemory: { target: "stardew-location:Farm:tile:12,8" },
      latestReceipt: { target: "stardew-location:Beach:tile:4,4" },
    });
    expect(targets).toEqual([
      "stardew-location:Farm:tile:12,8",
      "stardew-location:Beach:tile:4,4",
    ]);
  });

  it("ranks related receipts first and keeps recency inside each group", () => {
    const entries = [
      receiptEntry({ sequence: 5, target: "stardew-location:Town:tile:1,1" }),
      receiptEntry({ sequence: 4, target: "stardew-location:Farm:tile:9,9" }),
      receiptEntry({ sequence: 3, target: "stardew-location:Farm:tile:12,8" }),
      receiptEntry({ sequence: 2, target: null }),
    ];
    const scored = scoreReceipts(entries, ["stardew-location:Farm:tile:12,8"]);
    expect(scored.map(({ entry }) => entry.sequence)).toEqual([3, 4, 5, 2]);
    expect(scored[0]?.related).toBe(true);
    expect(scored[1]?.related).toBe(true);
    expect(scored[3]?.related).toBe(false);
  });

  it("renders a bounded attention block that keeps the footer", () => {
    const entries = scoreReceipts(
      Array.from({ length: 40 }, (_, index) => receiptEntry({ sequence: index + 1 })),
      [],
    );
    const block = buildAttentionBlock({ entries, maxChars: 900 });
    expect(block).toContain(TEMPERAMENT_ATTENTION_TAG);
    expect(block).toContain("ground this turn in the fresh observations only.");
    expect(block.length).toBeLessThanOrEqual(900);
  });

  it("injects one bounded attention message per turn and fails open", async () => {
    const root = await makeRoot();
    const observe = vi.fn().mockResolvedValue({
      observations: [{ facts: { target: "stardew-location:Farm:tile:12,8" } }],
    });
    const recall = vi.fn().mockResolvedValue({ entries: [receiptEntry()], skipped: 0 });
    const { preStep } = createTemperamentHandlers({
      mode: "decision",
      bridgeDirectory: root,
      bridge: { observe, recall } as never,
    });
    const next = async () => ({ kind: "enter" as const, messages: [userMessage(decisionPrompt)] });

    const first = await preStep({ turn: 1, messages: [userMessage(decisionPrompt)] }, next);
    expect(first.kind).toBe("enter");
    expect(first.messages).toHaveLength(2);
    expect(JSON.stringify(first.messages[0])).toContain(TEMPERAMENT_ATTENTION_TAG);
    expect(observe).toHaveBeenCalledWith(7);
    expect(recall).toHaveBeenCalledOnce();

    const second = await preStep({ turn: 1, messages: [userMessage(decisionPrompt)] }, next);
    expect(second.messages).toHaveLength(1);
    expect(recall).toHaveBeenCalledOnce();
  });

  it("leaves the step untouched when the bridge read fails", async () => {
    const root = await makeRoot();
    const { preStep } = createTemperamentHandlers({
      mode: "decision",
      bridgeDirectory: root,
      bridge: {
        observe: vi.fn().mockRejectedValue(new Error("bridge unavailable")),
        recall: vi.fn().mockRejectedValue(new Error("bridge unavailable")),
      } as never,
    });
    const decision = await preStep(
      { turn: 2, messages: [userMessage(decisionPrompt)] },
      async () => ({ kind: "enter" as const, messages: [userMessage(decisionPrompt)] }),
    );
    expect(decision.kind).toBe("enter");
    expect(decision.messages).toHaveLength(1);
  });
});

describe("temperament reflection guard", () => {
  it("demands observe before propose and propose before requestAction", () => {
    const state = createTemperamentState();
    state.currentTurn = 1;
    const handler = createTemperamentHandlers({ mode: "decision", bridgeDirectory: "." }, state);
    const deny = (name: string, args: unknown) => reflectOnToolCall(state, state.currentTurn, name, args);

    expect(deny("companion_propose", { sequence: 7 })).toContain("game_observe");
    expect(deny("game_request_action", { sequence: 7 })).toContain("companion_propose");

    handler.recordToolSuccess("game_observe", { sequence: 7 });
    expect(deny("companion_propose", { sequence: 7 })).toBeUndefined();
    expect(deny("game_request_action", { sequence: 7 })).toContain("companion_propose");

    handler.recordToolSuccess("companion_propose", { sequence: 7 });
    expect(deny("game_request_action", { sequence: 7 })).toBeUndefined();
    expect(deny("skill", {})).toBeUndefined();
  });
});

describe("temperament turn-stopping", () => {
  it("steers a decision turn that closes without its completion order", async () => {
    const root = await makeRoot();
    const { turnStopping, state } = createTemperamentHandlers({ mode: "decision", bridgeDirectory: root });
    state.currentTurn = 1;
    state.attendedTurns.set(1, { lane: "decision", sequence: 7 });
    const steer = vi.fn();
    await turnStopping({ turn: 1, agent: { steer, session: { events: [] } } });
    expect(steer).toHaveBeenCalledOnce();
    expect(steer.mock.calls[0]?.[0]).toMatchObject({ role: "user" });
    expect(JSON.stringify(steer.mock.calls[0]?.[0])).toContain(decisionStopReflection(7).slice(0, 40));
  });

  it("does not steer when the completion order already exists", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "outbox"), { recursive: true });
    await writeFile(join(root, "outbox", "request-7.json"), "{}", "utf8");
    const { turnStopping, state } = createTemperamentHandlers({ mode: "decision", bridgeDirectory: root });
    state.currentTurn = 1;
    state.attendedTurns.set(1, { lane: "decision", sequence: 7 });
    const steer = vi.fn();
    await turnStopping({ turn: 1, agent: { steer, session: { events: [] } } });
    expect(steer).not.toHaveBeenCalled();
  });

  it("caps its reflections per turn", async () => {
    const root = await makeRoot();
    const { turnStopping, state } = createTemperamentHandlers({ mode: "decision", bridgeDirectory: root });
    state.currentTurn = 1;
    state.attendedTurns.set(1, { lane: "decision", sequence: 7 });
    const steer = vi.fn();
    const agent = { steer, session: { events: [] } };
    for (let attempt = 0; attempt < MAX_STOP_REFLECTIONS + 2; attempt++) {
      await turnStopping({ turn: 1, agent });
    }
    expect(steer).toHaveBeenCalledTimes(MAX_STOP_REFLECTIONS);
  });

  it("steers a social turn whose final message is not the structured response", async () => {
    const root = await makeRoot();
    const { turnStopping, state } = createTemperamentHandlers({ mode: "social", bridgeDirectory: root });
    state.currentTurn = 1;
    state.attendedTurns.set(1, {
      lane: "social",
      envelope: {
        version: "0.0.9",
        id: "f4e3c2b1-aaaa-4bbb-8ccc-1234567890ab",
        createdAt: "2026-08-30T00:00:00.000Z",
        gameDay: 2,
        companion: { name: "Mira", role: "farm partner", soul: testSoul },
        adapter: { id: "a", gameId: "g", accessMode: "semantic", capabilities: [] },
        observations: [],
        priorMemory: null,
        latestReceipt: null,
        message: { id: "m", content: "hi", createdAt: "2026-08-30T00:00:00.000Z" },
      },
    });
    const events = [{
      type: "assistant/message",
      data: { message: { content: [{ type: "text", text: "I feel like chatting, the weather is nice!" }] } },
    }];
    const steer = vi.fn();
    await turnStopping({ turn: 1, agent: { steer, session: { events } } });
    expect(steer).toHaveBeenCalledOnce();
    expect(JSON.stringify(steer.mock.calls[0]?.[0])).toContain(socialStopReflection().slice(0, 40));
  });
});
