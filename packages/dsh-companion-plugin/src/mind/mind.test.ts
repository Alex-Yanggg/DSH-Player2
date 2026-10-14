import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Episode, PersonLedger } from "@dsh-player2/contracts";
import { MindCore } from "./core.js";
import { applyLedgerEdits, isIndependent, parseLedgerEdits } from "./dream-ledger.js";
import { EPISODES_PER_SAVE, PersonaLedger, episodeId, forgetLeastImportant } from "./ledger.js";
import { MIND_CONTEXT_LIMIT, MIND_CONTEXT_TAG, isWhyQuestion, mindContextNote } from "./mind-context.js";
import { applyMoodEvent, decayMood, describeMood, restingMood } from "./mood.js";
import { retrieveEpisodes, tokenize } from "./retrieval.js";
import { nominationOf } from "./turn-extras.js";

const NOW = new Date("2026-08-30T08:10:00.000Z");

function episode(id: string, summary: string, extra: Partial<Episode> = {}): Episode {
  return {
    id, at: "2026-08-29T09:00:00.000Z", gameDay: 11, game: "stardew-valley", save: "s1",
    kind: "utterance", summary, salience: 0.5, valence: 0, refs: [`social:${id}`], ...extra,
  };
}

async function session(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "player2-mind-"));
  const dir = join(root, "projects", "mira", "sessions", "save-1");
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("flavor-cue selection (P2-0016)", () => {
  it("tokenizes Chinese into unigrams and bigrams and Latin into words", () => {
    expect(tokenize("钓鱼 Fishing!")).toEqual(["钓", "鱼", "钓鱼", "fishing"]);
  });

  it("puts the overlapping episode first and respects the limit", () => {
    const episodes = [
      episode("ep-000000000001", "我们一起在河边钓鱼，钓到了一条大鲶鱼"),
      episode("ep-000000000002", "the player planted parsnips near the farmhouse"),
      episode("ep-000000000003", "下雨天在屋里聊天"),
    ];
    const ranked = retrieveEpisodes(episodes, { text: "今天去钓鱼吗", gameDay: 12, now: NOW, limit: 2 });
    expect(ranked).toHaveLength(2);
    expect(ranked[0].episode.id).toBe("ep-000000000001");
    expect(ranked[0].relevance).toBeGreaterThan(0);
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
  it("appends idempotently", async () => {
    const dir = await session();
    const { ledger, save } = PersonaLedger.forSession(dir);
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

  it("refuses a damaged person file loudly", async () => {
    const dir = await session();
    const { ledger } = PersonaLedger.forSession(dir);
    await mkdir(ledger.root, { recursive: true });
    await writeFile(join(ledger.root, "person.json"), "{ broken");
    await expect(ledger.person()).rejects.toThrow(/unreadable/);
  });
});

describe("remember nominations (P2-0016)", () => {
  it("accepts one well-formed nomination and clamps its numbers", () => {
    expect(nominationOf({ kind: "correction", summary: "The player prefers being asked first.", salience: 2 }))
      .toEqual({ kind: "correction", summary: "The player prefers being asked first.", salience: 1, valence: 0 });
  });
  it("refuses a malformed or receipt nomination with a reason", () => {
    expect(nominationOf({ kind: "receipt", summary: "x" })).toMatch(/kind/);
    expect(nominationOf({ kind: "milestone", summary: "" })).toMatch(/summary/);
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
  const empty: PersonLedger = { version: "0.1", traits: [] };
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
  it("remembers, records why, answers a why-question, and lets a dream rewrite the story", async () => {
    const dir = await session();
    const core = new MindCore(dir);
    await core.remember({ kind: "shared-event", summary: "We planted parsnips by the pond together.", salience: 0.7, valence: 0.5 }, "stardew-valley", 12, "turn:1", NOW);
    const prepared = await core.prepareTurn("chat", "parsnips 长得怎么样", "stardew-valley", 12, NOW);
    const remembered = prepared.retrieved[0].episode;
    expect(remembered.summary).toContain("parsnips");
    expect(prepared.note).toContain(`[${remembered.id}]`);
    await core.commitTurn("chat", "s:1", "长得很好，多亏我们一起种！", prepared, NOW);

    const why = await core.prepareTurn("chat", "你为什么这么说？", "stardew-valley", 12, NOW);
    expect(why.note).toContain("多亏我们一起种");

    const dream = await core.prepareDream(12);
    expect(dream.digest).toContain("TODAYS_EPISODES(1)");
    expect(dream.game).toBe("stardew-valley");
    const outcome = await core.commitDream({ story: "春天里我们在池塘边种下了防风草。" }, dream, "Mira", NOW);
    expect(outcome?.applied).toContain("story: revision 1");
    expect((await core.ledger.story(core.save))?.text).toBe("春天里我们在池塘边种下了防风草。");
    const exported = await readFile(join(core.ledger.root, "remember.md"), "utf8");
    expect(exported).toContain("Mira 记得什么");
  });

  it("rejects a session path outside the bridge layout", () => {
    expect(() => new MindCore("/tmp/not-a-session")).toThrow(/session directory/);
  });
});
