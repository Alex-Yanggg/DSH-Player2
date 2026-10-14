// P2-0015 T0.1 latency baseline report.
//
// Joins the Mod trace (development-logs/latency-mod.jsonl) and the DSH host
// trace (development-logs/latency-host.jsonl) on lane + key — both sides stamp
// the same machine's UTC wall clock — and prints per-segment n / P50 / P95 plus
// failures and turns that never reached their last stage.
//
// Usage: node scripts/latency-report.mjs <bridge-dir> [--since <ISO>] [--json]
//   <bridge-dir>  the bridge root that contains development-logs/
//   --since       ignore lines stamped before this instant (one session's run)
//   --json        print the report as JSON instead of Markdown
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Ordered stages per lane; each adjacent pair is one reported segment. */
const LANES = {
  // "follow" and "stay" never arrive anywhere, so a command is finished once it moves.
  command: { stages: ["key-enter", "motion-started", "arrived"], end: "motion-started", totals: [["key-enter", "motion-started", "A1 submit → motion"]], minimum: 20 },
  social: {
    stages: ["key-enter", "published", "host-picked", "mind-ready", "agent-ready", "first-token", "model-done", "written", "mod-picked", "rendered"],
    totals: [["key-enter", "rendered", "F2 total"], ["key-enter", "first-token", "F2 → first token"]],
    minimum: 30,
  },
  "day-start": {
    stages: ["day-started", "published", "host-picked", "mind-ready", "agent-ready", "first-token", "model-done", "written", "mod-picked", "rendered"],
    totals: [["day-started", "rendered", "day start → first line"]],
    minimum: 10,
  },
  decision: {
    stages: ["published", "host-picked", "mind-ready", "agent-ready", "first-token", "model-done", "written", "mod-picked", "rendered"],
    totals: [["published", "rendered", "decision total"]],
    minimum: 0,
  },
  readiness: {
    // Two chains on separate keys ("bundle" per game start, "<companion>/<save>" per load); either end finishes one.
    stages: ["mod-entry", "bundle-ready", "mouth-requested", "mouth-ready", "mouth-ready-seen"],
    ends: ["bundle-ready", "mouth-ready-seen"],
    totals: [["mod-entry", "bundle-ready", "A2 bundle ready"], ["mouth-requested", "mouth-ready-seen", "A2 mouth ready"]],
    minimum: 0,
  },
  dream: { stages: ["host-picked", "written"], totals: [], minimum: 0 },
};
const FAILURE_STAGES = new Set(["failed", "motion-failed"]);

const args = process.argv.slice(2);
const bridge = args.find((value, index) => !value.startsWith("--") && args[index - 1] !== "--since");
if (bridge === undefined) {
  console.error("usage: node scripts/latency-report.mjs <bridge-dir> [--since <ISO>] [--json]");
  process.exit(2);
}
const sinceIndex = args.indexOf("--since");
const since = sinceIndex >= 0 ? Date.parse(args[sinceIndex + 1] ?? "") : Number.NEGATIVE_INFINITY;
if (Number.isNaN(since)) {
  console.error("--since requires an ISO timestamp");
  process.exit(2);
}

const logs = join(resolve(bridge), "development-logs");
const lines = [...await readLines(join(logs, "latency-mod.jsonl")), ...await readLines(join(logs, "latency-host.jsonl"))];
let malformed = 0;
const entries = [];
for (const line of lines) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    malformed++;
    continue;
  }
  const at = Date.parse(entry?.at);
  if (typeof entry?.lane !== "string" || typeof entry?.key !== "string" || typeof entry?.stage !== "string" || Number.isNaN(at)) {
    malformed++;
    continue;
  }
  if (at >= since) entries.push({ ...entry, at });
}
// One clock, one order: the two files interleave in time.
entries.sort((a, b) => a.at - b.at);

/** lane → key → stage → first timestamp (ms) */
const turns = new Map();
const failures = new Map();
/** Readiness keys ("bundle", "<companion>/<save>") repeat on every game start or save load: when the stage
 * that opened a key's current occurrence arrives again, it opens a new occurrence instead of pairing across runs. */
const occurrence = new Map();
for (const raw of entries) {
  const at = raw.at;
  const laneKey = `${raw.lane}\u0000${raw.key}`;
  const current = turns.get(raw.lane)?.get(occurrence.get(laneKey) ?? raw.key);
  if (current?.keys().next().value === raw.stage) {
    occurrence.set(laneKey, `${raw.key}@${new Date(at).toISOString()}`);
  }
  const entry = { ...raw, key: occurrence.get(laneKey) ?? raw.key };
  if (FAILURE_STAGES.has(entry.stage)) {
    const list = failures.get(entry.lane) ?? [];
    list.push({ key: entry.key, source: entry.source, detail: entry.detail ?? null });
    failures.set(entry.lane, list);
  }
  const byKey = turns.get(entry.lane) ?? new Map();
  const stages = byKey.get(entry.key) ?? new Map();
  if (!stages.has(entry.stage)) stages.set(entry.stage, at);
  byKey.set(entry.key, stages);
  turns.set(entry.lane, byKey);
}

const report = { bridge: resolve(bridge), since: Number.isFinite(since) ? new Date(since).toISOString() : null, malformed, lanes: {} };
for (const [lane, spec] of Object.entries(LANES)) {
  const byKey = turns.get(lane);
  if (byKey === undefined) continue;
  const segments = [];
  for (let index = 0; index + 1 < spec.stages.length; index++) {
    segments.push(segment(byKey, spec.stages[index], spec.stages[index + 1]));
  }
  const totals = spec.totals.map(([from, to, label]) => ({ ...segment(byKey, from, to), label }));
  const ends = spec.ends ?? [spec.end ?? spec.stages[spec.stages.length - 1]];
  const failedKeys = new Set((failures.get(lane) ?? []).map((item) => item.key));
  const unfinished = [...byKey.entries()]
    .filter(([key, stages]) => !ends.some((end) => stages.has(end)) && !failedKeys.has(key))
    .map(([key, stages]) => ({ key, lastStage: [...stages.entries()].sort((a, b) => a[1] - b[1]).at(-1)?.[0] ?? null }));
  report.lanes[lane] = {
    turns: byKey.size,
    minimumSamples: spec.minimum,
    enoughSamples: totals.length === 0 ? null : totals[0].n >= spec.minimum,
    totals,
    segments,
    failures: failures.get(lane) ?? [],
    unfinished,
  };
}

if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(markdown(report));
}

function segment(byKey, from, to) {
  const values = [];
  for (const stages of byKey.values()) {
    const start = stages.get(from);
    const end = stages.get(to);
    if (start !== undefined && end !== undefined && end >= start) values.push(end - start);
  }
  values.sort((a, b) => a - b);
  return { from, to, n: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.at(-1) ?? null };
}

/** Nearest-rank percentile; null when there are no samples. */
function percentile(sorted, q) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

async function readLines(path) {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter((line) => line.trim() !== "");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function ms(value) {
  return value === null ? "–" : `${Math.round(value)}`;
}

function markdown(value) {
  const out = [`# Player2 latency baseline`, "", `bridge: \`${value.bridge}\``];
  if (value.since !== null) out.push(`since: ${value.since}`);
  if (value.malformed > 0) out.push(`malformed lines skipped: ${value.malformed}`);
  if (Object.keys(value.lanes).length === 0) out.push("", "No latency lines found.");
  for (const [lane, data] of Object.entries(value.lanes)) {
    out.push("", `## ${lane} (${data.turns} turns${data.minimumSamples > 0 ? `, contract minimum ${data.minimumSamples}` : ""})`, "");
    out.push("| segment | n | P50 ms | P95 ms | max ms |", "| --- | ---: | ---: | ---: | ---: |");
    for (const total of data.totals) out.push(`| **${total.label}** (${total.from} → ${total.to}) | ${total.n} | ${ms(total.p50)} | ${ms(total.p95)} | ${ms(total.max)} |`);
    for (const item of data.segments) out.push(`| ${item.from} → ${item.to} | ${item.n} | ${ms(item.p50)} | ${ms(item.p95)} | ${ms(item.max)} |`);
    if (data.enoughSamples === false) out.push("", `Not enough samples yet for the baseline (${data.totals[0].n}/${data.minimumSamples}).`);
    if (data.failures.length > 0) {
      out.push("", `Failures: ${data.failures.length}`);
      for (const failure of data.failures) out.push(`- ${failure.key} (${failure.source ?? "?"})${failure.detail ? `: ${failure.detail}` : ""}`);
    }
    if (data.unfinished.length > 0) {
      out.push("", `Never finished (timeout or still running): ${data.unfinished.length}`);
      for (const item of data.unfinished) out.push(`- ${item.key}, last stage ${item.lastStage}`);
    }
  }
  return out.join("\n");
}
