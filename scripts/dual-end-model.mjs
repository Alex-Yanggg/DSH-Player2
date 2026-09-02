import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { CallId } from "@deepseek-ai/dsh-llm";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import * as companionPlugin from "../packages/dsh-companion-plugin/dist/index.js";
import { BridgeDispatcher } from "../packages/dsh-dispatcher/dist/index.js";

// The TS end of the unattended dual-end harness: one process that plays the
// DSH composition role. It wakes the dedicated session for whatever turn the
// C# dual host publishes, drives the real skill/tool pipeline, and exits once
// the awaiting-player request is on disk. No model, no game, no API key.

function readFlag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDirectory = resolve(readFlag("bridge") ?? "");
const sequence = Number.parseInt(readFlag("sequence") ?? "12", 10);
const autonomy = readFlag("autonomy") === "full" ? "full" : "consult";
const timeoutMs = Number.parseInt(readFlag("timeout-ms") ?? "60000", 10);
if (!bridgeDirectory) {
  throw new Error("The dual-end model process requires --bridge <directory>.");
}

const requestPath = join(bridgeDirectory, "outbox", `request-${sequence}.json`);
const ctx = new Context();
await ctx.plugin(SystemPrompt);
await ctx.plugin(SkillRegistry);
await ctx.plugin(ToolRuntime);
await ctx.plugin(companionPlugin, {
  characterName: "Mira",
  relationshipRole: "the player's candid farm partner",
  mode: "decision",
  autonomy,
  bridgeDirectory,
});

const signal = new AbortController().signal;
const dispatcher = new BridgeDispatcher({
  bridgeDirectory,
  useWatcher: true,
  pollIntervalMs: 25,
  runner: {
    async runDecisionTurn(turnSequence) {
      const calls = [
        {
          callId: CallId(`dual-observe-${turnSequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.observe,
          arguments: { sequence: turnSequence },
          signal,
        },
        {
          callId: CallId(`dual-recall-${turnSequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.recall,
          arguments: {},
          signal,
        },
        {
          callId: CallId(`dual-propose-${turnSequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.propose,
          arguments: {
            sequence: turnSequence,
            capabilityId: "visual-receipt",
            basedOnObservationIds: [`world-${turnSequence}`, `self-${turnSequence}`],
            // The exact location-qualified target the dual host advertises for
            // its WorldSnapshot("Farm", tile 12,8); C# revalidates it strictly.
            target: "stardew-location:Farm:tile:12,8",
            scope: "visual marker + sound only",
            reason: "The observed rain makes a shared planning marker useful.",
          },
          signal,
        },
        {
          callId: CallId(`dual-request-${turnSequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.requestAction,
          arguments: { sequence: turnSequence, proposalId: `turn-${turnSequence}:proposal` },
          signal,
        },
      ];
      for (const call of calls) {
        const result = await ctx.tools.execute(call);
        if (result.isError) {
          throw new Error(`${call.name} failed: ${JSON.stringify(result.content)}`);
        }
      }
    },
  },
});

await dispatcher.start();
const startedAt = Date.now();
while (!await exists(requestPath)) {
  if (Date.now() - startedAt > timeoutMs) {
    console.error(`dual-end-model: timed out waiting for ${requestPath}`);
    process.exit(3);
  }
  await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 25));
}
await dispatcher.stop();
assert.equal(dispatcher.stats.dispatched, 1, "the dual-end model must dispatch exactly one turn");
JSON.parse(await readFile(requestPath, "utf8"));
process.stdout.write(`dual-end-model: request-${sequence}.json accepted\n`);
process.exit(0);

async function exists(path) {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}
