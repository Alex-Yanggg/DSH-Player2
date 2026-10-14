import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { CompanionIdentity } from "@dsh-player2/contracts";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { SpineEvent } from "@dsh-player2/dsh-companion-plugin";
import { persistenceSpineStore } from "./dream.js";
import {
  companionPresetDefinition,
  companionPresetId,
  Config,
  ensureCompanionPreset,
  inject,
  LaneTranscript,
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
  it("services newly arrived social turns while a decision stays busy, without duplicate execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-independent-lanes-"));
    const session = join(root, "projects", "mira", "sessions", "1");
    await mkdir(join(session, "inbox"), { recursive: true });
    await writeFile(join(session, "inbox", "turn-1.json"), "{}");
    let release!: () => void;
    const busy = new Promise<void>((resolve) => { release = resolve; });
    const host = new Player2DshHost({} as Context, { bridgeDirectory: root, pollIntervalMs: 50 });
    const internals = host as unknown as { runDecision(session: string, id: number): Promise<void>; runSocial(session: string, id: string): Promise<void> };
    const decisions = vi.spyOn(internals, "runDecision").mockImplementation(async () => busy);
    const social = vi.spyOn(internals, "runSocial").mockImplementation(async (directory, id) => {
      await mkdir(join(directory, "social-outbox"), { recursive: true });
      await writeFile(join(directory, "social-outbox", `result-${id}.json`), "{}");
    });
    try {
      await host.start();
      await vi.waitFor(() => expect(decisions).toHaveBeenCalledTimes(1));
      await mkdir(join(session, "social-inbox"), { recursive: true });
      await writeFile(join(session, "social-inbox", "turn-12345678-abcd.json"), "{}");
      await vi.waitFor(() => expect(social).toHaveBeenCalledTimes(1));
      expect(decisions).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await host.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("traces a day-start turn's pickup under the day-start lane, not the chat lane", async () => {
    const root = await mkdtemp(join(tmpdir(), "player2-day-start-lane-"));
    const session = join(root, "projects", "mira", "sessions", "1");
    const fixture = JSON.parse(await readFile(new URL("../../../fixtures/social-turn/stardew-social-memory.json", import.meta.url), "utf8")) as { id: string };
    await mkdir(join(session, "social-inbox"), { recursive: true });
    await mkdir(join(root, "development-logs"), { recursive: true });
    await writeFile(join(session, "social-inbox", `turn-${fixture.id}.json`), JSON.stringify({ ...fixture, occasion: "day-start" }));
    const host = new Player2DshHost({} as Context, { bridgeDirectory: root });
    const internals = host as unknown as { runSocial(session: string, id: string): Promise<void>; socialAgent(): Promise<never> };
    vi.spyOn(internals, "socialAgent").mockRejectedValue(new Error("no agent in this test"));
    try {
      await internals.runSocial(session, fixture.id);
      const lines = (await readFile(join(root, "development-logs", "latency-host.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { lane: string; stage: string });
      expect(lines.map(({ lane, stage }) => `${lane}/${stage}`)).toEqual(["day-start/host-picked", "day-start/failed"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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

    const definition = companionPresetDefinition(MIRA);
    expect(definition.id).toBe(companionPresetId(MIRA));
    expect(definition.name).toBe("Mira");
    expect(definition.plugins).toHaveLength(1);
    const [persona] = definition.plugins;
    expect(persona?.name).toBe("@deepseek-ai/dsh-persona");
    const prefix = (persona?.config as { prefix: string }).prefix;
    expect(prefix).toContain("You are Mira, the player's candid farm partner.");
    expect(prefix).toContain("Hard boundaries: never invent a shared memory");
    expect(JSON.stringify(definition)).not.toContain("dsh-tool-");
  });

  it("declares once through the DSH preset registry and retires on dispose", async () => {
    const declared = new Map<string, { id: string; broken?: string }>();
    const register = vi.fn(async (definition: { id: string }) => {
      declared.set(definition.id, { id: definition.id });
      return async () => { declared.delete(definition.id); };
    });
    const ctx = { agentPresets: {
      list: async () => [...declared.values()],
      register,
      resolve: async (id: string) => declared.get(id)!,
    } } as unknown as Context;

    const registration = await ensureCompanionPreset(ctx, MIRA);
    expect(registration.id).toBe(companionPresetId(MIRA));
    expect(register).toHaveBeenCalledWith(companionPresetDefinition(MIRA));

    // A second declaration of the same content-addressed id is refused rather
    // than letting a stranger's composition wear this person's identity.
    await expect(ensureCompanionPreset(ctx, MIRA)).rejects.toThrow("already declared");
    expect(register).toHaveBeenCalledTimes(1);

    await registration.dispose();
    expect(declared.size).toBe(0);
  });

  it("retires a preset whose persona composition fails to activate", async () => {
    const declared = new Map<string, { id: string; broken?: string }>();
    const ctx = { agentPresets: {
      list: async () => [...declared.values()],
      register: async (definition: { id: string }) => {
        declared.set(definition.id, { id: definition.id, broken: "missing service systemPrompt" });
        return async () => { declared.delete(definition.id); };
      },
      resolve: async (id: string) => declared.get(id)!,
    } } as unknown as Context;

    await expect(ensureCompanionPreset(ctx, MIRA)).rejects.toThrow("failed to activate: missing service systemPrompt");
    expect(declared.size).toBe(0);
  });

  it("collects exactly one armed turn from the session event feed", () => {
    const transcript = new LaneTranscript();
    const event = (seq: number, type: string) => ({ seq, type, data: {} }) as unknown as SessionEvent;
    transcript.record(event(0, "turn/start"));
    transcript.begin();
    transcript.record(event(1, "assistant/message"));
    transcript.record(event(2, "turn/end"));
    expect(transcript.take().map((item) => item.seq)).toEqual([1, 2]);
    transcript.record(event(3, "turn/start"));
    expect(transcript.take()).toEqual([]);
  });
});

describe("persistence spine store", () => {
  function fakePersistence() {
    const logs = new Map<string, SessionEvent[]>();
    const calls: string[] = [];
    const handle = (id: string) => ({
      read: async (offset = 0) => ({ eventState: "detached", events: (logs.get(id) ?? []).slice(offset) }),
      append: async (events: SessionEvent[]) => {
        const log = logs.get(id)!;
        if (events[0]?.seq !== log.length) throw new Error("not contiguous");
        log.push(...events);
      },
      flush: async () => { calls.push(`flush:${id}`); },
      close: async () => { calls.push(`close:${id}`); },
    });
    const sessionPersistence = {
      stat: async (id: string) => (logs.has(id) ? { header: { id } } : undefined),
      create: async (header: { id: string; isSeeded: boolean }) => {
        calls.push(`create:${header.id}:${String(header.isSeeded)}`);
        logs.set(header.id, []);
        return handle(header.id);
      },
      open: async (id: string, access: string) => { calls.push(`open:${id}:${access}`); return handle(id); },
    };
    return { ctx: { sessionPersistence } as unknown as Context, logs, calls };
  }

  it("creates a missing spine once, then reads and durably appends through its write handle", async () => {
    const { ctx, logs, calls } = fakePersistence();
    const store = persistenceSpineStore(ctx);
    await store.open("spine-a");
    await store.open("spine-a");
    expect(calls).toEqual(["create:spine-a:false"]);

    const receipt = { type: "companion/receipt-observed", seq: 0, time: 1, ignorable: true, data: {
      sequence: 4, proposalId: "p", capabilityId: "mark-target", status: "completed", occurredAt: "2026-10-13T00:00:00.000Z",
    } } as unknown as SpineEvent;
    await store.append("spine-a", [receipt]);
    expect(calls).toContain("flush:spine-a");
    logs.get("spine-a")!.push({ type: "turn/start", seq: 1, time: 2, data: {} } as unknown as SessionEvent);
    expect((await store.readFrom("spine-a", 0)).map((event) => event.type)).toEqual(["companion/receipt-observed"]);

    await store.close();
    expect(calls).toContain("close:spine-a");
  });

  it("reopens an existing spine for write instead of recreating it", async () => {
    const { ctx, logs, calls } = fakePersistence();
    logs.set("spine-b", []);
    const store = persistenceSpineStore(ctx);
    await store.readFrom("spine-b", 0);
    expect(calls).toEqual(["open:spine-b:write"]);
    await store.close();
  });
});
