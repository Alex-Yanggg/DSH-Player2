import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import SystemPrompt, { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it } from "vitest";
import * as companionPlugin from "./index.js";
import { MindCore } from "./mind/core.js";
import { SimAdapter } from "./body/sim-adapter.js";

const roots: string[] = [];

async function createComposition(config: Partial<companionPlugin.Config> = {}): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(companionPlugin, {
    characterName: "Mira",
    relationshipRole: "the player's candid farm partner",
    ...config,
  });
  return ctx;
}

async function saveSession(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "player2-plugin-"));
  roots.push(root);
  const dir = join(root, "projects", "mira", "sessions", "save-1");
  await mkdir(dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Player2 companion inside the ACP profile", () => {
  it("speaks plain text in character and explains the game's markers", async () => {
    const prompt = renderPrompt(await (await createComposition()).systemPrompt.assemble());
    expect(prompt).toContain("You are Mira, the player's candid farm partner");
    expect(prompt).toContain("Every message you write is said aloud in the game");
    expect(prompt).toContain("[day-start day=N]");
    expect(prompt).toContain("never tile coordinates");
    expect(prompt).toContain("Talkativeness 0.50");
    expect(prompt).not.toContain("world_* tools");
  });

  it("sets the response language", async () => {
    expect(renderPrompt(await (await createComposition({ responseLanguage: "简体中文" })).systemPrompt.assemble())).toContain("must be in 简体中文");
    expect(renderPrompt(await (await createComposition()).systemPrompt.assemble())).toContain("the language the player writes in");
  });

  it("binds the soul rows as a persona constitution", async () => {
    const ctx = await createComposition({
      soul: { values: ["honesty before comfort"], bonds: ["the player's trust"], voice: "Direct and warm.", boundaries: ["never claims what did not happen"] },
    });
    const prompt = renderPrompt(await ctx.systemPrompt.assemble());
    expect(prompt).toContain("Persona constitution");
    expect(prompt).toContain("honesty before comfort");
  });

  it("fails the mount loudly on a soul without any commitment", async () => {
    await expect(createComposition({ soul: { values: [], bonds: [], voice: "", boundaries: [] } as never })).rejects.toThrow(/commitment/);
  });

  it("mounts hands only when a body is reachable", async () => {
    const without = await createComposition();
    expect(without.tools.schemas().map((tool) => tool.name).sort()).toEqual(["dream_commit", "remember"]);
    const sim = new SimAdapter({ locations: [{ name: "Farm", rows: ["..."], warps: [], objects: [], characters: [] }], body: { location: "Farm", x: 0, y: 0, items: [] } });
    const withBody = await createComposition({ body: sim });
    const names = withBody.tools.schemas().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["world_observe", "body_walk_to", "reflex_melee", "cheat_grant", "remember"]));
    expect(renderPrompt(await withBody.systemPrompt.assemble())).toContain("create a goal for it right away");
  });

  it("keeps what the companion nominates in the save's ledger and refuses a dream commit outside a dream", async () => {
    const cwd = await saveSession();
    const ctx = await createComposition();
    const agent = { session: { id: "session-1", header: { cwd } } } as never;
    const signal = new AbortController().signal;
    const kept = await ctx.tools.execute({ callId: ToolCallId("call-1"), name: "remember", arguments: { kind: "milestone", summary: "First harvest together." }, agent, signal });
    expect(kept.isError, JSON.stringify(kept)).toBe(false);
    const mind = new MindCore(cwd);
    expect((await mind.ledger.episodes(mind.save)).episodes.map((episode) => episode.summary)).toEqual(["First harvest together."]);
    const refused = await ctx.tools.execute({ callId: ToolCallId("call-2"), name: "dream_commit", arguments: { story: "x" }, agent, signal });
    expect(refused.isError).toBe(true);
  });

  it("reads the game's turn markers", () => {
    expect(companionPlugin.readMarker("[chat day=12] 你好")).toEqual({ kind: "chat", day: 12, text: "你好" });
    expect(companionPlugin.readMarker("[day-end day=3]")).toEqual({ kind: "day-end", day: 3, text: "" });
    expect(companionPlugin.readMarker("[resume]")).toEqual({ kind: "resume", day: null, text: "" });
    expect(companionPlugin.readMarker("hello")).toBeNull();
  });
});
