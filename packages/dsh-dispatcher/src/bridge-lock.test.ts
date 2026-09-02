import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeLock } from "./bridge-lock.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.useRealTimers();
});

describe("BridgeLock", () => {
  it("acquires, blocks a second live owner, refreshes its heartbeat, and releases cleanly", async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(join(tmpdir(), "player2-lock-"));
    roots.push(root);
    let clock = 1_000_000;
    const now = () => clock;
    const lock = new BridgeLock(root, { now, heartbeatMs: 10_000 });

    await expect(lock.acquire()).resolves.toBe(true);
    const second = new BridgeLock(root, { now });
    await expect(second.acquire()).resolves.toBe(false);

    clock += 11_000;
    await vi.advanceTimersByTimeAsync(11_000);
    const refreshed = JSON.parse(await readFile(join(root, "dispatcher.lock"), "utf8"));
    expect(refreshed.heartbeatAt).toBe(1_011_000);

    await lock.release();
    await expect(second.acquire()).resolves.toBe(true);
    await second.release();
    await expect(readFile(join(root, "dispatcher.lock"), "utf8")).rejects.toThrow();
  });

  it("takes over a lock whose heartbeat went stale or is unreadable", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-lock-"));
    roots.push(root);
    let clock = 2_000_000;
    const now = () => clock;
    await writeFile(
      join(root, "dispatcher.lock"),
      `${JSON.stringify({ pid: 999999, heartbeatAt: clock })}\n`,
      "utf8",
    );

    const stale = new BridgeLock(root, { now, staleMs: 45_000 });
    clock += 46_000;
    await expect(stale.acquire()).resolves.toBe(true);
    await stale.release();

    await writeFile(join(root, "dispatcher.lock"), "not json", "utf8");
    const repaired = new BridgeLock(root, { now });
    await expect(repaired.acquire()).resolves.toBe(true);
    await repaired.release();
  });
});
