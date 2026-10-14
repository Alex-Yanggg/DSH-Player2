import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bodyCancelSchema,
  bodyDeclarationSchema,
  bodyFrameLimit,
  bodyProtocolVersion,
  bodySpeechSchema,
  bodyStateFileLimit,
  bodyStateSchema,
  bodyTaskSchema,
  bodyTaskStatusSchema,
  bodyTerminalStatuses,
  bodyWorldSchema,
  type BodyDeclaration,
  type BodyInputStep,
  type BodyState,
  type BodyTask,
  type BodyTaskStatus,
  type BodyUntil,
  type BodyWorld,
} from "@dsh-player2/contracts";

/** The outcome of one submitted input sequence as the plugin saw it. */
export interface BodyRun {
  readonly seq: number;
  readonly status: BodyTaskStatus["status"] | "timeout";
  readonly reason: string | null;
  readonly events: BodyTaskStatus["events"];
  /** State read after the adapter finished the task (revision at least the status revision). */
  readonly state: BodyState | undefined;
  /** Wall-clock milliseconds from writing the task to the adapter accepting it. */
  readonly acceptMs: number | undefined;
  readonly totalMs: number;
}

export interface BodyPort {
  declaration(): Promise<BodyDeclaration>;
  state(): Promise<BodyState>;
  world(): Promise<BodyWorld>;
  run(steps: readonly BodyInputStep[], options?: { until?: BodyUntil; fastState?: boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<BodyRun>;
  cancelActive(): Promise<void>;
  say(text: string): Promise<number>;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * Plugin end of the body file lane (P2-0021): reads what the adapter exports,
 * writes raw input sequences and cancels, and waits for their status. It owns
 * no game knowledge; navigation and goals are built on top of it.
 */
export class BodyFileClient implements BodyPort {
  private lastSeq = 0;
  private lastSpeech = 0;
  private active: { seq: number; taskId: string } | undefined;

  public constructor(private readonly session: string, private readonly pollMs = 40) {}

  private get body(): string { return join(this.session, "body"); }

  public async declaration(): Promise<BodyDeclaration> {
    return bodyDeclarationSchema.parse(await readBounded(join(this.body, "declaration.json"), bodyFrameLimit));
  }

  public async state(): Promise<BodyState> {
    return bodyStateSchema.parse(await readBounded(join(this.body, "state.json"), bodyStateFileLimit));
  }

  public async world(): Promise<BodyWorld> {
    return bodyWorldSchema.parse(await readBounded(join(this.body, "world.json"), bodyStateFileLimit));
  }

  /** Writes one task, then waits until the adapter ends it (or the wait times out and cancels it). */
  public async run(steps: readonly BodyInputStep[], options: { until?: BodyUntil; fastState?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<BodyRun> {
    const started = Date.now();
    const seq = await this.nextSeq();
    const task: BodyTask = bodyTaskSchema.parse({
      version: bodyProtocolVersion,
      taskId: randomUUID(),
      seq,
      createdAt: new Date().toISOString(),
      steps,
      ...(options.until === undefined ? {} : { until: options.until }),
      ...(options.fastState === true ? { fastState: true } : {}),
    });
    await mkdir(join(this.body, "input"), { recursive: true });
    await writeOnce(join(this.body, "input", `task-${seq}.json`), task);
    this.active = { seq, taskId: task.taskId };
    const timeoutMs = options.timeoutMs ?? estimateMs(steps) + 15_000;
    let acceptMs: number | undefined;
    let status: BodyTaskStatus | undefined;
    // A paused world (a menu, the chat, the player away) holds the task: the
    // wait is not spent, so a hand never gives up because the game stopped.
    let deadline = started + timeoutMs;
    let checked = started;
    try {
      for (;;) {
        if (options.signal?.aborted) {
          await this.cancel(seq, task.taskId);
          return { seq, status: "cancelled", reason: "aborted by the plugin", events: status?.events ?? [], state: await this.state().catch(() => undefined), acceptMs, totalMs: Date.now() - started };
        }
        status = await this.readStatus(seq);
        if (status !== undefined && acceptMs === undefined) acceptMs = Date.now() - started;
        if (status !== undefined && bodyTerminalStatuses.has(status.status)) break;
        if (Date.now() - checked >= 500) {
          if ((await this.state().catch(() => undefined))?.paused === true) deadline += Date.now() - checked;
          checked = Date.now();
        }
        if (Date.now() > deadline) {
          await this.cancel(seq, task.taskId);
          return { seq, status: "timeout", reason: status === undefined ? "the adapter never answered (is the game running and the save loaded?)" : `still ${status.status} after ${timeoutMs} ms`, events: status?.events ?? [], state: await this.state().catch(() => undefined), acceptMs, totalMs: Date.now() - started };
        }
        await sleep(this.pollMs, options.signal);
      }
    } finally {
      if (this.active?.seq === seq) this.active = undefined;
    }
    const state = await this.stateAtLeast(status.stateRevision, options.signal);
    return { seq, status: status.status, reason: status.reason, events: status.events, state, acceptMs, totalMs: Date.now() - started };
  }

  public async cancelActive(): Promise<void> {
    const active = this.active;
    if (active !== undefined) await this.cancel(active.seq, active.taskId);
  }

  /** Queues one line the companion says in the world. */
  public async say(text: string): Promise<number> {
    const directory = join(this.session, "speech");
    await mkdir(directory, { recursive: true });
    const seq = Math.max(this.lastSpeech + 1, await maxSeq(directory, /^say-(\d+)\.json(?:\.shown)?$/) + 1, baseSeq());
    this.lastSpeech = seq;
    await writeOnce(join(directory, `say-${seq}.json`), bodySpeechSchema.parse({ version: bodyProtocolVersion, seq, text: text.trim().slice(0, 400), at: new Date().toISOString() }));
    return seq;
  }

  private async cancel(seq: number, taskId: string): Promise<void> {
    await writeOnce(join(this.body, "input", `cancel-${seq}.json`), bodyCancelSchema.parse({ version: bodyProtocolVersion, seq, taskId, at: new Date().toISOString() })).catch(() => undefined);
  }

  private async readStatus(seq: number): Promise<BodyTaskStatus | undefined> {
    try {
      return bodyTaskStatusSchema.parse(await readBounded(join(this.body, "status", `task-${seq}.json`), bodyFrameLimit));
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  private async stateAtLeast(revision: number, signal?: AbortSignal): Promise<BodyState | undefined> {
    const deadline = Date.now() + 2_000;
    for (;;) {
      const state = await this.state().catch(() => undefined);
      if (state !== undefined && state.revision >= revision) return state;
      if (Date.now() > deadline || signal?.aborted) return state;
      await sleep(this.pollMs, signal);
    }
  }

  /**
   * Sequences only grow: a time base keeps them above anything an earlier
   * plugin process wrote, and existing files are scanned once.
   */
  private async nextSeq(): Promise<number> {
    if (this.lastSeq === 0) this.lastSeq = await maxSeq(join(this.body, "input"), /^(?:task|cancel)-(\d+)\.json$/);
    this.lastSeq = Math.max(this.lastSeq + 1, baseSeq());
    return this.lastSeq;
  }
}

/** Rough wall time of a sequence, for wait timeouts. */
export function estimateMs(steps: readonly BodyInputStep[]): number {
  return steps.reduce((sum, step) => sum + Math.max(step.ms, 17), 0);
}

function baseSeq(): number {
  return Math.floor(Date.now() / 1000) - 1_700_000_000;
}

async function maxSeq(directory: string, pattern: RegExp): Promise<number> {
  let max = 0;
  try {
    for (const name of await readdir(directory)) {
      const match = pattern.exec(name);
      if (match !== null) max = Math.max(max, Number.parseInt(match[1], 10));
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return max;
}

async function readBounded(path: string, limit: number): Promise<unknown> {
  const info = await stat(path);
  if (info.size > limit) throw new Error(`${path} exceeds ${limit} bytes`);
  return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, ""));
}

async function writeOnce(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value)}\n`, "utf8");
  // A hard link appears complete and atomically, and refuses to replace an
  // existing frame, so the adapter never reads half a task.
  try {
    await link(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
