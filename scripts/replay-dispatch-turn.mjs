import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { CallId } from "@deepseek-ai/dsh-llm";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import * as companionPlugin from "../packages/dsh-companion-plugin/dist/index.js";
import { BridgeDispatcher } from "../packages/dsh-dispatcher/dist/index.js";

const fixturePath = resolve(process.cwd(), process.argv[2] ?? "fixtures/decision-turn/rainy-marker.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const expectedProposal = fixture.expectedRequest.proposal;
const proposalArguments = fixture.proposal ?? {
  capabilityId: expectedProposal.capabilityId,
  basedOnObservationIds: expectedProposal.basedOnObservationIds,
  target: expectedProposal.intent.target,
  scope: expectedProposal.scope,
  reason: expectedProposal.reason,
};
const bridgeDirectory = await mkdtemp(join(tmpdir(), "player2-dispatch-replay-"));

try {
  await mkdir(join(bridgeDirectory, "inbox"), { recursive: true });
  await writeFile(
    join(bridgeDirectory, "inbox", `turn-${fixture.turn.sequence}.json`),
    `${JSON.stringify(fixture.turn, null, 2)}\n`,
    "utf8",
  );

  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(companionPlugin, {
    characterName: "Mira",
    relationshipRole: "the player's candid farm partner",
    mode: "decision",
    bridgeDirectory,
  });

  const signal = new AbortController().signal;
  // Plays the model role: the real DSH composition would invoke the same three
  // tools through the skill pipeline the dispatcher wakes.
  let runnerCalls = 0;
  const runner = {
    async runDecisionTurn(sequence) {
      runnerCalls += 1;
      const calls = [
        {
          callId: CallId(`dispatch-observe-${sequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.observe,
          arguments: { sequence },
          signal,
        },
        {
          callId: CallId(`dispatch-propose-${sequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.propose,
          arguments: { sequence, ...proposalArguments },
          signal,
        },
        {
          callId: CallId(`dispatch-request-${sequence}`),
          name: companionPlugin.DECISION_TOOL_NAMES.requestAction,
          arguments: { sequence, proposalId: `turn-${sequence}:proposal` },
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
  };

  const dispatcher = new BridgeDispatcher({
    bridgeDirectory,
    runner,
    useWatcher: false,
    pollIntervalMs: 25,
  });
  await dispatcher.start();

  const actual = JSON.parse(await readFile(
    join(bridgeDirectory, "outbox", `request-${fixture.turn.sequence}.json`),
    "utf8",
  ));
  assert.deepStrictEqual(actual, fixture.expectedRequest);
  assert.deepEqual(dispatcher.stats, { dispatched: 1, failed: 0 });
  await dispatcher.stop();

  // A restarted dispatcher must recognize the answered sequence without
  // waking the session again.
  const restarted = new BridgeDispatcher({
    bridgeDirectory,
    runner,
    useWatcher: false,
    pollIntervalMs: 25,
  });
  await restarted.dispatchPending();
  assert.equal(runnerCalls, 1);
  assert.deepEqual(restarted.stats, { dispatched: 0, failed: 0 });

  console.log(`PASS dispatch replay ${fixture.id}: watcher -> session -> awaiting-player, restart idempotent`);
} finally {
  await rm(bridgeDirectory, { recursive: true, force: true });
}
