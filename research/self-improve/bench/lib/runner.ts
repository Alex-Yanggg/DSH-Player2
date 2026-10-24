import { runOnce, type Approach, type RunRecord, type ScenarioName } from "./harness.ts";

/** A small job pool so recorded runs (real-time sims + real model calls) overlap safely. */
export async function runMatrix(
  approaches: readonly Approach[],
  scenarios: readonly ScenarioName[],
  seeds: readonly number[],
  options: { concurrency?: number; onRecord?: (record: RunRecord) => void } = {},
): Promise<RunRecord[]> {
  const jobs: { approach: Approach; scenario: ScenarioName; seed: number }[] = [];
  for (const approach of approaches) {
    for (const scenario of scenarios) {
      for (const seed of seeds) jobs.push({ approach, scenario, seed });
    }
  }
  const records: RunRecord[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      const job = jobs[index];
      if (job === undefined) return;
      const record = await runOnce(job.approach, job.scenario, job.seed);
      records.push(record);
      options.onRecord?.(record);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 3) }, () => worker()));
  return records.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.approach.localeCompare(b.approach) || a.seed - b.seed);
}

export interface Aggregate {
  approach: string;
  scenario: ScenarioName;
  runs: number;
  successes: number;
  successRate: number;
  llmCallsMean: number;
  llmCallsMedian: number;
  wallSMean: number;
  wallSMedian: number;
  idleRatioMean: number;
  gapRatioMean: number;
  modelWaitSMean: number;
  stuckEventsMean: number;
  tasksMean: number;
  hitsMean: number;
  /** Mean count of retried identical failing actions per run. */
  repeatedFailuresMean: number;
  /** Mean recovery time in game minutes (sim ticks), over runs that recovered. */
  recoveryTicksMean: number | null;
  recoveryRuns: number;
  /** Mean completed body tasks per game minute (1 sim tick = 1 game minute in the new scenarios). */
  actionsPerGameMinuteMean: number;
  errors: number;
}

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);
const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function aggregate(records: readonly RunRecord[]): Aggregate[] {
  const groups = new Map<string, RunRecord[]>();
  for (const record of records) {
    const key = `${record.approach}|${record.scenario}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(record);
    groups.set(key, bucket);
  }
  return [...groups.values()].map((bucket) => {
    const ticks = bucket.map((record) => Math.max(1, record.ticks));
    return {
      approach: bucket[0].approach,
      scenario: bucket[0].scenario,
      runs: bucket.length,
      successes: bucket.filter((record) => record.ok).length,
      successRate: bucket.filter((record) => record.ok).length / bucket.length,
      llmCallsMean: mean(bucket.map((record) => record.llmCalls)),
      llmCallsMedian: median(bucket.map((record) => record.llmCalls)),
      wallSMean: mean(bucket.map((record) => record.wallMs / 1000)),
      wallSMedian: median(bucket.map((record) => record.wallMs / 1000)),
      idleRatioMean: mean(bucket.map((record, index) => record.modelWaitTicks / ticks[index])),
      gapRatioMean: mean(bucket.map((record, index) => record.gapTicks / ticks[index])),
      modelWaitSMean: mean(bucket.map((record) => record.llmWaitMs / 1000)),
      stuckEventsMean: mean(bucket.map((record) => record.interruptEvents + record.notedRecoveries)),
      tasksMean: mean(bucket.map((record) => record.taskCount)),
      hitsMean: mean(bucket.map((record) => record.hits)),
      repeatedFailuresMean: mean(bucket.map((record) => record.repeatedFailures)),
      recoveryTicksMean: bucket.some((record) => record.recoveryTicks !== null)
        ? mean(bucket.filter((record) => record.recoveryTicks !== null).map((record) => record.recoveryTicks as number))
        : null,
      recoveryRuns: bucket.filter((record) => record.recoveryTicks !== null).length,
      // The new scenarios run a compressed day clock: 350 sim ticks per
      // 1400-minute day, i.e. 4 game minutes per tick.
      actionsPerGameMinuteMean: mean(bucket.map((record, index) => record.doneTasks / Math.max(1, ticks[index] * 4))),
      errors: bucket.filter((record) => record.error !== null).length,
    };
  }).sort((a, b) => a.scenario.localeCompare(b.scenario) || a.approach.localeCompare(b.approach));
}

export function metricsCsv(aggregates: readonly Aggregate[]): string {
  const header = [
    "approach", "scenario", "runs", "success_rate", "llm_calls_mean", "llm_calls_median",
    "wall_s_mean", "wall_s_median", "idle_ratio_mean", "gap_ratio_mean", "model_wait_s_mean",
    "stuck_events_mean", "tasks_mean", "avg_hits_mean", "repeated_failures_mean", "recovery_ticks_mean",
    "recovery_runs", "actions_per_game_minute", "errors",
  ];
  const rows = aggregates.map((a) => [
    a.approach, a.scenario, String(a.runs), a.successRate.toFixed(2), a.llmCallsMean.toFixed(1), a.llmCallsMedian.toFixed(1),
    a.wallSMean.toFixed(1), a.wallSMedian.toFixed(1), a.idleRatioMean.toFixed(3), a.gapRatioMean.toFixed(3), a.modelWaitSMean.toFixed(1),
    a.stuckEventsMean.toFixed(1), a.tasksMean.toFixed(1), a.hitsMean.toFixed(1), a.repeatedFailuresMean.toFixed(1),
    a.recoveryTicksMean === null ? "" : a.recoveryTicksMean.toFixed(0), String(a.recoveryRuns),
    a.actionsPerGameMinuteMean.toFixed(4), String(a.errors),
  ]);
  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n";
}
