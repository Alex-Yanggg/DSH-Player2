import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOnce, type Approach, type ScenarioName } from "./lib/harness.ts";
import { aggregate, metricsCsv, runMatrix } from "./lib/runner.ts";
import { runLlmBaseline } from "./lib/approach-llm.ts";
import { runReflect } from "./lib/approach-reflect.ts";
import { runLibrary } from "./lib/approach-library.ts";
import { runCurriculum } from "./lib/approach-curriculum.ts";
import { runActionRate } from "./lib/approach-actionrate.ts";
import { runCombo } from "./lib/approach-combo.ts";
import { runAsync } from "./lib/approach-async.ts";
import { countLoc } from "./lib/loc.ts";

/**
 * The round-2 bench runner (self-improvement options). One command reruns everything:
 *   npx -y tsx run.ts all
 * Options:
 *   --seeds N          runs per approach x scenario (default 10; for the warm
 *                      library the seeds ARE successive sessions on one save)
 *   --concurrency N    parallel runs (default 3; the warm library always runs
 *                      sequentially because its sessions share one store)
 *   --approaches a,b   subset (default: llm baseline + options a-e)
 *   --scenarios a,b    subset (default: locked,wall,toy2-locked,toy2-wall)
 * Raw records land in ../results/runs.json, aggregates in ../results/summary.json,
 * the metric table in ../results/metrics.csv, and loc accounting in ../results/loc.json.
 *
 * The warm library accumulates across seeds BY DESIGN (seed 1 discovers, seeds
 * 2..N start with what earlier sessions learned); library-cold keys its store
 * per seed as the control. The prior round's farm/mine/toy2 numbers are cited
 * from origin/behavior-research (research/behavior-debate/results) and not rerun.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "results");

export const APPROACHES: Record<string, Approach> = {
  llm: { id: "llm", label: "Pure LLM tool calling (baseline)", blurb: "round-1 baseline, reference rows only", run: runLlmBaseline },
  reflect: { id: "reflect", label: "(a) Stuck detector + reflect-and-search", blurb: "Reflexion/ExpeL-style lessons + simulated wiki search, within one run", run: runReflect },
  library: { id: "library", label: "(b) Three-layer memory (owner-agreed)", blurb: "persona library across saves + save memory keyed by the save id + session distil", run: (ctx) => runLibrary(ctx) },
  "library-cold": { id: "library-cold", label: "(b-control) Same memory, cold per seed", blurb: "isolates what the carried layers buy", run: (ctx) => runLibrary(ctx, { cold: true }) },
  curriculum: { id: "curriculum", label: "(c) Exploration-first curriculum", blurb: "survey the world, then work the goal with the field guide", run: runCurriculum },
  actionrate: { id: "actionrate", label: "(d) Batched plans (PTC-style)", blurb: "one model call plans several body actions", run: runActionRate },
  combo: { id: "combo", label: "(static composition) library + reflect + batching", blurb: "reference row: options b + a + d composed statically", run: runCombo },
  async: { id: "async", label: "(e) Big-brain/small-brain async (code small brain)", blurb: "DSH model plans/reflects/searches while plugin code keeps acting; escalates on 3x repeated failure", run: (ctx) => runAsync(ctx) },
  "async-llm": { id: "async-llm", label: "(e) Big-brain/small-brain async (cheap-model small brain)", blurb: "same split; the small brain is a minimal-prompt model standing in for DSH flash/subagent", run: (ctx) => runAsync(ctx, { llmSmallBrain: true }) },
};

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const seeds = Number(arg("seeds", "10"));
const concurrency = Number(arg("concurrency", "3"));
const approachIds = arg("approaches", "llm,reflect,library,library-cold,curriculum,actionrate,combo,async,async-llm").split(",");
const scenarioNames = arg("scenarios", "locked,wall,toy2-locked,toy2-wall").split(",") as ScenarioName[];
const skipPrime = process.argv.includes("--skip-prime");
// --out <name> writes results/runs-<name>.json etc. instead of the canonical
// files, so a partial rerun (e.g. only the async rows) never clobbers the
// recorded matrix.
const outSuffix = arg("out", "");
const outName = (base: string) => outSuffix === "" ? base : `${base}-${outSuffix}`;

async function main(): Promise<void> {
  const started = Date.now();
  await mkdir(RESULTS, { recursive: true });

  // The warm library's sessions share one store: reset it so seed 1 is always
  // the discovery session, then run it sequentially below.
  const warmSelected = approachIds.includes("library");
  if (warmSelected && !skipPrime) {
    await rm(path.join(RESULTS, "library"), { recursive: true, force: true }).catch(() => undefined);
  }

  const parallelIds = approachIds.filter((id) => id !== "library");
  const parallel = parallelIds.map((id) => APPROACHES[id]).filter((approach): approach is Approach => approach !== undefined);
  if (parallel.length === 0 && !warmSelected) throw new Error(`no known approaches in: ${approachIds.join(", ")}`);
  const seedList = Array.from({ length: seeds }, (_, index) => index + 1);

  const records = [];
  if (parallel.length > 0) {
    console.log(`[matrix] ${parallel.map((a) => a.id).join(", ")} x ${scenarioNames.join(",")} x seeds 1..${seeds} (concurrency ${concurrency})`);
    records.push(...await runMatrix(parallel, scenarioNames, seedList, {
      concurrency,
      onRecord: (record) => console.log(`[run] ${record.approach}/${record.scenario}#${record.seed}: ok=${record.ok} llm=${record.llmCalls} repFail=${record.repeatedFailures} wall=${Math.round(record.wallMs / 100) / 10}s${record.error === null ? "" : ` ERROR ${record.error.slice(0, 60)}`}`),
    }));
  }

  // The warm library runs as successive sessions on one save, in seed order.
  if (warmSelected) {
    for (const scenario of scenarioNames) {
      for (const seed of seedList) {
        const record = await runOnce(APPROACHES.library, scenario, seed);
        records.push(record);
        console.log(`[library] ${scenario}#${record.seed}: ok=${record.ok} llm=${record.llmCalls} repFail=${record.repeatedFailures} wall=${Math.round(record.wallMs / 100) / 10}s`);
      }
    }
  }

  await writeFile(path.join(RESULTS, outName("runs.json")), JSON.stringify(records, null, 1), "utf8");
  const aggregates = aggregate(records);
  await writeFile(path.join(RESULTS, outName("summary.json")), JSON.stringify({ model: "deepseek-chat (served as deepseek-flash), temperature 0, cached with latency replay", aggregates }, null, 1), "utf8");
  await writeFile(path.join(RESULTS, outName("metrics.csv")), metricsCsv(aggregates), "utf8");
  await countLoc();
  console.log(`[done] ${records.length} runs in ${Math.round((Date.now() - started) / 1000)}s -> results/${outName("runs.json")}, ${outName("summary.json")}, ${outName("metrics.csv")}, loc.json`);
}

await main();
