import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { CallId } from "@deepseek-ai/dsh-llm";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt, { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as companionPlugin from "./index.js";

const roots: string[] = [];

async function createComposition(config: Partial<companionPlugin.Config> = {}): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(companionPlugin, {
    characterName: "Mira",
    relationshipRole: "the player's candid farm partner",
    ...config,
  });
  return ctx;
}

async function createDecisionBridgeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "player2-plugin-decision-"));
  roots.push(root);
  await mkdir(join(root, "inbox"), { recursive: true });
  await writeFile(join(root, "inbox", "turn-1.json"), JSON.stringify({
    version: "0.0.3",
    sequence: 1,
    createdAt: "2026-08-29T00:00:00.000Z",
    gameDay: 12,
    adapter: {
      id: "stardew-semantic",
      gameId: "stardew-valley",
      accessMode: "semantic",
      capabilities: [{
        id: "mark-target",
        title: "Mark one agreed target",
        accessMode: "semantic",
        requiresExplicitConsent: true,
        isReversible: true,
        inputSchemaRef: "player2://mark-target/0.1",
      }],
    },
    observations: [{
      id: "weather-12",
      kind: "world",
      observedAt: "2026-08-29T00:00:00.000Z",
      expiresAt: null,
      source: "stardew-mod",
      accessMode: "semantic",
      confidence: 1,
      facts: { weather: "rain" },
    }],
  }), "utf8");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Player DSH companion composition", () => {
  it("assembles identity and a model-invocable grounded-deliberation skill", async () => {
    const ctx = await createComposition();

    const skills = await ctx.skills.list();
    const loaded = await ctx.skills.get(companionPlugin.GROUNDED_DELIBERATION_SKILL);
    const prompt = renderPrompt(await ctx.systemPrompt.assemble());

    expect(skills).toEqual([expect.objectContaining({
      name: companionPlugin.GROUNDED_DELIBERATION_SKILL,
      invocation: { modelInvocable: true, userInvocable: false },
    })]);
    expect(loaded?.content).toContain("Prefer question or uncertain when evidence is insufficient.");
    expect(prompt).toContain("You are Mira, the player's candid farm partner.");
    expect(prompt).toContain(`load the ${companionPlugin.GROUNDED_DELIBERATION_SKILL} skill`);
  });

  it("allows skill loading but monotonically denies an unrelated tool", async () => {
    const ctx = await createComposition();
    const executeSkill = vi.fn().mockResolvedValue("loaded");
    const executeShell = vi.fn().mockResolvedValue("should never run");
    ctx.tools.register(defineTool({
      name: "skill",
      description: "Test skill loader.",
      parameters: {},
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      execute: executeSkill,
    }));
    ctx.tools.register(defineTool({
      name: "bash",
      description: "A tool forbidden in social turns.",
      parameters: {},
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      execute: executeShell,
    }));

    const signal = new AbortController().signal;
    const allowed = await ctx.tools.execute({ callId: CallId("call-skill"), name: "skill", arguments: {}, signal });
    const denied = await ctx.tools.execute({ callId: CallId("call-bash"), name: "bash", arguments: {}, signal });

    expect(allowed.isError, JSON.stringify(allowed)).toBe(false);
    expect(executeSkill).toHaveBeenCalledOnce();
    expect(denied).toMatchObject({ isError: true });
    expect(denied.content).toEqual([expect.objectContaining({ text: expect.stringContaining("allowed tools: skill") })]);
    expect(executeShell).not.toHaveBeenCalled();
  });

  it("assembles a decision skill and permits only the ordered decision tool surface", async () => {
    const bridgeDirectory = await createDecisionBridgeRoot();
    const ctx = await createComposition({ mode: "decision", bridgeDirectory });
    const prompt = renderPrompt(await ctx.systemPrompt.assemble());
    const skills = await ctx.skills.list();
    const executeShell = vi.fn().mockResolvedValue("should never run");
    ctx.tools.register(defineTool({
      name: "bash",
      description: "A tool forbidden in decision turns.",
      parameters: {},
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      execute: executeShell,
    }));

    expect(skills).toEqual([expect.objectContaining({ name: companionPlugin.GROUNDED_DECISION_SKILL })]);
    expect(prompt).toContain("game_observe → companion_propose → game_request_action");

    const signal = new AbortController().signal;
    const observed = await ctx.tools.execute({
      callId: CallId("call-observe"),
      name: companionPlugin.DECISION_TOOL_NAMES.observe,
      arguments: { sequence: 1 },
      signal,
    });
    const proposed = await ctx.tools.execute({
      callId: CallId("call-propose"),
      name: companionPlugin.DECISION_TOOL_NAMES.propose,
      arguments: {
        sequence: 1,
        capabilityId: "mark-target",
        basedOnObservationIds: ["weather-12"],
        target: "farm:tile:12,8",
        scope: "one temporary marker",
        reason: "The observed rain makes a shared planning marker useful.",
      },
      signal,
    });
    const requested = await ctx.tools.execute({
      callId: CallId("call-request"),
      name: companionPlugin.DECISION_TOOL_NAMES.requestAction,
      arguments: { sequence: 1, proposalId: "turn-1:proposal" },
      signal,
    });
    const denied = await ctx.tools.execute({ callId: CallId("call-bash-decision"), name: "bash", arguments: {}, signal });

    expect(observed.isError, JSON.stringify(observed)).toBe(false);
    expect(proposed.isError, JSON.stringify(proposed)).toBe(false);
    expect(requested.isError, JSON.stringify(requested)).toBe(false);
    expect(denied).toMatchObject({ isError: true });
    expect(executeShell).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(bridgeDirectory, "outbox", "request-1.json"), "utf8")))
      .toMatchObject({ sequence: 1, status: "awaiting-player", proposal: { id: "turn-1:proposal" } });
  });
});
