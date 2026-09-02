import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NativeSocialFileBridge } from "./native-social-file-bridge.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("NativeSocialFileBridge", () => {
  it("persists a player-visible result only after its DSH runner returns grounded JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-social-"));
    roots.push(root);
    const id = "9a2ef15c-e576-4194-a855-185c1786ad5c";
    const runner = {
      runStructuredText: async () => JSON.stringify({
        kind: "reply", text: "I can see the rain at the farm.", basedOnObservationIds: ["world-1"],
        basedOnMemoryId: null, rememberLatestReceipt: false, memorySummary: null,
      }),
    };
    const bridge = new NativeSocialFileBridge({ bridgeDirectory: root, runner, logger: { info() {}, error() {} } });
    await bridge.start();
    await writeFile(join(root, "social-inbox", `turn-${id}.json`), JSON.stringify({
      version: "0.0.9", id, createdAt: "2026-08-29T00:00:00.000Z", gameDay: 1,
      companion: {
        name: "Mira", role: "farm partner",
        soul: { values: ["kindness"], bonds: ["the player"], voice: "playful and honest", boundaries: ["never invent facts"] },
      },
      adapter: { id: "stardew-smapi", gameId: "stardew-valley", accessMode: "semantic", capabilities: [] },
      observations: [{ id: "world-1", kind: "world", observedAt: "2026-08-29T00:00:00.000Z", expiresAt: null, source: "stardew-smapi", accessMode: "semantic", confidence: 1, facts: { weather: "rain" } }],
      priorMemory: null, latestReceipt: null,
      message: { id: "message-1", content: "What do you see?", createdAt: "2026-08-29T00:00:00.000Z" },
    }));
    const result = JSON.parse(await waitForResult(join(root, "social-outbox", `result-${id}.json`)));
    expect(result).toMatchObject({ id, status: "completed", source: "dsh", response: { text: "I can see the rain at the farm." } });
    await bridge.stop();
  });
});

async function waitForResult(path: string): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return readFile(path, "utf8");
}
