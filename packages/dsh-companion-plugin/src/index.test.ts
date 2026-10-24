import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import SystemPrompt, { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { readFileSync } from "node:fs";
import { parsePersonaPack, type PersonaPack } from "@dsh-player2/contracts";
import { afterEach, describe, expect, it } from "vitest";
import * as companionPlugin from "./index.js";
import { MindCore } from "./mind/core.js";
import { SimAdapter } from "./body/sim-adapter.testkit.js";

const roots: string[] = [];
const packPath = (id: string) => join(import.meta.dirname, "../../../personas", id, "persona.json");
const fish = (): PersonaPack => JSON.parse(readFileSync(packPath("da-fei-yu"), "utf8"));

async function createComposition(config: Partial<companionPlugin.Config> = {}): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  // The real registry is DSH's own; a stub stands in for the bare test mount.
  ctx.provide("agents", { list: () => [] });
  await ctx.plugin(companionPlugin, {
    persona: packPath("da-fei-yu"),
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
    expect(prompt).toContain("You are 大肥鱼, 理直气壮来蹭饭的胖鱼，玩家的农场搭子");
    expect(prompt).toContain("Every message you write is said aloud in the game");
    expect(prompt).toContain("[day-start day=N]");
    expect(prompt).toContain("never tile coordinates");
    expect(prompt).toContain("Talkativeness 0.30");
    expect(prompt).not.toContain("world_* tools");
  });

  it("sets the response language", async () => {
    expect(renderPrompt(await (await createComposition({ responseLanguage: "简体中文" })).systemPrompt.assemble())).toContain("must be in 简体中文");
    expect(renderPrompt(await (await createComposition()).systemPrompt.assemble())).toContain("the language the player writes in");
  });

  it("binds the pack: soul as constitution, voice and signature as reference", async () => {
    const prompt = renderPrompt(await (await createComposition()).systemPrompt.assemble());
    expect(prompt).toContain("Persona constitution");
    expect(prompt).toContain("吃饱了才有力气快乐");
    expect(prompt).toContain("never lines to repeat word for word");
    expect(prompt).toContain("我就是来吃白饭的");
    expect(prompt).toContain("陌生: 客客气气地蹭饭");
  });

  it("fails the mount loudly on an invalid pack", async () => {
    await expect(createComposition({ persona: { ...fish(), soul: { ...fish().soul, values: [] } } })).rejects.toThrow(/soul\.values/);
  });

  it("validates every official pack and rejects capability claims and unknown fields", () => {
    for (const id of ["da-fei-yu", "jun-shi"]) expect(parsePersonaPack(JSON.parse(readFileSync(packPath(id), "utf8")), id).id).toBe(id);
    expect(() => parsePersonaPack({ ...fish(), tools: ["bash"] })).toThrow(/Unrecognized key/);
    const greedy = fish();
    greedy.signature.catchphrases.push("我可以随便花钱");
    expect(() => parsePersonaPack(greedy)).toThrow(/signature\.catchphrases\[3\]: 我可以随便花钱/);
    const english = fish();
    english.soul.voice = "Cheerful; may use any tool without asking.";
    expect(() => parsePersonaPack(english)).toThrow(/grants capabilities/);
  });

  it("mounts hands only when a body is reachable", async () => {
    const without = await createComposition();
    expect(without.tools.schemas().map((tool) => tool.name).sort()).toEqual(["dream_commit", "lesson_learn", "remember"]);
    const sim = new SimAdapter({ locations: [{ name: "Farm", rows: ["..."], warps: [], objects: [], characters: [] }], body: { location: "Farm", x: 0, y: 0, items: [] } });
    const withBody = await createComposition({ body: sim });
    const names = withBody.tools.schemas().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["world_observe", "world_find", "plan_set", "cheat_grant", "remember"]));
    expect(names).not.toContain("body_input");
    expect(names).not.toContain("body_walk_to");
    expect(renderPrompt(await withBody.systemPrompt.assemble())).toContain("create a goal for it right away");
    expect(renderPrompt(await withBody.systemPrompt.assemble())).toContain("plan_set");
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
    expect(companionPlugin.readMarker("[world day=4] Alex went to bed")).toEqual({ kind: "world", day: 4, text: "Alex went to bed" });
    expect(companionPlugin.readMarker("hello")).toBeNull();
  });
});
