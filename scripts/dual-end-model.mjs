import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import * as companionPlugin from "../packages/dsh-companion-plugin/dist/index.js";
import { DreamFileLane, SpineFileStore, SpineTimeline, spineStateFileAt } from "../packages/dsh-companion-plugin/dist/index.js";

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
const reflect = process.argv.includes("--reflect");
const timeoutMs = Number.parseInt(readFlag("timeout-ms") ?? "60000", 10);
if (!bridgeDirectory) {
  throw new Error("The dual-end model process requires --bridge <directory>.");
}

const requestPath = join(bridgeDirectory, "outbox", `request-${sequence}.json`);

if (process.argv.includes("--dream")) {
  // The dream stand-in (P2-0014): one closed reflection over the projected
  // timeline — never a receipt directory scan — and one write-once outcome.
  const dreamRequests = await readdir(join(bridgeDirectory, "dream-inbox")).catch(() => []);
  const dreamName = dreamRequests.map((name) => /^dream-(\d+)\.json$/.exec(name)).find(Boolean);
  if (dreamName === undefined) {
    throw new Error("The dream mode requires a published dream-inbox request.");
  }
  const dreamSequence = Number.parseInt(dreamName[1], 10);
  const spineDirectory = join(bridgeDirectory, "spine");
  const timeline = new SpineTimeline(
    new SpineFileStore(spineDirectory),
    "player2-spine-file",
    spineStateFileAt(join(spineDirectory, "state.json")),
  );
  await timeline.hydrate();
  const receipts = timeline.snapshot().receipts;
  const outcome = receipts.length > 0
    ? {
        kind: "growth",
        insights: [{
          text: "The shared marker plan held; the player follows through on grounded plans.",
          basedOnReceiptSequences: receipts.map((receipt) => receipt.sequence).slice(0, 8),
        }],
        focus: "Plan one grounded marker the player will grant without hesitation.",
      }
    : { kind: "no-change" };
  const lane = new DreamFileLane(bridgeDirectory, timeline);
  const closed = await lane.decide(dreamSequence, outcome);
  process.stdout.write(`dual-end-model: dream ${dreamSequence} closed with ${closed} (watermark ${timeline.snapshot().watermark})\n`);
  process.exit(0);
}

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
  // The P2-0014 file spine: decision-lane bridge I/O records reference events
  // so the dream lane can project the relationship timeline without
  // rescanning the receipts directory.
  spine: "file",
});

const signal = new AbortController().signal;
const runner = {
    async runDecisionTurn(turnSequence) {
      const calls = [
        {
          callId: ToolCallId(`dual-observe-${turnSequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.observe,
          arguments: { sequence: turnSequence },
          signal,
        },
        {
          callId: ToolCallId(`dual-recall-${turnSequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.recall,
          arguments: {},
          signal,
        },
      ];
      if (reflect) {
        // Grounded self-reflection: cite only receipt sequences this bridge
        // actually holds, mirroring what companion_recall returned.
        const cited = (await receiptSequences(bridgeDirectory)).slice(0, 8);
        if (cited.length > 0) {
          calls.push({
            callId: ToolCallId(`dual-reflect-${turnSequence}`),
            name: companionPlugin.DECISION_TOOL_NAMES.reflect,
            arguments: {
              sequence: turnSequence,
              insights: [{
                text: "The shared marker plan completed; the player follows through on grounded plans.",
                basedOnReceiptSequences: cited,
              }],
              focus: "Plan one grounded marker the player will grant without hesitation.",
            },
            signal,
          });
        }
      }
      calls.push(
        {
          callId: ToolCallId(`dual-propose-${turnSequence}`),
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
            utterance: "The rain has given us room to think, so I'd like to mark our planning spot here on the Farm.",
          },
          signal,
        },
        {
          callId: ToolCallId(`dual-request-${turnSequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.requestAction,
          arguments: { sequence: turnSequence, proposalId: `turn-${turnSequence}:proposal` },
          signal,
        },
      );
      for (const call of calls) {
        const result = await ctx.tools.execute(call);
        if (result.isError) {
          throw new Error(`${call.name} failed: ${JSON.stringify(result.content)}`);
        }
      }
    },
};

// Wait for the C# dual host to publish the turn, then play the DSH role once.
const turnPath = join(bridgeDirectory, "inbox", `turn-${sequence}.json`);
const startedAt = Date.now();
while (!await exists(turnPath)) {
  if (Date.now() - startedAt > timeoutMs) {
    console.error(`dual-end-model: timed out waiting for ${turnPath}`);
    process.exit(3);
  }
  await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 25));
}
await runner.runDecisionTurn(sequence);
assert.ok(await exists(requestPath), `the dual-end model must write ${requestPath}`);
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

/** Lists the persisted receipt sequences for this bridge, newest first. */
async function receiptSequences(directory) {
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(join(directory, "receipts")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const sequences = [];
  for (const name of names) {
    const match = /^receipt-(\d+)\.json$/.exec(name);
    if (match !== null) sequences.push(Number.parseInt(match[1], 10));
  }
  return sequences.sort((left, right) => right - left);
}
