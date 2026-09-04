import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { CompanionIdentity } from "@dsh-player2/contracts";
import {
  companionPresetComposition,
  companionPresetId,
  Config,
  ensureCompanionPreset,
  inject,
  listSessionDirectories,
  name,
  Player2DshHost,
  resumeOrCreate,
} from "./index.js";

const MIRA: CompanionIdentity = {
  name: "Mira",
  role: "the player's candid farm partner",
  soul: {
    values: ["curiosity and kindness"],
    bonds: ["the player as an equal"],
    voice: "Bright, candid, and concise.",
    boundaries: ["never invent a shared memory"],
  },
};

describe("Player2 DSH host bundle", () => {
  it("declares the DSH services needed to create owned native agents", () => {
    expect(name).toBe("player2-dsh-host");
    expect(inject).toEqual(["agents", "agentDefaultModel", "agentPresets", "sessions", "sessionPersistence"]);
    expect(Config).toBeDefined();
  });

  it("mounts into the DSH home path instead of accepting a game-side launcher", async () => {
    const patchPath = fileURLToPath(new URL("../cordis.patch.yml", import.meta.url));
    const patch = await readFile(patchPath, "utf8");
    expect(patch).toContain("@dsh-player2/dsh-host-plugin");
    expect(patch).toContain("dshHomePath('player2', 'bridge')");
    expect(patch).not.toContain("CompanionLaunchCommand");
  });

  it("publishes and removes a fresh runtime readiness heartbeat", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-ready-"));
    const host = new Player2DshHost({} as Context, { bridgeDirectory: root });
    try {
      await host.start();
      const runtime = join(root, "runtime");
      const files = await readdir(runtime);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^ready-\d+-[0-9a-f-]+\.json$/);
      const marker = JSON.parse(await readFile(join(runtime, files[0]!), "utf8")) as Record<string, unknown>;
      expect(marker).toMatchObject({ version: "0.1.1", status: "ready", source: "dsh", pid: process.pid });

      await host.stop();
      expect(await readdir(runtime)).toEqual([]);
    } finally {
      await host.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes fixed companion sessions and creates only when no persisted session exists", async () => {
    let createCalls = 0;
    expect(await resumeOrCreate(true, async () => "resumed", async () => { createCalls++; return "created"; })).toBe("resumed");
    expect(createCalls).toBe(0);

    expect(await resumeOrCreate(
      false,
      async () => "wrong",
      async () => { createCalls++; return "created"; },
    )).toBe("created");
    expect(createCalls).toBe(1);

    await expect(resumeOrCreate(
      true,
      async () => { throw new Error("session id collision"); },
      async () => { createCalls++; return "wrong"; },
    )).rejects.toThrow("id collision");
    expect(createCalls).toBe(1);
  });

  it("discovers project/session directories and ignores flat leftovers", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-sessions-"));
    try {
      await mkdir(join(root, "projects", "mira", "sessions", "42"), { recursive: true });
      await mkdir(join(root, "projects", "mira", "sessions", "7"), { recursive: true });
      await mkdir(join(root, "projects", "rowan", "sessions", "1"), { recursive: true });
      await mkdir(join(root, "projects", "broken"), { recursive: true });
      await mkdir(join(root, "inbox"), { recursive: true });

      const sessions = await listSessionDirectories(root);

      expect(sessions).toEqual([
        join(root, "projects", "mira", "sessions", "42"),
        join(root, "projects", "mira", "sessions", "7"),
        join(root, "projects", "rowan", "sessions", "1"),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates only root diagnostics and runtime directories, never flat lanes", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-layout-"));
    const host = new Player2DshHost({} as Context, { bridgeDirectory: root });
    try {
      await host.start();
      const entries = (await readdir(root)).sort();
      expect(entries).toEqual(["development-logs", "runtime"]);
    } finally {
      await host.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("content-addresses the exact Player-authored identity as a persona-only preset", () => {
    expect(companionPresetId(MIRA)).toMatch(/^player2-mira-[0-9a-f]{12}$/);
    expect(companionPresetId({ ...MIRA, role: "a changed role" })).not.toBe(companionPresetId(MIRA));

    const composition = companionPresetComposition(MIRA);
    expect(composition).toContain("name: '@deepseek-ai/dsh-persona'");
    expect(composition).toContain("You are Mira, the player's candid farm partner.");
    expect(composition).toContain("Hard boundaries: never invent a shared memory");
    expect(composition).not.toContain("dsh-tool-");
  });

  it("materializes once through the DSH roster and rejects a conflicting preset", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-persona-preset-"));
    const presets = new Map<string, { id: string; path: string }>();
    let copies = 0;
    const agentPresets = {
      list: async () => [...presets.values()],
      read: async (id: string) => readFile(presets.get(id)!.path, "utf8"),
      copy: async (_from: string, id: string) => {
        copies++;
        const directory = join(root, id);
        await mkdir(directory, { recursive: true });
        const path = join(directory, "agent.cordis.yml");
        await writeFile(path, "copied\n");
        presets.set(id, { id, path });
      },
      resolve: async (id: string) => presets.get(id)!,
    };
    const ctx = { agentPresets } as unknown as Context;
    try {
      const id = await ensureCompanionPreset(ctx, MIRA);
      expect(copies).toBe(1);
      expect(await readFile(join(root, id, "agent.cordis.yml"), "utf8"))
        .toBe(companionPresetComposition(MIRA));
      expect(await readFile(join(root, id, "preset.yml"), "utf8"))
        .toContain('name: "Mira"');

      await expect(ensureCompanionPreset(ctx, MIRA)).resolves.toBe(id);
      expect(copies).toBe(1);

      await writeFile(join(root, id, "agent.cordis.yml"), "conflict\n");
      await expect(ensureCompanionPreset(ctx, MIRA)).rejects.toThrow("conflicts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
