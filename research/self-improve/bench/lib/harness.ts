import { buildFarm, FARM_GOAL_TEXT, type FarmWorld } from "./farm.ts";
import { buildMine, MINE_GOAL_TEXT, type MineWorld } from "./mine.ts";
import { buildLocked, LOCKED_GOAL_TEXT, type LockedWorld } from "./locked.ts";
import { buildWall, WALL_GOAL_TEXT, type WallWorld } from "./wall.ts";
import { InstrumentedPort, type BenchPort, type BenchState, type TaskOutcome } from "./port.ts";
import { ModelClient } from "./model.ts";
import { Toy2Adapter, TOY2_GOAL_TEXT, toy2Success } from "../toy2/game.ts";
import { buildToy2Locked, buildToy2Wall, TOY2_VARIANT_GOAL_TEXT, type VariantWorld } from "../toy2/variants.ts";

/**
 * The run harness: builds a scenario world, wraps the (unmodified) SimAdapter
 * in an instrumented port, starts the sim at real-time pace, runs one approach
 * under a wall-clock budget, and samples idle/busy/model-wait ticks while it
 * works. Approaches only ever see the BenchPort, the ModelClient and the task.
 *
 * Metric definitions (also documented in bench/README.md):
 * - wallMs: wall-clock of the whole run, from sim start to approach resolve.
 * - busyTicks / idleTicks: game ticks with / without an active body task
 *   (sampled every 10 ms; the sim's 3-tick input poll adds small error).
 * - modelWaitTicks: idle ticks during which a model call was in flight —
 *   "body idle while waiting on the model".
 * - gapTicks: idle ticks with no model call (local compute or approach gaps).
 * - stuck/recovery events: task outcomes that ended interrupted/failed plus
 *   recoveries the approach self-reported (replans, re-authors, watchdogs).
 */

export type ScenarioName = "farm" | "mine" | "toy2" | "locked" | "wall" | "toy2-locked" | "toy2-wall";

export interface TaskSpec {
  scenario: ScenarioName;
  goalText: string;
  budgetMs: number;
  maxModelCalls: number;
}

export interface RunContext {
  port: BenchPort;
  model: ModelClient;
  task: TaskSpec;
  seed: number;
  /**
   * The game's own save identity when the scenario declares one (the real mod
   * reads it from the game); null for scenarios that have none. The library
   * option keys its cross-session store on this.
   */
  saveId: string | null;
  signal: AbortSignal;
  noteRecovery(reason: string): void;
  log(line: string): void;
  /**
   * A DSH goal round in miniature: the harness re-offers the delegated goal's
   * own completion check (the same ground truth the scenario grades on) so an
   * approach that claims DONE prematurely gets re-prompted instead of ending
   * the turn — the way DSH keeps an unmet goal active across turns.
   */
  goalCheck(): Promise<boolean>;
}

export interface Approach {
  id: string;
  label: string;
  blurb: string;
  run(ctx: RunContext): Promise<boolean>;
}

export interface RunRecord {
  approach: string;
  scenario: ScenarioName;
  seed: number;
  ok: boolean;
  claimed: boolean;
  wallMs: number;
  ticks: number;
  busyTicks: number;
  idleTicks: number;
  modelWaitTicks: number;
  gapTicks: number;
  llmCalls: number;
  llmCacheHits: number;
  llmWaitMs: number;
  taskCount: number;
  interruptEvents: number;
  notedRecoveries: number;
  /** Body tasks that finished "done". */
  doneTasks: number;
  /**
   * Same failing action retried: failing tasks whose first-step signature
   * repeats, counted beyond the first attempt of each signature.
   */
  repeatedFailures: number;
  /**
   * When the run succeeded after repeated failures: sim ticks (game minutes)
   * from the first failure of the dominant failing signature to the first
   * successful task after the last failure of that signature. Null when no
   * repeated failure or no recovery.
   */
  recoveryTicks: number | null;
  healthEnd: number | null;
  hits: number;
  error: string | null;
  log: string[];
}

export interface Toy2World {
  readonly adapter: Toy2Adapter;
  readonly goalText: string;
  isSuccess(state: BenchState): boolean;
}

export type World = FarmWorld | MineWorld | Toy2World | LockedWorld | WallWorld | VariantWorld;

export function buildWorld(scenario: ScenarioName, seed: number): World {
  if (scenario === "farm") return buildFarm(seed);
  if (scenario === "mine") return buildMine(seed);
  if (scenario === "locked") return buildLocked(seed);
  if (scenario === "wall") return buildWall(seed);
  if (scenario === "toy2-locked") return buildToy2Locked(seed);
  if (scenario === "toy2-wall") return buildToy2Wall(seed);
  const adapter = new Toy2Adapter();
  return { adapter, goalText: TOY2_GOAL_TEXT, isSuccess: (state: BenchState) => toy2Success(state) };
}

export function taskOf(scenario: ScenarioName): TaskSpec {
  if (scenario === "farm") return { scenario, goalText: FARM_GOAL_TEXT, budgetMs: 210_000, maxModelCalls: 45 };
  if (scenario === "mine") return { scenario, goalText: MINE_GOAL_TEXT, budgetMs: 150_000, maxModelCalls: 35 };
  if (scenario === "locked") return { scenario, goalText: LOCKED_GOAL_TEXT, budgetMs: 240_000, maxModelCalls: 45 };
  if (scenario === "wall") return { scenario, goalText: WALL_GOAL_TEXT, budgetMs: 180_000, maxModelCalls: 40 };
  if (scenario === "toy2-locked" || scenario === "toy2-wall") return { scenario, goalText: TOY2_VARIANT_GOAL_TEXT, budgetMs: 240_000, maxModelCalls: 45 };
  return { scenario, goalText: TOY2_GOAL_TEXT, budgetMs: 210_000, maxModelCalls: 45 };
}

export interface RunOnceOptions {
  /** Debug mode: sim ticks run ~17x faster than game time; NOT for recorded runs. */
  fast?: boolean;
  /** Real-time ms per sim tick. Default 17 (~1.0x game speed). */
  tickMs?: number;
}

const SAMPLE_MS = 10;

/** What the real Stardew mod would declare for the same buttons; the keyless sim ships bare ids. */
const SIM_INPUT_DESCRIPTIONS: Record<string, string> = {
  DPadUp: "hold to walk up", DPadRight: "hold to walk right", DPadDown: "hold to walk down", DPadLeft: "hold to walk left",
  ControllerA: "action button: interact with the faced tile (plant seeds on tilled soil, harvest a ready crop, pick up forage, open a counter)",
  ControllerX: "use the selected tool on the faced tile (hoe tills open ground, watering can waters tilled soil, weapon swings)",
  ControllerB: "cancel / close the open menu",
  NoClip: "cheat: walk through walls (only while a cheat switch is on)",
};

export async function runOnce(approach: Approach, scenario: ScenarioName, seed: number, options: RunOnceOptions = {}): Promise<RunRecord> {
  const world = buildWorld(scenario, seed);
  const adapter = world.adapter;
  const engine = "engine" in world ? (world as MineWorld).engine : undefined;
  const model = new ModelClient();
  const port = new InstrumentedPort(adapter, {
    scenario,
    health: () => (engine === undefined ? 100 : Math.max(0, engine.health)),
    ...(scenario === "toy2" ? {} : { inputDescriptions: SIM_INPUT_DESCRIPTIONS }),
  });
  const task = taskOf(scenario);
  const controller = new AbortController();
  const log: string[] = [];
  const debug = process.env.BENCH_DEBUG === "1";
  const harnessStart = Date.now();
  const logs = (line: string) => { if (log.length < 400) log.push(line); if (debug) console.error(`[t+${Math.round((Date.now() - harnessStart) / 100) / 10}s] ${line}`); };

  let claimed = false;
  let error: string | null = null;
  let startTick = 0;
  let busyTicks = 0;
  let idleTicks = 0;
  let modelWaitTicks = 0;
  let gapTicks = 0;
  let lastSampleTick = 0;
  let sampleTimer: NodeJS.Timeout | undefined;
  let latched = false;

  const sample = () => {
    const state = adapter.snapshot();
    if (startTick === 0) { startTick = state.tick; lastSampleTick = state.tick; return; }
    const delta = Math.max(0, state.tick - lastSampleTick);
    lastSampleTick = state.tick;
    const hasTask = state.body?.activeTask !== null && state.body?.activeTask !== undefined;
    if (hasTask) busyTicks += delta;
    else {
      idleTicks += delta;
      if (model.busy) modelWaitTicks += delta;
      else gapTicks += delta;
    }
    // Success latches the moment it first holds: reaching the goal while alive
    // counts even if the body collapses while lingering afterwards.
    if (!latched && state.body !== null) {
      const health = engine === undefined ? 100 : Math.max(0, engine.health);
      if (world.isSuccess({ ...state, body: { ...state.body, health } })) latched = true;
    }
    if (engine !== undefined && engine.health <= 0 && !controller.signal.aborted) {
      logs(`[harness] the body collapsed (health ${engine.health}); aborting`);
      controller.abort();
      void port.cancelActive().catch(() => undefined);
    }
  };

  const started = Date.now();
  await adapter.start(options.tickMs ?? (options.fast === true ? 1 : 17));
  engine?.start();
  sampleTimer = setInterval(sample, SAMPLE_MS);
  const budgetTimer = setTimeout(() => { logs("[harness] wall-clock budget reached; aborting"); controller.abort(); }, task.budgetMs);

  try {
    claimed = await approach.run({
      port,
      model,
      task,
      seed,
      saveId: (world as { saveId?: string }).saveId ?? null,
      signal: controller.signal,
      noteRecovery: (reason) => { port.noteRecovery(reason); logs(`[recovery] ${reason}`); },
      log: logs,
      goalCheck: async () => world.isSuccess(await port.state()),
    });
  } catch (runError) {
    error = runError instanceof Error ? runError.message : String(runError);
  } finally {
    clearTimeout(budgetTimer);
    if (sampleTimer !== undefined) clearInterval(sampleTimer);
  }

  const finalState = await port.state();
  const ok = latched || world.isSuccess(finalState);
  const wallMs = Date.now() - started;
  await port.cancelActive().catch(() => undefined);
  engine?.stop();
  await adapter.stop();

  const interruptEvents = port.taskOutcomes.filter((outcome) => outcome.status === "interrupted" || outcome.status === "failed").length;
  const doneTasks = port.taskOutcomes.filter((outcome) => outcome.status === "done").length;
  const failing = port.taskOutcomes.filter((outcome) => outcome.status === "interrupted" || outcome.status === "failed" || outcome.status === "timeout");
  const failingBySignature = new Map<string, TaskOutcome[]>();
  for (const outcome of failing) {
    const bucket = failingBySignature.get(outcome.signature) ?? [];
    bucket.push(outcome);
    failingBySignature.set(outcome.signature, bucket);
  }
  const repeatedFailures = [...failingBySignature.values()].reduce((sum, bucket) => sum + Math.max(0, bucket.length - 1), 0);
  let recoveryTicks: number | null = null;
  let dominant: TaskOutcome[] | undefined;
  for (const bucket of failingBySignature.values()) if (dominant === undefined || bucket.length > dominant.length) dominant = bucket;
  if (ok && dominant !== undefined && dominant.length >= 2) {
    const firstFailTick = Math.min(...dominant.map((outcome) => outcome.tick));
    const lastFailTick = Math.max(...dominant.map((outcome) => outcome.tick));
    const successTick = port.taskOutcomes.find((outcome) => outcome.status === "done" && outcome.tick > lastFailTick)?.tick;
    if (successTick !== undefined) recoveryTicks = Math.max(0, successTick - firstFailTick);
  }
  return {
    approach: approach.id,
    scenario,
    seed,
    ok,
    claimed,
    wallMs,
    ticks: Math.max(0, lastSampleTick - startTick),
    busyTicks,
    idleTicks,
    modelWaitTicks,
    gapTicks,
    llmCalls: model.counters.calls,
    llmCacheHits: model.counters.cacheHits,
    llmWaitMs: model.counters.waitMs,
    taskCount: port.taskOutcomes.length,
    interruptEvents,
    notedRecoveries: port.recoveries.length,
    doneTasks,
    repeatedFailures,
    recoveryTicks,
    healthEnd: finalState.body?.health ?? null,
    hits: engine?.events.filter((event) => event.kind === "hit").length ?? 0,
    error,
    log,
  };
}
