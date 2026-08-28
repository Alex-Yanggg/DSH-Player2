import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const close = vi.fn();

vi.mock("@deepseek-ai/dsh-sdk-client", () => ({
  DeepSeekHarness: class {
    public run = run;
    public close = close;
    public constructor(_options: unknown) {}
  },
}));

const { DshSdkTextRunner } = await import("./index.js");

describe("DshSdkTextRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a fresh bounded DSH session for each social turn", async () => {
    run.mockResolvedValueOnce({ finalResponse: "first", events: [] }).mockResolvedValueOnce({
      finalResponse: "second",
      events: [{ type: "turn/start", data: { turn: 1 } }],
    });
    const runner = new DshSdkTextRunner({
      launch: { command: "dsh-jsonrpc-agent" },
      cwd: "C:/player2",
    });

    await expect(runner.runStructuredText("one")).resolves.toBe("first");
    await expect(runner.runStructuredText("two")).resolves.toBe("second");

    expect(run).toHaveBeenNthCalledWith(1, "one", { sessionId: "player2-social-1" });
    expect(run).toHaveBeenNthCalledWith(2, "two", { sessionId: "player2-social-2" });
    expect(runner.lastRunEvents).toEqual([{ type: "turn/start", data: { turn: 1 } }]);
  });

  it("closes the owned SDK process", async () => {
    const runner = new DshSdkTextRunner({ launch: { command: "dsh-jsonrpc-agent" }, cwd: "C:/player2" });

    await runner.close();

    expect(close).toHaveBeenCalledOnce();
  });
});
