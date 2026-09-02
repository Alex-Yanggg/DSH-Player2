import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DecisionFileBridge } from "../packages/dsh-companion-plugin/dist/index.js";

// Unattended dual-end acceptance: the C# pure host and the TypeScript DSH
// composition drive one real bridge directory through a full consent cycle.
// No game install, no API key, no human steps. This is the harness meant to
// migrate into the lab tooling later; the lab itself is not touched here.

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sequence = 12;
// `--autonomy full` runs the unattended full-autonomy cycle: the C# host
// executes the grounded order without scripted consent and the receipt must
// carry the autonomous marker. Default is the consult consent cycle.
const autonomy = process.argv.includes("--autonomy") &&
  process.argv[process.argv.indexOf("--autonomy") + 1] === "full"
  ? "full"
  : "consult";
const bridgeDirectory = await mkdtemp(join(tmpdir(), "player2-dual-end-"));

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

const children = [];

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

try {
  const hostArgs = [
    "run", "--project", join(repositoryRoot, "player2-dualhost"), "-c", "Release", "--",
    "--bridge", bridgeDirectory,
    "--sequence", String(sequence),
    "--consent", "grant",
    "--timeout-seconds", "60",
    "--poll-millis", "10",
  ];
  if (autonomy === "full") {
    hostArgs.push("--autonomy", "full");
  }
  const hostPromise = run("dualhost", "dotnet", hostArgs, 120_000);

  // Both ends must run concurrently: the host publishes the turn and polls,
  // the model process wakes as soon as the file appears.
  // The first `dotnet run` on a clean checkout may restore and compile the
  // headless host. Match the host's 120-second lifetime so cold starts do not
  // race the bridge publication.
  await waitFor(join(bridgeDirectory, "inbox", `turn-${sequence}.json`), 120_000);
  const modelArgs = [
    join(repositoryRoot, "scripts", "dual-end-model.mjs"),
    "--bridge", bridgeDirectory,
    "--sequence", String(sequence),
  ];
  if (autonomy === "full") {
    modelArgs.push("--autonomy", "full");
  }
  const modelPromise = run(
    "dual-end-model",
    process.execPath,
    modelArgs,
    60_000,
  );

  const host = await hostPromise;
  if (host.code !== 0) {
    console.error(host.stdout);
    console.error(host.stderr);
    const model = await modelPromise;
    console.error(model.stdout);
    console.error(model.stderr);
    throw new Error(`dualhost exited with ${host.code}`);
  }
  const model = await modelPromise;
  if (model.code !== 0) {
    console.error(model.stdout);
    console.error(model.stderr);
    throw new Error(`dual-end-model exited with ${model.code}`);
  }

  const outcomeLine = host.stdout.split(/\r?\n/).find((line) => line.includes('"dualhost-ok"'));
  assert.ok(outcomeLine, "dualhost must print one outcome JSON line");
  const outcome = JSON.parse(outcomeLine);
  assert.equal(outcome.sequence, sequence);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.receipt.proposalId, `turn-${sequence}:proposal`);
  if (autonomy === "full") {
    assert.equal(outcome.receipt.autonomy, "full", "an autonomous receipt must carry the full-autonomy marker");
    assert.equal(existsSync(join(bridgeDirectory, "grants", `grant-${sequence}.json`)), false,
      "an autonomous settlement must not write a grant file");
  }

  // The C#-written receipt must be readable by the TypeScript memory projection.
  const digest = await new DecisionFileBridge(bridgeDirectory).recall();
  const recalled = digest.entries.find((entry) => entry.sequence === sequence);
  assert.ok(recalled, `recall must surface the settled receipt: ${JSON.stringify(digest)}`);
  assert.equal(recalled.status, "completed");
  assert.equal(recalled.autonomy, autonomy === "full" ? "full" : undefined);

  console.log(`PASS dual-end (${autonomy}): turn -> request -> ${autonomy === "full" ? "autonomous execution" : "consent"} -> completed receipt -> recall (sequence ${sequence})`);
} finally {
  killChildren();
  await rm(bridgeDirectory, { recursive: true, force: true });
}
