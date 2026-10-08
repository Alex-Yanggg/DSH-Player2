import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Unattended dream cycle (P2-0014, middle two points): one real bridge
// directory drives the four-turn keyless replay —
//   turn 21: a plain granted cycle leaves receipt-21 behind and the decision
//            lane records companion/receipt-observed on the spine;
//   turn 22: the reflect proposal is applied, then the day ends explicitly:
//            the C# host publishes dream-inbox/dream-<seq>.json, the dream
//            lane closes with one grounded growth proposal, and the Player
//            applies it;
//   turn 23: a restarted process shows the watermark projection reading only
//            the suffix past the persisted watermark, and the next envelope
//            carries the same growth the dream produced.
// No game install, no API key, no human steps.

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDirectory = await mkdtemp(join(tmpdir(), "player2-dual-dream-"));

const children = [];

function run(name, command, args, timeoutMs) {
  return new Promise((resolveProcess) => {
    const child = spawn(command, args, { cwd: repositoryRoot, windowsHide: true });
    children.push(child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolveProcess({ code: "timeout", stdout, stderr });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveProcess({ code, stdout, stderr });
    });
  });
}

function killChildren() {
  for (const child of children.splice(0)) {
    child.kill();
  }
}

async function waitFor(path, timeoutMs) {
  const startedAt = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${path}`);
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 25));
  }
}

async function waitForDirectoryMatch(directory, pattern, timeoutMs) {
  const startedAt = Date.now();
  while (true) {
    const names = await readdir(directory).catch(() => []);
    const match = names.map((name) => pattern.exec(name)).find(Boolean);
    if (match !== undefined) return match;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${pattern} in ${directory}`);
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 25));
  }
}

async function runCycle(sequence, { reflect = false, dream = false } = {}) {
  const hostPromise = run("dualhost", "dotnet", [
    "run", "--project", join(repositoryRoot, "player2-dualhost"), "-c", "Release", "--",
    "--bridge", bridgeDirectory,
    "--sequence", String(sequence),
    "--consent", "grant",
    ...(dream ? ["--dream"] : []),
    "--timeout-seconds", "90",
    "--poll-millis", "10",
  ], 300_000);
  await waitFor(join(bridgeDirectory, "inbox", `turn-${sequence}.json`), 300_000);
  const modelPromise = run("dual-end-model", process.execPath, [
    join(repositoryRoot, "scripts", "dual-end-model.mjs"),
    "--bridge", bridgeDirectory,
    "--sequence", String(sequence),
    ...(reflect ? ["--reflect"] : []),
  ], 60_000);

  let dreamPromise;
  if (dream) {
    // The day ends after settlement: the host publishes one dream request and
    // the dream stand-in closes it from the projected timeline.
    const dreamMatch = await waitForDirectoryMatch(
      join(bridgeDirectory, "dream-inbox"), /^dream-(\d+)\.json$/, 300_000);
    dreamPromise = run("dual-end-model", process.execPath, [
      join(repositoryRoot, "scripts", "dual-end-model.mjs"),
      "--bridge", bridgeDirectory,
      "--dream",
    ], 60_000);
    assert.ok(Number.parseInt(dreamMatch[1], 10) > sequence, "the dream sequence must continue the turn space");
  }

  const host = await hostPromise;
  if (host.code !== 0) {
    console.error(host.stdout);
    console.error(host.stderr);
    throw new Error(`dualhost exited with ${host.code} (sequence ${sequence})`);
  }
  const model = await modelPromise;
  if (model.code !== 0) {
    console.error(model.stdout);
    console.error(model.stderr);
    throw new Error(`dual-end-model exited with ${model.code} (sequence ${sequence})`);
  }
  if (dreamPromise !== undefined) {
    const dreamModel = await dreamPromise;
    if (dreamModel.code !== 0) {
      console.error(dreamModel.stdout);
      console.error(dreamModel.stderr);
      throw new Error(`dream model exited with ${dreamModel.code}`);
    }
    console.log(dreamModel.stdout.trim());
  }
  const outcomeLine = host.stdout.split(/\r?\n/).find((line) => line.includes('"dualhost-ok"'));
  assert.ok(outcomeLine, `dualhost must print one outcome JSON line (sequence ${sequence})`);
  return JSON.parse(outcomeLine);
}

try {
  const first = await runCycle(21);
  assert.equal(first.status, "completed");
  assert.equal(first.envelopeGrowthRevision, null, "no growth asset exists before the first reflect turn");
  assert.equal(first.appliedGrowthRevision, null, "a plain turn writes no growth proposal");

  const dreamTurn = await runCycle(22, { reflect: true, dream: true });
  assert.equal(dreamTurn.status, "completed");
  assert.equal(dreamTurn.appliedGrowthRevision, 22, "the C# host must apply the grounded reflect proposal");
  assert.equal(dreamTurn.dreamOutcome, "growth", "the dream closes with one grounded growth proposal");
  assert.ok(dreamTurn.appliedDreamRevision !== null && dreamTurn.appliedDreamRevision > 22,
    "the dream growth proposal continues the same monotonic revision space");

  const watermark = JSON.parse(await readFile(join(bridgeDirectory, "spine", "state.json"), "utf8"));
  assert.ok(watermark.watermark > 1, "the spine watermark persisted across the dream processes");

  const growthTurn = await runCycle(23);
  assert.equal(growthTurn.status, "completed");
  assert.equal(growthTurn.envelopeGrowthRevision, dreamTurn.appliedDreamRevision,
    "the next published turn must carry the growth the dream produced");
  assert.equal(growthTurn.appliedGrowthRevision, null, "a turn without a reflect call consumes nothing");

  console.log("PASS dual-end dream: receipt -> reflect growth -> day-end dream -> watermark increment carries the same growth");
} finally {
  killChildren();
  await rm(bridgeDirectory, { recursive: true, force: true });
}
