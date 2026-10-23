import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOnce, type Approach, type ScenarioName } from "./lib/harness.ts";
import { aggregate, metricsCsv, runMatrix } from "./lib/runner.ts";
import { runHandCoded } from "./lib/approach-handcoded.ts";
import { runLlmBaseline } from "./lib/approach-llm.ts";
import { runSkills } from "./lib/approach-skills.ts";
import { runLlmBt } from "./lib/approach-llm-bt.ts";
import { runModes } from "./lib/approach-modes.ts";
import { runGoap } from "./lib/approach-goap.ts";
import { runHybrid } from "./lib/approach-hybrid.ts";
import { toy2Approaches } from "./toy2/ports.ts";

/**
 * The bench runner. One command reruns everything:
 *   npx -y tsx bench/run.ts all
 * Options:
 *   --seeds N          runs per approach x scenario (default 10)
 *   --concurrency N    parallel runs (default 3)
 *   --approaches a,b   subset (default: the finalist set)
 *   --scenarios a,b    farm,mine (default both)
 *   --skip-prime       do not re-author the on-disk skill libraries first
 *   --toy2-only        only run the toy2 porting verification
 * Raw records land in ../results/runs.json (+ runs-toy2.json), aggregates in
 * ../results/summary.json, and the metric table in ../results/metrics.csv.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "results");

export const APPROACHES: Record<string, Approach> = {
  llm: { id: "llm", label: "Pure LLM tool calling (baseline)", blurb: "model owns the loop through the product's tools", run: runLlmBaseline },
  "llm-bt": { id: "llm-bt", label: "LLM-authored behavior trees", blurb: "BT as JSON data + fixed interpreter", run: runLlmBt },
  modes: { id: "modes", label: "Reflex/modes layer under the LLM", blurb: "LLM authors a mode table; fixed selector executes", run: runModes },
  skills: { id: "skills", label: "LLM-written code skills + library", blurb: "model authors a skill once; library retrieves", run: runSkills },
  goap: { id: "goap", label: "GOAP planner + LLM goal translation", blurb: "fixed planner over a per-game domain; LLM translates goals", run: runGoap },
  hybrid: { id: "hybrid", label: "Hybrid: LLM directive + reflex executor + skills", blurb: "one authoring call: mode table + skills; executor owns control", run: runHybrid },
  handcoded: { id: "handcoded", label: "Hand-written state machines", blurb: "fixed per-scenario controllers, no model", run: runHandCoded },
};

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const seeds = Number(arg("seeds", "10"));
const concurrency = Number(arg("concurrency", "3"));
const approachIds = arg("approaches", "llm,llm-bt,modes,skills,goap,hybrid,handcoded").split(",");
const scenarioNames = arg("scenarios", "farm,mine").split(",") as ScenarioName[];
const skipPrime = process.argv.includes("--skip-prime");
const toy2Only = process.argv.includes("--toy2-only");

async function main(): Promise<void> {
  const started = Date.now();
  await mkdir(RESULTS, { recursive: true });

  if (!toy2Only) {
    // Prime the on-disk libraries (skills, hybrid directives) so run 1 of the
    // matrix is an authoring run and runs 2..N measure retrieval — unless told
    // not to, in which case whatever is on disk is reused.
    if (!skipPrime) {
      await rm(path.join(RESULTS, "skills"), { recursive: true, force: true }).catch(() => undefined);
      for (const id of ["skills", "hybrid"]) {
        if (!approachIds.includes(id)) continue;
        console.log(`[prime] ${id} farm seed 1 (authors the on-disk library)`);
        const record = await runOnce(APPROACHES[id], "farm", 1);
        console.log(`[prime] ${id}: ok=${record.ok} llmCalls=${record.llmCalls}`);
      }
    }

    const approaches = approachIds.map((id) => APPROACHES[id]).filter((approach): approach is Approach => approach !== undefined);
    if (approaches.length === 0) throw new Error(`no known approaches in: ${approachIds.join(", ")}`);
    console.log(`[matrix] ${approaches.map((a) => a.id).join(", ")} x ${scenarioNames.join(",")} x seeds 1..${seeds} (concurrency ${concurrency})`);
    const records = await runMatrix(approaches, scenarioNames, Array.from({ length: seeds }, (_, index) => index + 1), {
      concurrency,
      onRecord: (record) => console.log(`[run] ${record.approach}/${record.scenario}#${record.seed}: ok=${record.ok} llm=${record.llmCalls} wall=${Math.round(record.wallMs / 100) / 10}s${record.error === null ? "" : ` ERROR ${record.error.slice(0, 60)}`}`),
    });
    await writeFile(path.join(RESULTS, "runs.json"), JSON.stringify(records, null, 1), "utf8");
    const aggregates = aggregate(records);
    await writeFile(path.join(RESULTS, "summary.json"), JSON.stringify({ model: "deepseek-chat (served as deepseek-flash), temperature 0, cached with latency replay", aggregates }, null, 1), "utf8");
    await writeFile(path.join(RESULTS, "metrics.csv"), metricsCsv(aggregates), "utf8");
    console.log(`[done] ${records.length} runs in ${Math.round((Date.now() - started) / 1000)}s -> results/runs.json, summary.json, metrics.csv`);
  }

  // toy2 porting verification: 3 seeds per ported approach.
  const toy2Seeds = [1, 2, 3];
  const toy2Records = [];
  for (const [id, approach] of Object.entries(toy2Approaches(APPROACHES))) {
    for (const seed of toy2Seeds) {
      const record = await runOnce(approach, "toy2", seed);
      toy2Records.push(record);
      console.log(`[toy2] ${id}#${seed}: ok=${record.ok} llm=${record.llmCalls} wall=${Math.round(record.wallMs / 100) / 10}s`);
    }
  }
  await writeFile(path.join(RESULTS, "runs-toy2.json"), JSON.stringify(toy2Records, null, 1), "utf8");
  console.log(`[toy2 done] ${toy2Records.length} runs -> results/runs-toy2.json`);
}

await main();
