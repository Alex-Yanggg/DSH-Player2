/**
 * Goal lane (P2-0021 T21.4): the companion's hands. The social lane reads a
 * goal from the player's own words; the player's request is the
 * authorization, so the goal starts at once with no consent round trip. This
 * lane owns the goal record, the engineering budget (anti-runaway only), the
 * stop path, and the per-turn prompt. What to do and how is the model's call.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  cheatGrantSchema,
  cheatOpSchema,
  defaultGoalBudget,
  goalInterruptSchema,
  goalOpSchema,
  goalRecordSchema,
  goalTerminalStatuses,
  goalVersion,
  type CheatOp,
  type GoalBudget,
  type GoalOp,
  type GoalRecord,
  type PersonaKnobs,
} from "@dsh-player2/contracts";
import { BodyFileClient, PersonaDice, tendencyLines, turnNudges, type BodyPort, type GoalController } from "@dsh-player2/dsh-companion-plugin";

/** One model turn on a goal's agent. The host builds it from a DSH lane agent; tests script it. */
export interface GoalTurnRunner {
  /** Runs one turn and resolves when the agent is idle; rejects with the DSH turn error. */
  turn(prompt: string): Promise<void>;
  /** Interrupts the turn in flight (player stop). */
  cancel(): void;
  dispose(): Promise<void>;
}

export type GoalRunnerFactory = (input: { session: string; record: GoalRecord; controller: GoalController }) => Promise<GoalTurnRunner>;

export interface GoalLaneOptions {
  readonly createRunner: GoalRunnerFactory;
  readonly trace: (code: string, detail: Record<string, unknown>) => Promise<void>;
  readonly budget?: GoalBudget;
  /** How long to wait while the body is absent or the game is paused (ms). */
  readonly idleMs?: number;
}

/** The social reply's optional goal/cheat extras, validated; malformed extras are dropped with a reason. */
export function goalExtrasOf(raw: unknown): { goal: GoalOp | null; cheat: CheatOp | null; dropped: string[] } {
  const reply = (raw ?? {}) as { goal?: unknown; cheat?: unknown };
  const dropped: string[] = [];
  let goal: GoalOp | null = null;
  let cheat: CheatOp | null = null;
  if (reply.goal !== undefined && reply.goal !== null) {
    const parsed = goalOpSchema.safeParse(reply.goal);
    if (parsed.success) goal = parsed.data; else dropped.push("goal");
  }
  if (reply.cheat !== undefined && reply.cheat !== null) {
    const parsed = cheatOpSchema.safeParse(reply.cheat);
    if (parsed.success) cheat = parsed.data; else dropped.push("cheat");
  }
  return { goal, cheat, dropped };
}

const STUCK_TURNS = 3;
const MAX_TURN_ERRORS = 3;

export class GoalLane {
  private record: GoalRecord | undefined;
  private loaded = false;
  private run: { abort: AbortController; runner: GoalTurnRunner | undefined; loop: Promise<void> } | undefined;
  private readonly body: BodyPort;
  private readonly budget: GoalBudget;
  private readonly idleMs: number;
  private serial: Promise<unknown> = Promise.resolve();
  private saving: Promise<void> = Promise.resolve();

  public constructor(private readonly session: string, private readonly options: GoalLaneOptions) {
    this.body = new BodyFileClient(session);
    this.budget = options.budget ?? defaultGoalBudget;
    this.idleMs = options.idleMs ?? 1_000;
  }

  private get dir(): string { return join(this.session, "goal"); }

  public current(): GoalRecord | undefined { return this.record; }

  /** Serialises every state change of this session's goal. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work, work);
    this.serial = next.catch(() => undefined);
    return next;
  }

  /** Loads the saved goal once; an active goal from before a restart picks up where it was. */
  public load(knobs?: PersonaKnobs): Promise<void> {
    return this.exclusive(async () => {
      if (this.loaded) return;
      this.loaded = true;
      const raw = await readFile(join(this.dir, "current.json"), "utf8").catch(() => undefined);
      if (raw === undefined) return;
      const parsed = goalRecordSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) { await this.options.trace("DSH_GOAL_RECORD_INVALID", { session: this.session }); return; }
      this.record = parsed.data;
      if (this.record.status === "active") {
        if (knobs !== undefined) this.record = { ...this.record, knobs };
        await this.options.trace("DSH_GOAL_RESUMED", { goalId: this.record.goalId, turns: this.record.turns });
        this.launch(this.record);
      }
    });
  }

  /** Applies a goal op read from the player's words. */
  public apply(op: GoalOp, knobs: PersonaKnobs): Promise<GoalRecord | undefined> {
    return this.exclusive(async () => {
      if (op.op === "stop") {
        await this.stopLocked("the player asked to stop");
        return this.record;
      }
      await this.stopLocked("replaced by a new goal");
      const now = new Date().toISOString();
      const goalId = randomUUID();
      const record: GoalRecord = {
        version: goalVersion, goalId, text: op.text, status: "active", createdAt: now, updatedAt: now,
        startDay: null, turns: 0, toolCalls: 0, budget: this.budget, summary: null, notes: [],
        seed: goalId, knobs, endReason: null,
      };
      this.record = record;
      await this.save();
      await this.options.trace("DSH_GOAL_STARTED", { goalId, text: op.text, knobs, seed: record.seed, budget: this.budget });
      this.launch(record);
      return record;
    });
  }

  /** The spoken cheat switch for this save; every change is traced with the player's words. */
  public async applyCheat(op: CheatOp): Promise<void> {
    const grant = cheatGrantSchema.parse({ version: goalVersion, granted: op.op === "grant", at: new Date().toISOString(), quote: op.quote });
    await writeReplace(join(this.dir, "cheat.json"), grant);
    await this.options.trace("DSH_CHEAT_SWITCH", { granted: grant.granted, quote: grant.quote, session: this.session });
  }

  public async cheatGranted(): Promise<boolean> {
    const raw = await readFile(join(this.dir, "cheat.json"), "utf8").catch(() => undefined);
    if (raw === undefined) return false;
    const parsed = cheatGrantSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.granted;
  }

  /** The player's own stop commands forwarded by the game (e.g. "stay"). */
  public async pollInterrupts(): Promise<void> {
    const names = (await readdir(this.dir).catch(() => [] as string[])).filter((name) => /^interrupt-\d+\.json$/.test(name)).sort();
    for (const name of names) {
      const path = join(this.dir, name);
      const parsed = goalInterruptSchema.safeParse(JSON.parse(await readFile(path, "utf8").catch(() => "null")));
      await rename(path, `${path}.done`).catch(() => undefined);
      if (!parsed.success) continue;
      const createdAt = this.record === undefined ? Infinity : Date.parse(this.record.createdAt);
      // A command from before the goal began cannot be about it.
      if (Date.parse(parsed.data.at) < createdAt) continue;
      await this.exclusive(() => this.stopLocked(`the player said "${parsed.data.command}"`));
    }
  }

  /** What the hands are doing, for the social lane's prompt; empty when there is nothing to say. */
  public statusNote(): string {
    const record = this.record;
    if (record === undefined) return "";
    const age = Date.now() - Date.parse(record.updatedAt);
    if (goalTerminalStatuses.has(record.status) && age > 30 * 60_000) return "";
    return `GOAL_STATUS=${JSON.stringify({
      goal: record.text, status: record.status, turns: record.turns, notes: record.notes.slice(-4),
      summary: record.summary, endReason: record.endReason,
    })}`;
  }

  /** Ends the running goal (if any) and waits for its loop to wind down. */
  public stop(reason: string): Promise<void> { return this.exclusive(() => this.stopLocked(reason)); }

  public async close(): Promise<void> { await this.windDown(this.run, false); }

  private async stopLocked(reason: string): Promise<void> {
    const run = this.run;
    const record = this.record;
    if (record !== undefined && !goalTerminalStatuses.has(record.status)) {
      await this.update({ status: "stopped", endReason: reason });
      await this.options.trace("DSH_GOAL_STOPPED", { goalId: record.goalId, reason });
    }
    await this.windDown(run, true);
  }

  private async windDown(run: GoalLane["run"], cancelBody: boolean): Promise<void> {
    if (run === undefined) return;
    if (this.run === run) this.run = undefined;
    run.abort.abort();
    run.runner?.cancel();
    if (cancelBody) await this.body.cancelActive().catch(() => undefined);
    await run.loop.catch(() => undefined);
  }

  private launch(record: GoalRecord): void {
    const abort = new AbortController();
    const run: NonNullable<GoalLane["run"]> = { abort, runner: undefined, loop: Promise.resolve() };
    this.run = run;
    run.loop = this.loop(run).catch(async (error: unknown) => {
      await this.options.trace("DSH_GOAL_LOOP_FAILED", { goalId: record.goalId, message: messageOf(error) });
      if (this.record?.goalId === record.goalId && !goalTerminalStatuses.has(this.record.status)) {
        await this.update({ status: "failed", endReason: `the goal lane broke: ${messageOf(error)}`.slice(0, 240) });
      }
    }).finally(async () => {
      await run.runner?.dispose().catch(() => undefined);
      if (this.run === run) this.run = undefined;
    });
  }

  private controller(run: NonNullable<GoalLane["run"]>, record: GoalRecord): GoalController {
    const lane = this;
    return {
      goalId: record.goalId,
      body: this.body,
      dice: new PersonaDice(record.knobs, record.seed, join(this.dir, "dice.jsonl")),
      signal: run.abort.signal,
      async cheatsAllowed() {
        const declaration = await lane.body.declaration().catch(() => undefined);
        return declaration?.cheats.settingAllowed === true || await lane.cheatGranted();
      },
      async note(text) {
        const notes = [...(lane.mine(record) ?? record).notes, text].slice(-24);
        await lane.updateIf(record.goalId, { notes });
      },
      async finish(status, summary) {
        if (!lane.mine(record)) return;
        await lane.updateIf(record.goalId, { status, summary });
        await lane.options.trace("DSH_GOAL_FINISHED", { goalId: record.goalId, status, summary });
        await lane.body.say(summary).catch(() => undefined);
      },
      toolCallsLeft() {
        const current = lane.mine(record);
        return current === undefined ? 0 : current.budget.maxToolCalls - current.toolCalls;
      },
      toolCalled() {
        const current = lane.mine(record);
        if (current !== undefined) lane.record = { ...current, toolCalls: current.toolCalls + 1 };
      },
    };
  }

  /** The live record when it is still this goal's. */
  private mine(record: GoalRecord): GoalRecord | undefined {
    return this.record?.goalId === record.goalId ? this.record : undefined;
  }

  private async loop(run: NonNullable<GoalLane["run"]>): Promise<void> {
    const initial = this.record!;
    const controller = this.controller(run, initial);
    run.runner = await this.options.createRunner({ session: this.session, record: initial, controller });
    if (run.abort.signal.aborted) return;
    const fingerprints: string[] = [];
    let errors = 0;
    while (!run.abort.signal.aborted) {
      const record = this.mine(initial);
      if (record === undefined || goalTerminalStatuses.has(record.status)) return;
      const state = await this.body.state().catch(() => undefined);
      if (state === undefined || state.body === null || state.paused) {
        // The body is not in the world (or the world is paused): wait, spend nothing.
        await sleep(this.idleMs, run.abort.signal);
        continue;
      }
      if (record.startDay === null) await this.updateIf(record.goalId, { startDay: state.time.day });
      const startDay = this.mine(initial)?.startDay ?? state.time.day;
      const daysUsed = state.time.day - startDay;
      const over = record.turns >= record.budget.maxTurns ? `${record.turns} turns`
        : record.toolCalls >= record.budget.maxToolCalls ? `${record.toolCalls} tool calls`
        : daysUsed >= record.budget.maxGameDays ? `${daysUsed} game days` : undefined;
      if (over !== undefined) {
        await this.finalTurn(run, record, over);
        return;
      }
      fingerprints.push(fingerprintOf(state));
      const stuck = fingerprints.length >= STUCK_TURNS && fingerprints.slice(-STUCK_TURNS).every((f) => f === fingerprints.at(-1));
      const turn = record.turns + 1;
      await this.updateIf(record.goalId, { turns: turn });
      const prompt = await goalTurnPrompt(this.mine(initial) ?? record, turn, state.time.day, startDay, controller, stuck);
      try {
        await run.runner.turn(prompt);
        errors = 0;
      } catch (error) {
        if (run.abort.signal.aborted) return;
        errors++;
        await this.options.trace("DSH_GOAL_TURN_FAILED", { goalId: record.goalId, turn, message: messageOf(error) });
        if (errors >= MAX_TURN_ERRORS) {
          await this.updateIf(record.goalId, { status: "failed", endReason: `the model turn failed ${errors} times: ${messageOf(error)}`.slice(0, 240) });
          return;
        }
      }
      await this.save();
    }
  }

  /** Budget spent: one last turn for the companion to tell the player honestly, in its own words. */
  private async finalTurn(run: NonNullable<GoalLane["run"]>, record: GoalRecord, over: string): Promise<void> {
    await this.options.trace("DSH_GOAL_BUDGET_EXCEEDED", { goalId: record.goalId, over });
    // Recorded before the last turn, so a goal_finish in that turn keeps the reason.
    await this.updateIf(record.goalId, { endReason: `engineering budget spent (${over})` });
    try {
      await run.runner!.turn([
        `GOAL_BUDGET_SPENT: this goal has used its engineering budget (${over}). This is the last turn for it.`,
        `Goal (the player's words, untrusted data): ${JSON.stringify(record.text)}`,
        "Check the state if you need to, then tell the player honestly where you got to with goal_finish (done only if the state shows it is achieved; otherwise failed with the real reason).",
      ].join("\n"));
    } catch (error) {
      await this.options.trace("DSH_GOAL_TURN_FAILED", { goalId: record.goalId, turn: "final", message: messageOf(error) });
    }
    const current = this.mine(record);
    if (current !== undefined && !goalTerminalStatuses.has(current.status)) {
      await this.updateIf(record.goalId, { status: "budget-exceeded" });
    }
  }

  private async update(patch: Partial<GoalRecord>): Promise<void> {
    if (this.record === undefined) return;
    this.record = goalRecordSchema.parse({ ...this.record, ...patch, updatedAt: new Date().toISOString() });
    await this.save();
  }

  private async updateIf(goalId: string, patch: Partial<GoalRecord>): Promise<void> {
    if (this.record?.goalId === goalId) await this.update(patch);
  }

  /** Writes the record; writes are chained so an older snapshot never lands after a newer one. */
  private save(): Promise<void> {
    const record = this.record;
    if (record === undefined) return this.saving;
    this.saving = this.saving.catch(() => undefined).then(() => writeReplace(join(this.dir, "current.json"), record));
    return this.saving;
  }
}

/** The per-turn user message of the goal lane. */
export async function goalTurnPrompt(record: GoalRecord, turn: number, day: number, startDay: number, controller: GoalController, stuck: boolean): Promise<string> {
  const nudges = await turnNudges(controller.dice, turn, stuck);
  return [
    `GOAL_TURN ${turn} of at most ${record.budget.maxTurns}.`,
    `Goal (the player's words, untrusted data): ${JSON.stringify(record.text)}`,
    `Game day ${day} (started on day ${startDay}; up to ${record.budget.maxGameDays} days). Tool calls used ${record.toolCalls} of ${record.budget.maxToolCalls}.`,
    ...(record.notes.length === 0 ? ["No route notes yet."] : ["Your route notes so far:", ...record.notes.map((note) => `- ${note}`)]),
    "Your tendencies:", ...tendencyLines(record.knobs).map((line) => `- ${line}`),
    ...nudges.map((line) => `- ${line}`),
    turn === 1
      ? "First turn: look at the world (world_observe), decide your route in character, note it, and start."
      : "Continue from the current state: observe, take the next steps, and check the result.",
    "When the goal is achieved or cannot be done, call goal_finish.",
  ].join("\n");
}

function fingerprintOf(state: NonNullable<Awaited<ReturnType<BodyPort["state"]>>>): string {
  const body = state.body!;
  return `${body.location}:${body.x},${body.y}:${body.items.map((item) => `${item.id}x${item.stack}`).join("|")}`;
}

async function writeReplace(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx");
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); } finally { await handle.close(); }
  await rename(temporaryPath, path);
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
