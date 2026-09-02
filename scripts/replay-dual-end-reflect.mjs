import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Unattended dual-end self-evolution cycle (P2-0012): one real bridge
// directory drives three consult turns —
//   turn 21: a plain granted cycle that leaves receipt-21 behind;
//   turn 22: the model reflects on receipt-21, the C# host validates and
//            applies the growth proposal, and the consumed file disappears;
//   turn 23: the host publishes the turn with the growth asset attached, so
//            the next companion sees the growth it wrote.
// No game install, no API key, no human steps.

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDirectory = await mkdtemp(join(tmpdir(), "player2-dual-reflect-"));

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

async function runCycle(sequence, { reflect = false } = {}) {
  // The host window covers a cold `dotnet run` restore/build on a clean
  // machine plus the whole bridge cycle, mirroring replay-dual-end.mjs.
  const hostPromise = run("dualhost", "dotnet", [
    "run", "--project", join(repositoryRoot, "player2-dualhost"), "-c", "Release", "--",
    "--bridge", bridgeDirectory,
    "--sequence", String(sequence),
    "--consent", "grant",
    "--timeout-seconds", "60",
    "--poll-millis", "10",
  ], 240_000);
  await waitFor(join(bridgeDirectory, "inbox", `turn-${sequence}.json`), 240_000);
  const modelArgs = [
    join(repositoryRoot, "scripts", "dual-end-model.mjs"),
    "--bridge", bridgeDirectory,
    "--sequence", String(sequence),
  ];
  if (reflect) {
    modelArgs.push("--reflect");
  }
  const modelPromise = run("dual-end-model", process.execPath, modelArgs, 60_000);

  const host = await hostPromise;
  if (host.code !== 0) {
    console.error(host.stdout);
    console.error(host.stderr);
    await modelPromise;
    throw new Error(`dualhost exited with ${host.code} (sequence ${sequence})`);
  }
  const model = await modelPromise;
  if (model.code !== 0) {
    console.error(model.stdout);
    console.error(model.stderr);
    throw new Error(`dual-end-model exited with ${model.code} (sequence ${sequence})`);
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

  const reflectTurn = await runCycle(22, { reflect: true });
  assert.equal(reflectTurn.status, "completed");
  assert.equal(reflectTurn.appliedGrowthRevision, 22, "the C# host must apply the grounded growth proposal");

  const growthTurn = await runCycle(23);
  assert.equal(growthTurn.status, "completed");
  assert.equal(growthTurn.envelopeGrowthRevision, 22, "the next published turn must carry the applied growth asset");
  assert.equal(growthTurn.appliedGrowthRevision, null, "a turn without a reflect call consumes nothing");

  console.log("PASS dual-end reflect: receipt -> grounded reflection -> applied growth asset -> next envelope carries growth");
} finally {
  killChildren();
  await rm(bridgeDirectory, { recursive: true, force: true });
}
