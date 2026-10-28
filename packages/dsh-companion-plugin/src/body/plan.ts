import type { BodyInputStep, BodyState, ObstacleRow } from "@dsh-player2/contracts";
import type { BodyPort, BodyRun, RunOptions } from "./port.js";
import { sleep } from "./port.js";
import { controlsOf, type Controls } from "./navigation.js";
import { walkTo } from "./walk.js";
import { stepsDigest } from "./tools.js";
import type { StuckWatch } from "./stuck.js";

/**
 * The small brain (P2-0019c): the mind's only way to work the body is
 * `plan_set` — an ordered list of steps, each with the change it expects.
 * Plain code here keeps executing those steps without a model turn, reports
 * progress as facts, and wakes the mind when the plan finishes or the stuck
 * detector stops it. Reflexes preempt at the port as always.
 */

/** One step the mind hands down, as `plan_set` receives it. */
export interface PlanStepInput {
  /** What this step is for, in the mind's own words (shown in progress facts). */
  label?: string;
  tool: "body_walk_to" | "body_input" | "wait";
  args: Record<string, unknown>;
  /** The change that must show once the step ran, or the step feeds the stuck detector. */
  expect?: { at?: { x: number; y: number; location?: string }; holding?: { name: string; atLeast?: number } };
}

interface PreparedStep extends PlanStepInput {
  label: string;
  signature: string;
}

const MAX_STEPS = 16;
const POLL_MS = 150;
/** One in-game minute in real time: the game clock moves ten minutes every seven seconds. */
export const GAME_MINUTE_MS = 700;

export class PlanBoard {
  private plan: { approach: string; steps: PreparedStep[]; index: number } | null = null;
  private readonly facts: string[] = [];
  private controls: Controls | undefined;
  private stopped = false;
  private working = false;
  private wake = false;
  /** Stops the step in flight when the mind replaces or takes back the plan. */
  private current: AbortController | null = null;

  public constructor(
    private readonly body: BodyPort,
    private readonly watch: StuckWatch,
    private readonly onWake: () => void,
    /** Clear-the-way rows the body's walks use (the game's reflex table). */
    private readonly obstacles: readonly ObstacleRow[] = [],
  ) {}

  public start(): void {
    void this.loop();
  }

  public stop(): void {
    this.stopped = true;
  }

  /** Hands a plan down; an empty list takes the current plan back. Returns the confirmation. */
  public set(approach: string, steps: readonly PlanStepInput[]): string {
    // The mind handing down a plan (or taking one back) is it deciding again:
    // a standing wall hold ends here, and the new approach counts fresh.
    this.watch.release();
    // The step in flight belongs to the old plan: stop it, so the body does not keep working what the mind gave up.
    if (this.current !== null) {
      this.current.abort();
      this.current = null;
      void this.body.cancelActive().catch(() => undefined);
    }
    if (steps.length === 0) {
      if (this.plan !== null) this.facts.push("The plan was taken back; the body waits for your next word or plan.");
      this.plan = null;
      this.wake = true;
      return "Plan cleared; the body is idle.";
    }
    const prepared: PreparedStep[] = [];
    for (const step of steps.slice(0, MAX_STEPS)) {
      const label = (step.label ?? step.tool).replace(/\s+/g, " ").trim().slice(0, 80) || step.tool;
      const signature = stepSignature(step);
      if (signature === null) throw new Error(`refused: step ${prepared.length + 1} (${label}) has args this body cannot act on. A step is {"tool":"body_walk_to"|"body_input"|"wait","args":{...},"expect":{...},"label":"..."} — the tool's own arguments go inside args, never beside it.`);
      prepared.push({ ...step, label, signature });
    }
    if (this.plan !== null) this.facts.push("Your previous plan was replaced before it finished.");
    this.plan = { approach: approach.replace(/\s+/g, " ").trim().slice(0, 160) || "unnamed approach", steps: prepared, index: 0 };
    this.facts.push(`Your plan is in your body's hands: ${this.plan.approach} (${prepared.length} step(s)); the body works it while you rest.`);
    return `Plan handed down: ${prepared.length} step(s). The body works it without you; you are woken when it finishes or hits a wall.`;
  }

  /** Progress facts for the mind's next turn, drained. */
  public drain(): string[] {
    this.wake = false;
    return this.facts.splice(0);
  }

  /** True while an undelivered finish or stop waits — a reason to wake the mind. */
  public wakePending(): boolean {
    return this.wake;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      await sleep(POLL_MS);
      const plan = this.plan;
      if (plan === null || this.working) continue;
      if (this.watch.isHolding()) {
        this.plan = null;
        this.wake = true;
        this.facts.push(`The body stopped working the plan (${plan.approach}) after repeated failure — the same wall kept meeting it. Step back and plan differently.`);
        this.onWake();
        continue;
      }
      if (plan.index >= plan.steps.length) {
        this.plan = null;
        this.wake = true;
        this.facts.push(`Plan finished: ${plan.approach}. Look at the world and decide what comes next.`);
        this.onWake();
        continue;
      }
      const step = plan.steps[plan.index++]!;
      this.working = true;
      void this.runStep(step).finally(() => { this.working = false; });
    }
  }

  private async runStep(step: PreparedStep): Promise<void> {
    const controller = this.current = new AbortController();
    const before = await this.body.state().catch(() => undefined);
    let failure: string | null = null;
    try {
      if (before === undefined) throw new Error("the world could not be read");
      const { outcome, report, broke } = await this.act(step, controller.signal);
      if (controller.signal.aborted) return; // the plan it belonged to is gone
      const after = await this.body.state().catch(() => undefined);
      const unmet = after === undefined ? [] : this.unmet(step, after);
      this.facts.push(`Plan, ${step.label}: ${report}${unmet.length > 0 ? ` — expected change did not show: ${unmet.join("; ")}` : ""}`);
      // Letting time pass is meant to leave the world as it is; only a wait that missed its expected change is a wall.
      if (unmet.length > 0) this.watch.record("plan", step.signature, `unmet: ${unmet.join("; ")}`, before, after);
      else if (step.tool !== "wait") this.watch.record("plan", step.signature, outcome, before, after);
      if (unmet.length > 0) failure = "its expected change did not show";
      else if (broke) failure = outcome;
    } catch (error) {
      if (controller.signal.aborted) return;
      const detail = error instanceof Error ? error.message : String(error);
      this.facts.push(`Plan, ${step.label}: failed (${detail}).`);
      if (before !== undefined) this.watch.record("plan", step.signature, `failed: ${detail}`, before, undefined);
      failure = "it failed";
    } finally {
      if (this.current === controller) this.current = null;
    }
    // The later steps assumed this one worked: stop here and let the mind re-plan from the world as it is.
    const plan = this.plan;
    if (failure === null || plan === null || !plan.steps.includes(step)) return;
    const left = plan.steps.length - plan.index;
    this.plan = null;
    this.wake = true;
    this.facts.push(`The body stopped the plan (${plan.approach}) at "${step.label}" because ${failure}${left > 0 ? `; ${left} later step(s) were not run` : ""}. Look at the world and plan again.`);
    this.onWake();
  }

  /** One step's work through the same body operations the plan owns. */
  /** `broke`: the step did not do its work (a walk that did not arrive, input the game refused or never finished). */
  private async act(step: PreparedStep, signal: AbortSignal): Promise<{ outcome: string; report: string; broke: boolean }> {
    if (step.tool === "wait") {
      const minutes = Math.max(1, Math.min(60, Number(step.args.minutes) || 1));
      this.controls ??= controlsOf(await this.body.declaration());
      const run = await this.body.run(waitSteps(minutes * GAME_MINUTE_MS, this.controls.limits.maxStepMs), { signal });
      return { outcome: run.status === "done" ? "ok" : run.status, report: `let the world run ~${minutes} minute(s) (${run.status})`, broke: false };
    }
    if (step.tool === "body_walk_to") {
      const args = (step.args ?? {}) as { x: number; y: number; location?: string; mode?: "stand" | "adjacent" };
      this.controls ??= controlsOf(await this.body.declaration());
      const result = await walkTo(this.body, this.controls, () => this.body.world(), { x: Number(args.x), y: Number(args.y), mode: args.mode === "adjacent" ? "adjacent" : "stand", ...(typeof args.location === "string" ? { location: args.location } : {}) }, { obstacles: this.obstacles, signal });
      return { outcome: result.ok ? "ok" : `not reached (${result.reason})`, report: `${result.ok ? "OK" : "NOT REACHED"}: ${result.reason}. Now at ${result.location ?? "?"} (${result.x ?? "?"},${result.y ?? "?"}).`, broke: !result.ok };
    }
    const args = step.args as { steps?: BodyInputStep[]; until?: RunOptions["until"] };
    if (!Array.isArray(args.steps) || args.steps.length === 0) throw new Error("no steps to play");
    const run: BodyRun = await this.body.run(args.steps.slice(0, 64), { signal, ...(args.until ? { until: args.until } : {}) });
    const events = run.events.filter((e) => !["done", "running"].includes(e.kind)).slice(-4);
    return { outcome: run.status === "done" ? "ok" : run.status, report: `Input ${run.status}${run.reason ? ` (${run.reason})` : ""}${events.length > 0 ? `. Events: ${events.map((e) => `${e.kind}: ${e.detail}`).join("; ")}.` : ""}`, broke: run.status === "failed" || run.status === "timeout" };
  }

  /** The expected changes that did not show. */
  private unmet(step: PreparedStep, after: BodyState): string[] {
    const unmet: string[] = [];
    const body = after.body;
    if (step.expect?.at !== undefined) {
      const at = step.expect.at;
      if (body === null || body.x !== at.x || body.y !== at.y || (at.location !== undefined && body.location !== at.location)) {
        unmet.push(`standing at ${at.location ?? ""} (${at.x},${at.y})`);
      }
    }
    if (step.expect?.holding !== undefined) {
      const wanted = step.expect.holding;
      const have = body?.items.filter((i) => i.name.toLowerCase().includes(wanted.name.toLowerCase())).reduce((sum, i) => sum + i.stack, 0) ?? 0;
      if (have < (wanted.atLeast ?? 1)) unmet.push(`holding ${wanted.atLeast ?? 1} ${wanted.name} (has ${have})`);
    }
    return unmet;
  }
}

/** Idle steps adding up to `ms`, each within the adapter's step limit. */
export function waitSteps(ms: number, maxStepMs: number): BodyInputStep[] {
  const steps: BodyInputStep[] = [];
  for (let left = ms; left > 0; left -= maxStepMs) steps.push({ ms: Math.min(left, maxStepMs) });
  return steps;
}

/** A stable signature for the stuck detector: the tool plus what it acts on, not the label. */
function stepSignature(step: PlanStepInput): string | null {
  const args = step.args;
  if (args === undefined || args === null || typeof args !== "object" || Array.isArray(args)) return null;
  switch (step.tool) {
    case "wait": return Number.isFinite(Number(step.args.minutes)) ? `wait ${Number(step.args.minutes)}m` : null;
    case "body_walk_to": {
      const { x, y } = step.args as { x?: unknown; y?: unknown };
      return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? `walk ${Number(x)},${Number(y)}@${String(step.args.location ?? "")}` : null;
    }
    case "body_input": {
      const steps = (step.args as { steps?: BodyInputStep[] }).steps;
      return Array.isArray(steps) && steps.length > 0 ? `input ${stepsDigest(steps)}` : null;
    }
  }
}
