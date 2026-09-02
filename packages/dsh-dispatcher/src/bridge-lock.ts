import { renameSync, writeFileSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * A cooperative cross-process lock for one bridge directory.
 *
 * Two dispatchers on one bridge would race over the write-once turn files, so
 * a second process must be able to detect a live owner and step aside. The
 * lock carries a heartbeat; a stale heartbeat means the owner died and the
 * lock can be taken over. It lives beside the bridge data but is dispatcher
 * metadata: unlike bridge files it is mutable and never write-once.
 */
export class BridgeLock {
  private readonly path: string;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private readonly now: () => number;
  private readonly pid: number;
  private heartbeat?: ReturnType<typeof setInterval>;
  private held = false;

  public constructor(
    bridgeDirectory: string,
    options: {
      heartbeatMs?: number;
      staleMs?: number;
      now?: () => number;
      pid?: number;
    } = {},
  ) {
    this.path = join(bridgeDirectory, "dispatcher.lock");
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.staleMs = options.staleMs ?? 45_000;
    this.now = options.now ?? Date.now;
    this.pid = options.pid ?? process.pid;
  }

  /**
   * Takes the lock when no live owner holds it.
   * @returns false when another live process owns this bridge.
   */
  public async acquire(): Promise<boolean> {
    if (this.held) {
      return false;
    }
    let existing: string | undefined;
    try {
      existing = await readFile(this.path, "utf8");
    } catch {
      existing = undefined;
    }
    if (existing !== undefined) {
      let owner: { pid?: number; heartbeatAt?: number } = {};
      try {
        owner = JSON.parse(existing) as { pid?: number; heartbeatAt?: number };
      } catch {
        owner = {};
      }
      const heartbeatAt = typeof owner.heartbeatAt === "number" ? owner.heartbeatAt : 0;
      if (heartbeatAt > 0 && this.now() - heartbeatAt < this.staleMs) {
        return false;
      }
    }

    await this.write();
    this.held = true;
    this.heartbeat = setInterval(() => {
      void this.write().catch(() => undefined);
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
    return true;
  }

  /** Releases the lock if this process still holds it; never throws. */
  public async release(): Promise<void> {
    if (!this.held) {
      return;
    }
    this.held = false;
    if (this.heartbeat !== undefined) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    try {
      const serialized = await readFile(this.path, "utf8");
      const owner = JSON.parse(serialized) as { pid?: number };
      if (owner.pid !== this.pid) {
        return;
      }
      await unlink(this.path);
    } catch {
      // A missing or replaced lock file needs no cleanup.
    }
  }

  private async write(): Promise<void> {
    // Readers may inspect the heartbeat while it refreshes. Replacing a fully
    // written sibling prevents them from ever seeing a truncated JSON lock.
    const temporary = `${this.path}.${this.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ pid: this.pid, heartbeatAt: this.now() })}\n`, "utf8");
    renameSync(temporary, this.path);
  }
}
