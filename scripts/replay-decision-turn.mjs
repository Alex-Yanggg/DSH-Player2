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

const fixturePath = resolve(process.cwd(), process.argv[2] ?? "fixtures/decision-turn/rainy-marker.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const autonomy = fixture.autonomy === "full" ? "full" : "consult";
const expectedProposal = fixture.expectedRequest.proposal;
const proposalArguments = fixture.proposal ?? {
  capabilityId: expectedProposal.capabilityId,
  basedOnObservationIds: expectedProposal.basedOnObservationIds,
  target: expectedProposal.intent.target,
  scope: expectedProposal.scope,
  reason: expectedProposal.reason,
};
const bridgeDirectory = await mkdtemp(join(tmpdir(), "player2-decision-replay-"));

try {
  await mkdir(join(bridgeDirectory, "inbox"), { recursive: true });
  await writeFile(
    join(bridgeDirectory, "inbox", `turn-${fixture.turn.sequence}.json`),
    `${JSON.stringify(fixture.turn, null, 2)}\n`,
    "utf8",
  );
  // A reflect fixture seeds prior shared outcomes so companion_reflect can be
  // grounded in exactly what companion_recall would return.
  if (fixture.receipts) {
    await mkdir(join(bridgeDirectory, "receipts"), { recursive: true });
    for (const receipt of fixture.receipts) {
      await writeFile(join(bridgeDirectory, "receipts", receipt.name), `${JSON.stringify(receipt.body, null, 2)}\n`, "utf8");
    }
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
  });

  const signal = new AbortController().signal;
  const calls = [
    {
      callId: CallId("replay-observe"),
      name: companionPlugin.DECISION_TOOL_NAMES.observe,
      arguments: { sequence: fixture.turn.sequence },
      signal,
    },
  ];
  if (fixture.reflect) {
    calls.push({
      callId: CallId("replay-reflect"),
      name: companionPlugin.DECISION_TOOL_NAMES.reflect,
      arguments: fixture.reflect,
      signal,
    });
  }
  calls.push(
    {
      callId: CallId("replay-propose"),
      name: companionPlugin.DECISION_TOOL_NAMES.propose,
      arguments: { sequence: fixture.turn.sequence, ...proposalArguments },
      signal,
    },
    {
      callId: CallId("replay-request"),
      name: companionPlugin.DECISION_TOOL_NAMES.requestAction,
      arguments: { sequence: fixture.turn.sequence, proposalId: `turn-${fixture.turn.sequence}:proposal` },
      signal,
    },
  );
  for (const call of calls) {
    const result = await ctx.tools.execute(call);
    if (result.isError) {
      throw new Error(`${call.name} failed: ${JSON.stringify(result.content)}`);
    }
  }

  if (fixture.expectedGrowth) {
    const actualGrowth = JSON.parse(await readFile(
      join(bridgeDirectory, "outbox", `growth-${fixture.turn.sequence}.json`),
      "utf8",
    ));
    assert.deepStrictEqual(actualGrowth, fixture.expectedGrowth);
  }
  const actual = JSON.parse(await readFile(
    join(bridgeDirectory, "outbox", `request-${fixture.turn.sequence}.json`),
    "utf8",
  ));
  assert.deepStrictEqual(actual, fixture.expectedRequest);
  console.log(`PASS ${fixture.id}: observe -> ${fixture.reflect ? "reflect -> " : ""}propose -> ${autonomy === "full" ? "autonomous order" : "awaiting-player"}`);
} finally {
  await rm(bridgeDirectory, { recursive: true, force: true });
}
