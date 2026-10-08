import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import * as companionPlugin from "./index.js";
import { answerCompanionAsk } from "./approval.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const companionTools = new Set(["game_observe", "game_request_action", "skill"]);

describe("answerCompanionAsk", () => {
  it("answers companion-owned asks from the standing autonomy tier", () => {
    expect(answerCompanionAsk("consult", "game_observe", companionTools)).toBe("rejected");
    expect(answerCompanionAsk("full", "game_request_action", companionTools)).toBe("allowed-once");
  });

  it("defers asks about tools the companion does not own", () => {
    expect(answerCompanionAsk("consult", "shell", companionTools)).toBeUndefined();
    expect(answerCompanionAsk("full", "shell", companionTools)).toBeUndefined();
  });
});

describe("companion approval answerer", () => {
  it("routes companion asks by tier and leaves foreign tools to later answerers", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-approval-"));
    roots.push(root);
    const fallback = () => Promise.resolve("unavailable" as const);

    const consult = new Context();
    await consult.plugin(SkillRegistry);
    await consult.plugin(SystemPrompt);
    await consult.plugin(ToolRuntime);
    await consult.plugin(companionPlugin, {
      characterName: "Mira",
      mode: "decision",
      bridgeDirectory: root,
    });
    await expect(consult.waterfall("approval/request", { toolName: "game_observe" } as never, fallback))
      .resolves.toBe("rejected");

    const full = new Context();
    await full.plugin(SkillRegistry);
    await full.plugin(SystemPrompt);
    await full.plugin(ToolRuntime);
    await full.plugin(companionPlugin, {
      characterName: "Mira",
      mode: "decision",
      autonomy: "full",
      bridgeDirectory: root,
    });
    await expect(full.waterfall("approval/request", { toolName: "game_observe" } as never, fallback))
      .resolves.toBe("allowed-once");
    // Autonomy never widens someone else's surface.
    await expect(full.waterfall("approval/request", { toolName: "shell" } as never, fallback))
      .resolves.toBe("unavailable");
  });

  it("mounts without the invariants registry and without an approval answerer in social mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-approval-"));
    roots.push(root);
    const ctx = new Context();
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(companionPlugin, {
      characterName: "Mira",
      mode: "social",
    });
    const fallback = () => Promise.resolve("unavailable" as const);
    await expect(ctx.waterfall("approval/request", { toolName: "skill" } as never, fallback))
      .resolves.toBe("unavailable");
  });
});
