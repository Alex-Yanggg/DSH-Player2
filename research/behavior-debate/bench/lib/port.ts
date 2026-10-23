import type { BodyInputStep, BodyState } from "@dsh-player2/contracts";
import type { BodyPort, BodyRun, RunOptions } from "../../../../packages/dsh-companion-plugin/src/body/port.ts";

/**
 * The bench's port: the product's BodyPort plus a `health` field the mine
 * scenario injects (the sim adapter has no body health of its own; the mine
 * wrapper IS the game and owns it). Everything an approach touches goes
 * through this interface — approaches never see the raw SimAdapter.
 */

export type BenchState = BodyState & { body: (NonNullable<BodyState["body"]> & { health: number }) | null };

export interface TaskOutcome {
  seq: number;
  status: BodyRun["status"];
  reason: string | null;
  steps: number;
  ms: number;
}

export interface BenchPort extends Omit<BodyPort, "state"> {
  readonly scenario: string;
  state(): Promise<BenchState>;
  /** Task outcomes of every input sequence this approach submitted, in order. */
  readonly taskOutcomes: TaskOutcome[];
  /** Recoveries the approach self-reported (replans, re-authors, watchdogs...). */
  readonly recoveries: readonly string[];
  noteRecovery(reason: string): void;
}

export interface InstrumentOptions {
  readonly scenario: string;
  /** The game's current body health (the mine wrapper owns this; farm is a constant). */
  readonly health: () => number;
  /** Called after every submitted task settles. */
  readonly onTaskEnd?: (outcome: TaskOutcome) => void;
  /**
   * The adapter's own readable input descriptions, as the real game mod would declare
   * them (the body contract asks for "plain words a model can read"; the keyless sim
   * declares bare ids). Applied for every approach equally.
   */
  readonly inputDescriptions?: Record<string, string>;
}

export class InstrumentedPort implements BenchPort {
  public readonly scenario: string;
  public readonly taskOutcomes: TaskOutcome[] = [];
  private readonly recoveries_: string[] = [];

  public constructor(private readonly inner: BodyPort, private readonly options: InstrumentOptions) {
    this.scenario = options.scenario;
  }

  public get recoveries(): readonly string[] {
    return this.recoveries_;
  }

  public noteRecovery(reason: string): void {
    this.recoveries_.push(reason);
  }

  public async declaration() {
    const declaration = await this.inner.declaration();
    const overrides = this.options.inputDescriptions;
    if (overrides === undefined) return declaration;
    return { ...declaration, inputs: declaration.inputs.map((input) => ({ ...input, ...(overrides[input.id] === undefined ? {} : { description: overrides[input.id] }) })) };
  }

  public async state(): Promise<BenchState> {
    const state = await this.inner.state();
    return state.body === null ? (state as BenchState) : ({ ...state, body: { ...state.body, health: this.options.health() } } as BenchState);
  }

  public async world() {
    return this.inner.world();
  }

  public async run(steps: readonly BodyInputStep[], runOptions: RunOptions = {}): Promise<BodyRun> {
    const started = Date.now();
    const run = await this.inner.run(steps, runOptions);
    const outcome: TaskOutcome = { seq: run.seq, status: run.status, reason: run.reason, steps: steps.length, ms: Date.now() - started };
    this.taskOutcomes.push(outcome);
    this.options.onTaskEnd?.(outcome);
    return run;
  }

  public async cancelActive(): Promise<void> {
    await this.inner.cancelActive();
  }

  public async grantCheats(granted: boolean, quote: string): Promise<string> {
    return this.inner.grantCheats(granted, quote);
  }
}
