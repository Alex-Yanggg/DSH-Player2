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
  const hostPromise = run(
    "dualhost",
    "dotnet",
    [
      "run", "--project", join(repositoryRoot, "player2-dualhost"), "-c", "Release", "--",
      "--bridge", bridgeDirectory,
      "--sequence", String(sequence),
      "--consent", "grant",
      "--timeout-seconds", "60",
      "--poll-millis", "10",
    ],
    120_000,
  );

  // Both ends must run concurrently: the host publishes the turn and polls,
  // the model process wakes as soon as the file appears.
  await waitFor(join(bridgeDirectory, "inbox", `turn-${sequence}.json`), 30_000);
  const modelPromise = run(
    "dual-end-model",
    process.execPath,
    [join(repositoryRoot, "scripts", "dual-end-model.mjs"), "--bridge", bridgeDirectory, "--sequence", String(sequence)],
    60_000,
  );

  const host = await hostPromise;
  if (host.code !== 0) {
    console.error(host.stdout);
    console.error(host.stderr);
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

  // The C#-written receipt must be readable by the TypeScript memory projection.
  const digest = await new DecisionFileBridge(bridgeDirectory).recall();
  assert.ok(
    digest.entries.some((entry) => entry.sequence === sequence && entry.status === "completed"),
    `recall must surface the settled receipt: ${JSON.stringify(digest)}`,
  );

  console.log(`PASS dual-end: turn -> request -> consent -> completed receipt -> recall (sequence ${sequence})`);
} finally {
  killChildren();
  await rm(bridgeDirectory, { recursive: true, force: true });
}
