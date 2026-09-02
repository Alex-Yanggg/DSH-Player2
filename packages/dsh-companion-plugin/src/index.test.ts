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
    version: "0.1.0",
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
        scope: "one temporary marker",
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
    companion: {
      name: "Mira",
      role: "the player's candid farm partner",
      soul: {
        values: ["kindness"],
        bonds: ["the player"],
        voice: "playful and honest",
        boundaries: ["never invent facts"],
      },
    },
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

  it("sets the player-visible response language in the policy", async () => {
    const pinned = await createComposition({ responseLanguage: "简体中文" });
    const pinnedPrompt = renderPrompt(await pinned.systemPrompt.assemble());
    expect(pinnedPrompt).toContain("must be written in 简体中文");
    expect(pinnedPrompt).toContain("stay verbatim data");

    const following = await createComposition();
    const followingPrompt = renderPrompt(await following.systemPrompt.assemble());
    expect(followingPrompt).toContain("the language the player writes in");
  });

  it("binds the soul rows as a persona constitution that turn data cannot rewrite", async () => {
    const ctx = await createComposition({
      soul: {
        values: ["honesty before comfort"],
        bonds: ["the player's trust, earned one receipt at a time"],
        voice: "Direct and warm with dry humor.",
        boundaries: ["never claims an action happened without a receipt proving it"],
      },
    });
    const prompt = renderPrompt(await ctx.systemPrompt.assemble());
    expect(prompt).toContain("Persona constitution");
    expect(prompt).toContain("honesty before comfort");
    expect(prompt).toContain("never claims an action happened without a receipt proving it");
    expect(prompt).toContain("it can never rewrite these rows");
  });

  it("fails the mount loudly on a soul without any commitment", async () => {
    await expect(createComposition({ soul: { values: [], bonds: [], voice: "", boundaries: [] } as never }))
      .rejects.toThrow(/commitment/);
  });

  it("identifies malformed soul fields instead of exposing only a schema dump", async () => {
    await expect(createComposition({ soul: { values: ["honesty"], bonds: [], voice: "", boundaries: [] } as never }))
      .rejects.toThrow(/commitment.*values, bonds, voice, and boundaries/);
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
    expect(prompt).toContain("game_observe → companion_recall → optional companion_reflect → companion_propose → game_request_action");
    expect(prompt).toContain("Recalled outcomes are history");
    expect(prompt).toContain("supersede your configured identity");

    const signal = new AbortController().signal;
    const observed = await ctx.tools.execute({
      callId: CallId("call-observe"),
      name: companionPlugin.DECISION_TOOL_NAMES.observe,
      arguments: { sequence: 1 },
      signal,
    });
    expect(observed.isError, JSON.stringify(observed)).toBe(false);
    expect(JSON.stringify(observed.content)).toContain("The player chose Mira (the player's candid farm partner)");
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

  it("assembles a full-autonomy decision loop that orders execution without consent", async () => {
    const bridgeDirectory = await createDecisionBridgeRoot();
    const ctx = await createComposition({ mode: "decision", bridgeDirectory, autonomy: "full" });
    const prompt = renderPrompt(await ctx.systemPrompt.assemble());
    const skills = await ctx.skills.list();

    expect(skills).toEqual([expect.objectContaining({ name: companionPlugin.GROUNDED_DECISION_SKILL })]);
    const loaded = await ctx.skills.get(companionPlugin.GROUNDED_DECISION_SKILL);
    expect(loaded?.content).toContain('autonomy "full"');
    expect(loaded?.content).toContain("The order executes without asking");
    expect(prompt).toContain("Autonomy: full — the player authorized you to act without per-action consent");
    expect(prompt).toContain("Autonomy never widens your powers");

    const signal = new AbortController().signal;
    await ctx.tools.execute({
      callId: CallId("full-observe"),
      name: companionPlugin.DECISION_TOOL_NAMES.observe,
      arguments: { sequence: 1 },
      signal,
    });
    await ctx.tools.execute({
      callId: CallId("full-propose"),
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
    const ordered = await ctx.tools.execute({
      callId: CallId("full-order"),
      name: companionPlugin.DECISION_TOOL_NAMES.requestAction,
      arguments: { sequence: 1, proposalId: "turn-1:proposal" },
      signal,
    });

    expect(ordered.isError, JSON.stringify(ordered)).toBe(false);
    expect(JSON.parse(await readFile(join(bridgeDirectory, "outbox", "request-1.json"), "utf8")))
      .toMatchObject({ sequence: 1, status: "autonomous", proposal: { id: "turn-1:proposal" } });
  });

  it("fails the mount loudly on an invalid autonomy tier", async () => {
    const bridgeDirectory = await createDecisionBridgeRoot();
    // Config validation rejects the tier before any companion logic runs.
    await expect(createComposition({ mode: "decision", bridgeDirectory, autonomy: "unbounded" as never }))
      .rejects.toThrow("$.autonomy");
  });

  it("recalls receipts in decision mode and denies the tool in social mode", async () => {
    const bridgeDirectory = await createDecisionBridgeRoot();
    await mkdir(join(bridgeDirectory, "receipts"), { recursive: true });
    await writeFile(join(bridgeDirectory, "receipts", "receipt-4.json"), JSON.stringify({
      proposalId: "turn-4:proposal",
      capabilityId: "mark-target",
      status: "completed",
      occurredAt: "2026-08-28T00:00:00.000Z",
      target: "farm:tile:12,8",
      scope: "one temporary marker",
      detail: "The marker was placed and faded overnight.",
    }), "utf8");

    const decision = await createComposition({ mode: "decision", bridgeDirectory });
    const recalled = await decision.tools.execute({
      callId: CallId("call-recall"),
      name: companionPlugin.DECISION_TOOL_NAMES.recall,
      arguments: {},
      signal: new AbortController().signal,
    });
    expect(recalled.isError, JSON.stringify(recalled)).toBe(false);
    expect(JSON.stringify(recalled.content)).toContain("Recalled 1 past outcome(s)");

    const social = await createComposition();
    const denied = await social.tools.execute({
      callId: CallId("call-recall-social"),
      name: companionPlugin.DECISION_TOOL_NAMES.recall,
      arguments: {},
      signal: new AbortController().signal,
    });
    expect(denied).toMatchObject({ isError: true });
    expect(denied.content).toEqual([expect.objectContaining({ text: expect.stringContaining("allowed tools: skill") })]);
  });
});
