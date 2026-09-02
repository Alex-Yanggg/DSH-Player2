import { existsSync, watch, type FSWatcher } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { actionRequestSchema, bridgeFileLimit, decisionTurnEnvelopeSchema } from "@dsh-player2/contracts";
import type { DecisionTurnRunner } from "./decision-runner.js";

/** Minimal logging surface so hosts can route dispatcher events to SMAPI or console. */
export interface DispatcherLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface BridgeDispatcherOptions {
  /** Trusted Player-owned bridge root containing inbox/ and outbox/. */
  readonly bridgeDirectory: string;
  /** Wakes the dedicated DSH session for one sequence; must guarantee the request file. */
  readonly runner: DecisionTurnRunner;
  /** Full-directory scan cadence; file-system events only trigger an earlier pass. */
  readonly pollIntervalMs?: number;
  /** Bounded attempts per turn before this process gives the sequence up. */
  readonly maxAttempts?: number;
  /** Base backoff before retry attempts; doubles per additional attempt. */
  readonly retryBackoffMs?: number;
  /** Attach a best-effort inbox watcher for lower latency; polling remains the backstop. */
  readonly useWatcher?: boolean;
  readonly logger?: DispatcherLogger;
}

export interface DispatcherStats {
  readonly dispatched: number;
  readonly failed: number;
}

const INBOX_TURN_FILE = /^turn-(\d+)\.json$/;

function consoleLogger(): DispatcherLogger {
  const prefix = "player2-dispatch";
  return {
    info: (message) => console.info(`${prefix}: ${message}`),
    warn: (message) => console.warn(`${prefix}: ${message}`),
    error: (message) => console.error(`${prefix}: ${message}`),
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Drives one dedicated DSH composition from Player-authored turn files.
 *
 * The dispatcher is only a waker: it never grants consent, never writes grant or
 * receipt files, and treats the outbox request — not the model's final message —
 * as the sole completion evidence. Restarts are idempotent because a sequence
 * with any persisted request is already answered, and the write-once bridge
 * refuses conflicting rewrites.
 */
export class BridgeDispatcher {
  private readonly root: string;
  private readonly runner: DecisionTurnRunner;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly useWatcher: boolean;
  private readonly logger: DispatcherLogger;
  private readonly failedSequences = new Set<number>();
  private readonly warnedInvalidRequests = new Set<number>();
  private readonly wakeResolvers = new Set<() => void>();

  private stopping = false;
  private draining = false;
  private drainAgain = false;
  private watcher: FSWatcher | undefined;
  private watcherTarget: "inbox" | "root" | undefined;
  private loopPromise: Promise<void> | undefined;
  private currentPass: Promise<void> | undefined;
  private dispatchedCount = 0;
  private failedCount = 0;

  public constructor(options: BridgeDispatcherOptions) {
    if (options.bridgeDirectory.trim().length === 0) {
      throw new Error("The dispatcher requires a non-empty bridgeDirectory.");
    }
    this.root = resolve(options.bridgeDirectory);
    this.runner = options.runner;
    this.pollIntervalMs = Math.max(options.pollIntervalMs ?? 2000, 50);
    this.maxAttempts = Math.max(options.maxAttempts ?? 3, 1);
    this.retryBackoffMs = Math.max(options.retryBackoffMs ?? 2000, 0);
    this.useWatcher = options.useWatcher ?? true;
    this.logger = options.logger ?? consoleLogger();
  }

  /**
   * Run one deterministic pass over pending turns, then keep scanning in the
   * background until {@link stop}. Resolves after the initial pending set settles
   * so callers can await the already-present work.
   */
  public async start(): Promise<void> {
    if (this.loopPromise !== undefined) {
      throw new Error("BridgeDispatcher is already running.");
    }
    try {
      await stat(this.root);
    } catch {
      throw new Error(`The configured bridgeDirectory does not exist: ${this.root}`);
    }
    this.stopping = false;
    const initialPass = this.guardedPass();
    this.currentPass = initialPass;
    await initialPass;
    this.currentPass = undefined;
    if (this.stopping) {
      return;
    }
    this.loopPromise = this.runLoop();
  }

  /** Stop scanning and wake the loop so the current work can settle. */
  public async stop(): Promise<void> {
    this.stopping = true;
    this.closeWatcher();
    this.wake();
    await this.currentPass?.catch(() => undefined);
    this.currentPass = undefined;
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  /** One full scan-and-drain pass; safe to call directly for deterministic tests. */
  public async dispatchPending(): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.drainAgain = false;
        this.ensureWatcher();
        for (const sequence of await this.pendingSequences()) {
          await this.processOne(sequence);
        }
      } while (this.drainAgain);
    } finally {
      this.draining = false;
    }
  }

  public get stats(): DispatcherStats {
    return { dispatched: this.dispatchedCount, failed: this.failedCount };
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      await this.pause(this.pollIntervalMs);
      if (this.stopping) {
        return;
      }
      const pass = this.guardedPass();
      this.currentPass = pass;
      await pass;
    }
  }

  private async guardedPass(): Promise<void> {
    try {
      await this.dispatchPending();
    } catch (error) {
      this.logger.error(`Bridge scan failed; continuing: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async pendingSequences(): Promise<number[]> {
    const entries = await readdir(join(this.root, "inbox")).catch((error: unknown) => {
      if (isNotFound(error)) {
        return [] as string[];
      }
      throw error;
    });
    const sequences: number[] = [];
    for (const entry of entries) {
      const match = INBOX_TURN_FILE.exec(entry);
      if (match !== null) {
        sequences.push(Number.parseInt(match[1], 10));
      }
    }
    sequences.sort((a, b) => a - b);
    const pending: number[] = [];
    for (const sequence of sequences) {
      if (this.failedSequences.has(sequence)) {
        continue;
      }
      if (await this.isAnswered(sequence)) {
        continue;
      }
      pending.push(sequence);
    }
    return pending;
  }

  private async isAnswered(sequence: number): Promise<boolean> {
    let serialized: string;
    try {
      serialized = await readFile(join(this.root, "outbox", `request-${sequence}.json`), "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch {
      parsed = undefined;
    }
    if (!actionRequestSchema.safeParse(parsed).success && !this.warnedInvalidRequests.has(sequence)) {
      this.warnedInvalidRequests.add(sequence);
      this.logger.warn(
        `outbox/request-${sequence}.json exists but is not a valid awaiting-player request; treating it as answered without re-dispatch.`,
      );
    }
    return true;
  }

  /**
   * Reject turns this bridge contract cannot legally observe before any model
   * session is woken. A stale mod build writes envelopes the current plugin
   * refuses; failing fast here keeps that diagnosis local, immediate, and free
   * of wasted model calls.
   */
  private async preflightTurn(sequence: number): Promise<void> {
    const path = join(this.root, "inbox", `turn-${sequence}.json`);
    let serialized: string;
    try {
      serialized = await readFile(path, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error(`inbox/turn-${sequence}.json disappeared before dispatch.`);
      }
      throw error;
    }
    if (Buffer.byteLength(serialized, "utf8") > bridgeFileLimit) {
      throw new Error(`inbox/turn-${sequence}.json exceeds the ${bridgeFileLimit} byte bridge limit.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch {
      throw new Error(`inbox/turn-${sequence}.json is not valid JSON.`);
    }
    const envelope = decisionTurnEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      const issue = envelope.error.issues[0];
      throw new Error(
        `inbox/turn-${sequence}.json does not match the bridge contract at "${issue.path.join(".") || "(root)"}": ${issue.message}. ` +
        "This usually means the deployed SMAPI mod is older than this dispatcher's plugin build; " +
        "rebuild and redeploy the mod (see stardew-mod/README.md), then start a new game day.",
      );
    }
  }

  private async processOne(sequence: number): Promise<void> {
    try {
      await this.preflightTurn(sequence);
    } catch (error) {
      // The turn file is Player-authored and immutable: a violation is
      // deterministic, so retrying a model session cannot repair it.
      this.failedSequences.add(sequence);
      this.failedCount += 1;
      this.logger.error(
        `Decision turn ${sequence} cannot be dispatched: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.runner.runDecisionTurn(sequence);
        this.dispatchedCount += 1;
        this.logger.info(`Dispatched decision turn ${sequence} through the dedicated DSH session.`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= this.maxAttempts) {
          this.failedSequences.add(sequence);
          this.failedCount += 1;
          this.logger.error(`Decision turn ${sequence} failed after ${attempt} attempts: ${message}`);
          return;
        }
        const backoffMs = this.retryBackoffMs * 2 ** (attempt - 1);
        this.logger.warn(`Decision turn ${sequence} attempt ${attempt} failed: ${message}; retrying in ${backoffMs}ms.`);
        await this.pause(backoffMs);
        if (this.stopping) {
          return;
        }
      }
    }
  }

  private ensureWatcher(): void {
    if (!this.useWatcher || this.watcherTarget === "inbox") {
      return;
    }
    // The game creates inbox/ on its first turn; until then watch the bridge
    // root so the creating event still wakes an early pass. Once inbox exists,
    // reattach to it on this pass.
    const inboxExists = existsSync(join(this.root, "inbox"));
    if (this.watcherTarget === "root" && !inboxExists) {
      return;
    }
    this.closeWatcher();
    const target = inboxExists ? join(this.root, "inbox") : this.root;
    try {
      this.watcher = watch(target, { persistent: false }, () => this.wake());
      this.watcherTarget = inboxExists ? "inbox" : "root";
      this.watcher.on("error", () => this.closeWatcher());
    } catch (error) {
      // Polling remains the correctness backstop, but the watcher degradation
      // is surfaced so latency surprises are never silent.
      this.logger.warn(
        `Inbox watcher unavailable on ${target}; falling back to polling: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.watcherTarget = undefined;
    }
  }

  private closeWatcher(): void {
    const watcher = this.watcher;
    this.watcher = undefined;
    this.watcherTarget = undefined;
    watcher?.close();
  }

  private wake(): void {
    for (const resolve of [...this.wakeResolvers]) {
      resolve();
    }
  }

  /** Settle after the delay or an early wake, whichever comes first. */
  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const settle = () => {
        clearTimeout(timer);
        this.wakeResolvers.delete(settle);
        resolve();
      };
      const timer = setTimeout(settle, ms);
      this.wakeResolvers.add(settle);
    });
  }
}
