import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dreamRequestSchema, socialBridgeTurnSchema, type Episode, type PersonLedger, type SocialBridgeTurn } from "@dsh-player2/contracts";
import { MindCore } from "./core.js";
import { applyLedgerEdits, isIndependent, parseLedgerEdits } from "./dream-ledger.js";
import { EPISODES_PER_SAVE, PersonaLedger, episodeId, forgetLeastImportant } from "./ledger.js";
import { MIND_CONTEXT_LIMIT, MIND_CONTEXT_TAG, isWhyQuestion, mindContextNote } from "./mind-context.js";
import { applyMoodEvent, decayMood, describeMood, restingMood } from "./mood.js";
import { retrieveEpisodes, tokenize } from "./retrieval.js";
import { socialTurnExtras } from "./turn-extras.js";

const NOW = new Date("2026-08-30T08:10:00.000Z");

const golden = (): SocialBridgeTurn => socialBridgeTurnSchema.parse(
  JSON.parse(readFileSync(new URL("../../../../fixtures/social-turn/stardew-social-memory.json", import.meta.url), "utf8")),
);

function episode(id: string, summary: string, extra: Partial<Episode> = {}): Episode {
  return {
    id, at: "2026-08-29T09:00:00.000Z", gameDay: 11, game: "stardew-valley", save: "s1",
    kind: "utterance", summary, salience: 0.5, valence: 0, refs: [`social:${id}`], ...extra,
  };
}

async function session(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "player2-mind-"));
  const dir = join(root, "projects", "mira", "sessions", "save-1");
  await mkdir(join(dir, "receipts"), { recursive: true });
  return dir;
}

async function receipt(dir: string, sequence: number, status: string, detail: string): Promise<void> {
  await writeFile(join(dir, "receipts", `receipt-${sequence}.json`), JSON.stringify({
    proposalId: `proposal-${sequence}`, capabilityId: "visual-receipt", status,
    occurredAt: "2026-08-29T09:00:00.000Z", target: "tile 12, 8", scope: "visual marker + sound only", detail,
  }));
}

describe("retrieval (P2-0016)", () => {
  it("tokenizes Chinese into unigrams and bigrams and Latin into words", () => {
    expect(tokenize("钓鱼 Fishing!")).toEqual(["钓", "鱼", "钓鱼", "fishing"]);
  });

  it("ranks the relevant episode first and respects the limit", () => {
    const episodes = [
      episode("ep-000000000001", "我们一起在河边钓鱼，钓到了一条大鲶鱼"),
      episode("ep-000000000002", "the player planted parsnips near the farmhouse"),
      episode("ep-000000000003", "下雨天在屋里聊天"),
    ];
    const ranked = retrieveEpisodes(episodes, { text: "今天去钓鱼吗", gameDay: 12, now: NOW, limit: 2 });
    expect(ranked).toHaveLength(2);
    expect(ranked[0].episode.id).toBe("ep-000000000001");
    expect(ranked[0].relevance).toBe(1);
  });

  it("lets a salient recent episode surface without a keyword hit", () => {
    const episodes = [episode("ep-000000000001", "old trivia", { gameDay: 1, salience: 0.1 }), episode("ep-000000000002", "first harvest together", { gameDay: 11, salience: 0.9 })];
    expect(retrieveEpisodes(episodes, { text: "hello", gameDay: 12, now: NOW })[0].episode.id).toBe("ep-000000000002");
  });
});

describe("mood (P2-0016)", () => {
  it("moves on events, decays toward rest, and resets energy at day start", () => {
    const rest = restingMood(NOW);
    const happy = applyMoodEvent(rest, { kind: "receipt", status: "completed" }, NOW);
    expect(happy.valence).toBeGreaterThan(rest.valence);
    const later = decayMood(happy, new Date(NOW.getTime() + 6 * 3_600_000));
    expect(later.valence).toBeLessThan(happy.valence);
    expect(later.valence).toBeGreaterThan(rest.valence - 1e-9);
    const morning = applyMoodEvent({ ...rest, energy: 0.1 }, { kind: "day-start" }, NOW);
    expect(morning.energy).toBe(0.85);
    expect(describeMood(morning)).toContain("well rested");
  });

  it("is deterministic and bounded", () => {
    let mood = restingMood(NOW);
    for (let index = 0; index < 50; index += 1) mood = applyMoodEvent(mood, { kind: "receipt", status: "completed" }, NOW);
    expect(mood.valence).toBeLessThanOrEqual(1);
    expect(mood.arousal).toBeLessThanOrEqual(1);
    expect(applyMoodEvent(restingMood(NOW), { kind: "chat" }, NOW)).toEqual(applyMoodEvent(restingMood(NOW), { kind: "chat" }, NOW));
  });
});

describe("persona ledger files (P2-0016)", () => {
  it("appends idempotently and ingests receipts once, skipping damaged ones", async () => {
    const dir = await session();
    await receipt(dir, 1, "completed", "A marker was shown near the parsnips.");
    await writeFile(join(dir, "receipts", "receipt-2.json"), "{ damaged");
    await receipt(dir, 3, "failed", "The path to the pond was blocked.");
    const { ledger, save } = PersonaLedger.forSession(dir);
    const first = await ledger.ingestReceipts(dir, save, "stardew-valley", 11, NOW);
    expect(first.added.map((item) => item.refs[0])).toEqual(["receipt:1", "receipt:3"]);
    expect(first.skipped).toBe(1);
    const again = await ledger.ingestReceipts(dir, save, "stardew-valley", 11, NOW);
    expect(again.added).toHaveLength(0);
    expect((await ledger.episodes(save)).episodes).toHaveLength(2);
    expect((await ledger.mood(save, NOW)).arousal).toBeGreaterThan(restingMood(NOW).arousal);

    const draft = { at: NOW.toISOString(), gameDay: 12, game: "stardew-valley", kind: "utterance" as const, summary: "liked the rain", salience: 0.4, valence: 0.2, refs: ["social:x"] };
    expect(await ledger.appendEpisodes(save, [draft])).toHaveLength(1);
    expect(await ledger.appendEpisodes(save, [draft])).toHaveLength(0);
    expect(episodeId(save, "utterance", ["social:x"], "", "")).toMatch(/^ep-[0-9a-f]{12}$/);
  });

  it("skips a damaged episode line instead of failing", async () => {
    const dir = await session();
    const { ledger, save } = PersonaLedger.forSession(dir);
    await ledger.appendEpisodes(save, [{ at: NOW.toISOString(), gameDay: 12, game: "g", kind: "milestone", summary: "first day", salience: 1, valence: 1, refs: ["m:1"] }]);
    await writeFile(ledger.savePath(save, "episodes.jsonl"), `${await readFile(ledger.savePath(save, "episodes.jsonl"), "utf8")}not json\n`);
    const read = await ledger.episodes(save);
    expect(read.episodes).toHaveLength(1);
    expect(read.skipped).toBe(1);
  });

  it("forgets the least important episodes past the per-save bound", () => {
    const many = Array.from({ length: EPISODES_PER_SAVE + 5 }, (_, index) => episode(`ep-${index.toString(16).padStart(12, "0")}`, `e${index}`, { salience: index < 5 ? 0 : 0.5 }));
    const kept = forgetLeastImportant(many, EPISODES_PER_SAVE);
    expect(kept).toHaveLength(EPISODES_PER_SAVE);
    expect(kept.some((item) => item.summary === "e0")).toBe(false);
  });

  it("migrates the growth asset into traits once, as candidates without two receipts", async () => {
    const dir = await session();
    await receipt(dir, 3, "completed", "A marker was shown near the parsnips.");
    await mkdir(join(dir, "growth"), { recursive: true });
    await writeFile(join(dir, "growth", "growth.json"), JSON.stringify(golden().growth));
    const { ledger, save } = PersonaLedger.forSession(dir);
    await ledger.ingestReceipts(dir, save, "stardew-valley", 11, NOW);
    expect(await ledger.migrateGrowth(dir, save, NOW)).toBe(1);
    expect(await ledger.migrateGrowth(dir, save, NOW)).toBe(0);
    const person = await ledger.person();
    expect(person.traits[0].status).toBe("candidate");
    expect(person.migratedGrowth[save]).toBe(7);
  });

  it("refuses a damaged person file loudly", async () => {
    const dir = await session();
    const { ledger } = PersonaLedger.forSession(dir);
    await mkdir(ledger.root, { recursive: true });
    await writeFile(join(ledger.root, "person.json"), "{ broken");
    await expect(ledger.person()).rejects.toThrow(/unreadable/);
  });
});

describe("social turn extras (P2-0016)", () => {
  const citable = new Set(["ep-000000000001"]);
  it("accepts given citations and one well-formed nomination", () => {
    const extras = socialTurnExtras({ episodeIds: ["ep-000000000001"], remember: { kind: "correction", summary: "The player prefers being asked first.", salience: 2 } }, citable);
    expect(extras.cited).toEqual(["ep-000000000001"]);
    expect(extras.nomination).toEqual({ kind: "correction", summary: "The player prefers being asked first.", salience: 1, valence: 0 });
  });
  it("fails a turn that cites an episode it was not given", () => {
    expect(() => socialTurnExtras({ episodeIds: ["ep-ffffffffffff"] }, citable)).toThrow(/not given/);
  });
  it("drops a malformed or receipt nomination without failing", () => {
    expect(socialTurnExtras({ remember: { kind: "receipt", summary: "x" } }, citable).droppedNomination).toMatch(/kind/);
    expect(socialTurnExtras({}, citable)).toEqual({ cited: [], nomination: null, droppedNomination: null });
  });
});

describe("MindContext note (P2-0016)", () => {
  it("renders mood, episodes, story, and active in-scope traits within the limit", () => {
    const note = mindContextNote({
      game: "stardew-valley",
      mood: restingMood(NOW),
      story: { revision: 1, text: "We met in spring.", basedOnEpisodeIds: [], updatedAt: NOW.toISOString() },
      traits: [
        { id: "tr-000000000001", text: "asks before adventures", evidence: ["a"], confidence: 0.6, scope: "person", status: "active", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
        { id: "tr-000000000002", text: "hidden candidate", evidence: ["a"], confidence: 0.9, scope: "person", status: "candidate", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
        { id: "tr-000000000003", text: "minecraft only", evidence: ["a"], confidence: 0.9, scope: "game:minecraft", status: "active", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
      ],
      retrieved: [{ episode: episode("ep-000000000001", "x".repeat(400)), score: 1, relevance: 1 }],
    });
    expect(note.startsWith(MIND_CONTEXT_TAG)).toBe(true);
    expect(note).toContain("[ep-000000000001]");
    expect(note).toContain("We met in spring.");
    expect(note).toContain("asks before adventures");
    expect(note).not.toContain("hidden candidate");
    expect(note).not.toContain("minecraft only");
    expect(note.length).toBeLessThanOrEqual(MIND_CONTEXT_LIMIT);
  });
  it("recognises why-questions in Chinese and English", () => {
    expect(isWhyQuestion("你为什么这么说？")).toBe(true);
    expect(isWhyQuestion("Why did you say that")).toBe(true);
    expect(isWhyQuestion("今天天气不错")).toBe(false);
  });
});

describe("dream ledger edits (P2-0016)", () => {
  const known = [
    episode("ep-000000000001", "asked before fishing", { refs: ["social:a"] }),
    episode("ep-000000000002", "asked before the mines", { refs: ["social:b"] }),
    episode("ep-000000000003", "same turn echo", { refs: ["social:a"] }),
    episode("ep-000000000004", "marker shown", { kind: "receipt", refs: ["receipt:1"] }),
  ];
  const empty: PersonLedger = { version: "0.1", traits: [], migratedGrowth: {} };
  const apply = (raw: unknown, person: PersonLedger = empty) => applyLedgerEdits(parseLedgerEdits(raw)!, { person, story: null, shown: known, known, game: "stardew-valley", now: NOW });

  it("activates a trait with two independent episodes and keeps a single-source one as a candidate", () => {
    const outcome = apply({ ledger: { traits: [
      { op: "add", text: "Asks before an adventure", episodeIds: ["ep-000000000001", "ep-000000000002"] },
      { op: "add", text: "Echoes itself", episodeIds: ["ep-000000000001", "ep-000000000003"] },
    ] } });
    expect(outcome.person.traits.map((trait) => trait.status)).toEqual(["active", "candidate"]);
    expect(isIndependent([known[0], known[2]])).toBe(false);
  });

  it("promotes a candidate once independent evidence accumulates, and retires a weakened trait", () => {
    const first = apply({ ledger: { traits: [{ op: "add", text: "Likes rain", episodeIds: ["ep-000000000001"] }] } });
    const id = first.person.traits[0].id;
    expect(first.person.traits[0].status).toBe("candidate");
    const second = apply({ ledger: { traits: [{ op: "strengthen", id, episodeIds: ["ep-000000000002"] }] } }, first.person);
    expect(second.person.traits[0].status).toBe("active");
    let person = second.person;
    for (let index = 0; index < 4; index += 1) person = apply({ ledger: { traits: [{ op: "weaken", id, episodeIds: ["ep-000000000002"] }] } }, person).person;
    expect(person.traits[0].status).toBe("retired");
  });

  it("rejects unknown evidence, forgetting receipts, and an oversize story; applies a valid story", () => {
    const outcome = apply({ ledger: {
      story: "我们在春天认识。",
      traits: [{ op: "add", text: "Invented", episodeIds: ["ep-ffffffffffff"] }],
      forget: ["ep-000000000004", "ep-000000000003"],
    } });
    expect(outcome.person.traits).toHaveLength(0);
    expect(outcome.story?.text).toBe("我们在春天认识。");
    expect(outcome.forget).toEqual(["ep-000000000003"]);
    expect(outcome.rejected.join("\n")).toMatch(/unknown episode[\s\S]*receipts are never forgotten/);
    expect(apply({ ledger: { story: "长".repeat(601) } }).rejected).toContain("story: longer than 600 characters");
  });

  it("treats a missing ledger field as no change", () => {
    expect(parseLedgerEdits({ kind: "no-change" })).toBeNull();
  });
});

describe("Mind Core end to end (P2-0016)", () => {
  it("retrieves, records why, answers a why-question, and lets a dream rewrite the story", async () => {
    const dir = await session();
    await receipt(dir, 3, "completed", "A temporary marker was shown near the parsnips.");
    const core = new MindCore(dir);
    const turn = golden();
    const prepared = await core.prepareSocial({ ...turn, message: { ...turn.message, content: "parsnips 的标记有用吗" } }, NOW);
    const receiptEpisode = prepared.retrieved[0].episode;
    expect(receiptEpisode.kind).toBe("receipt");
    expect(prepared.note).toContain(`[${receiptEpisode.id}]`);
    expect(prepared.citable.has(receiptEpisode.id)).toBe(true);

    const extras = socialTurnExtras({ episodeIds: [receiptEpisode.id], remember: { kind: "shared-event", summary: "We agreed the parsnip marker helped.", salience: 0.6, valence: 0.5 } }, prepared.citable);
    await core.commitSocial(turn, extras, "那个标记很管用！", prepared, NOW);
    expect((await core.ledger.episodes(core.save)).episodes).toHaveLength(2);

    const why = await core.prepareSocial({ ...turn, id: "6b0f3c2e-7a41-4d8e-9c55-0d6f1e2a3b4c", message: { ...turn.message, content: "你为什么这么说？" } }, NOW);
    expect(why.note).toContain("那个标记很管用");
    expect(why.citable.has(receiptEpisode.id)).toBe(true);

    const request = dreamRequestSchema.parse({ version: "0.1.1", sequence: 9, createdAt: NOW.toISOString(), gameDay: 12, companion: turn.companion });
    const dream = await core.prepareDream(request, NOW);
    expect(dream.digest).toContain("TODAYS_EPISODES(");
    expect(dream.game).toBe("stardew-valley");
    const outcome = await core.commitDream(request, { kind: "no-change", ledger: { story: "春天里我们靠一个小标记找到了节奏。" } }, dream, NOW);
    expect(outcome?.applied).toContain("story: revision 1");
    expect((await core.ledger.story(core.save))?.text).toBe("春天里我们靠一个小标记找到了节奏。");
    const exported = await readFile(join(core.ledger.root, "remember.md"), "utf8");
    expect(exported).toContain("Mira 记得什么");
    expect(exported).toContain("春天里我们靠一个小标记找到了节奏。");
  });

  it("rejects a session path outside the bridge layout", () => {
    expect(() => new MindCore("/tmp/not-a-session")).toThrow(/session directory/);
  });
});
