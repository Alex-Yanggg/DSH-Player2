import { Context } from "@deepseek-ai/cordis";
import { CallId } from "@deepseek-ai/dsh-llm";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt, { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import * as companionPlugin from "./index.js";

async function createComposition(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(companionPlugin, {
    characterName: "Mira",
    relationshipRole: "the player's candid farm partner",
  });
  return ctx;
}

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
    expect(denied.content).toEqual([expect.objectContaining({ text: expect.stringContaining("only skill loading is permitted") })]);
    expect(executeShell).not.toHaveBeenCalled();
  });
});
