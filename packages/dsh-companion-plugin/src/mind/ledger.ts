/**
 * The Persona Ledger file store (P2-0016 W1).
 *
 * One ledger per companion person, beside that person's bridge project:
 *
 * ```text
 * <bridge>/projects/<person>/ledger/
 *   person.json                 traits (cross-save) + migration bookkeeping
 *   remember.md                 player-readable export ("what she remembers")
 *   saves/<save>/episodes.jsonl append-only experience, ≤2,000 per save
 *   saves/<save>/state.json     receipt watermark already ingested
 *   saves/<save>/mood.json      L3 mood scalars
 *   saves/<save>/story.json     the dream-rewritten "our story"
 *   saves/<save>/why.jsonl      which episodes each reply was given
 * ```
 *
 * Every file is local and plain. A damaged line or file is skipped and
 * counted, never a reason to fail a chat turn; a damaged person file is a
 * loud error instead of a silent reset, matching the growth asset's rule.
 * All mutations of one ledger are serialised in-process.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/ledger
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  companionGrowthSchema,
  episodeSchema,
  ledgerVersion,
  moodSchema,
  personLedgerSchema,
  receiptSchema,
  saveLedgerStateSchema,
  storySchema,
  type Episode,
  type EpisodeKind,
  type Mood,
  type PersonLedger,
  type SaveLedgerState,
  type Story,
  type Trait,
} from "@dsh-player2/contracts";
import { applyMoodEvent, decayMood, restingMood, type MoodEvent } from "./mood.js";

/** Episodes kept per save before importance-based forgetting. */
export const EPISODES_PER_SAVE = 2_000;
/** Active traits kept per person. */
export const ACTIVE_TRAIT_LIMIT = 24;
const RECEIPT_NAME = /^receipt-(\d+)\.json$/;
const SAVE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A new experience before the ledger assigns its id. */
export interface EpisodeDraft {
  readonly at: string;
  readonly gameDay: number | null;
  readonly game: string;
  readonly kind: EpisodeKind;
  readonly summary: string;
  readonly salience: number;
  readonly valence: number;
  readonly refs: readonly string[];
}

/** One reply's retrieval record, so "why did you say that" has an answer. */
export interface WhyRecord {
  readonly turnId: string;
  readonly at: string;
  readonly reply: string;
  readonly retrieved: readonly string[];
  readonly cited: readonly string[];
  readonly mood: string;
}

/** Episodes read from one save, with an honest count of damaged lines. */
export interface EpisodeRead {
  readonly episodes: Episode[];
  readonly skipped: number;
}

const locks = new Map<string, Promise<unknown>>();

/** The deterministic id of one experience: same provenance, same id. */
export function episodeId(save: string, kind: EpisodeKind, refs: readonly string[], at: string, summary: string): string {
  const key = refs.length > 0 ? refs.join("|") : `${at}|${summary}`;
  return `ep-${createHash("sha256").update(`${save}|${kind}|${key}`).digest("hex").slice(0, 12)}`;
}

/** The deterministic id of one trait text within a scope. */
export function traitId(scope: string, text: string): string {
  return `tr-${createHash("sha256").update(`${scope}|${text.trim().toLowerCase()}`).digest("hex").slice(0, 12)}`;
}

export class PersonaLedger {
  /** `<bridge>/projects/<person>/ledger` */
  public readonly root: string;

  public constructor(projectDirectory: string) {
    this.root = join(projectDirectory, "ledger");
  }

  /** The ledger and save id of one bridge session directory (`…/projects/<p>/sessions/<save>`). */
  public static forSession(session: string): { ledger: PersonaLedger; save: string } {
    const save = basename(session);
    if (basename(dirname(session)) !== "sessions" || !SAVE_SEGMENT.test(save)) {
      throw new Error(`Not a bridge session directory: ${session}`);
    }
    return { ledger: new PersonaLedger(dirname(dirname(session))), save };
  }

  /** Serialise one mutation of this ledger behind every earlier one. */
  public exclusive<T>(run: () => Promise<T>): Promise<T> {
    const previous = locks.get(this.root) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    const settled = next.catch(() => undefined);
    locks.set(this.root, settled);
    void settled.then(() => { if (locks.get(this.root) === settled) locks.delete(this.root); });
    return next;
  }

  // ---------------------------------------------------------------- episodes

  public async episodes(save: string): Promise<EpisodeRead> {
    let raw: string;
    try {
      raw = await readFile(this.savePath(save, "episodes.jsonl"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { episodes: [], skipped: 0 };
      throw error;
    }
    const episodes: Episode[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const episode = episodeSchema.parse(JSON.parse(line));
        if (seen.has(episode.id)) continue;
        seen.add(episode.id);
        episodes.push(episode);
      } catch {
        skipped += 1;
      }
    }
    return { episodes, skipped };
  }

  /**
   * Append new experiences; a draft whose id already exists is ignored, so
   * re-ingesting the same receipt or retrying the same turn is idempotent.
   * Crossing the per-save bound forgets the least important episodes.
   */
  public appendEpisodes(save: string, drafts: readonly EpisodeDraft[]): Promise<Episode[]> {
    return this.exclusive(() => this.appendUnlocked(save, drafts));
  }

  /** Remove episodes by id (dream forgetting); receipts are fact sources and stay. */
  public forgetEpisodes(save: string, ids: readonly string[]): Promise<string[]> {
    return this.exclusive(async () => {
      const drop = new Set(ids);
      const { episodes } = await this.episodes(save);
      const removed = episodes.filter((episode) => drop.has(episode.id) && episode.kind !== "receipt").map((episode) => episode.id);
      if (removed.length > 0) {
        const gone = new Set(removed);
        await this.writeLines(this.savePath(save, "episodes.jsonl"), episodes.filter((episode) => !gone.has(episode.id)));
      }
      return removed;
    });
  }

  /**
   * Turn every Player-persisted receipt above the watermark into a receipt
   * episode and a mood event. Damaged receipts are skipped and counted; the
   * watermark only advances past receipts that were read.
   */
  public ingestReceipts(session: string, save: string, game: string, gameDay: number | null, now: Date): Promise<{ added: Episode[]; skipped: number }> {
    return this.exclusive(async () => {
      const state = await this.saveState(save);
      const sequences = (await safeReaddir(join(session, "receipts")))
        .map((name) => RECEIPT_NAME.exec(name)).filter((match) => match !== null)
        .map((match) => Number.parseInt(match[1], 10))
        .filter((sequence) => sequence > state.receiptWatermark)
        .sort((left, right) => left - right);
      if (sequences.length === 0) return { added: [], skipped: 0 };
      const drafts: EpisodeDraft[] = [];
      const events: MoodEvent[] = [];
      let skipped = 0;
      let watermark = state.receiptWatermark;
      for (const sequence of sequences) {
        const parsed = receiptSchema.safeParse(await readJson(join(session, "receipts", `receipt-${sequence}.json`)).catch(() => null));
        watermark = sequence;
        if (!parsed.success) { skipped += 1; continue; }
        const receipt = parsed.data;
        drafts.push({
          at: receipt.occurredAt,
          gameDay,
          game,
          kind: "receipt",
          summary: `${receipt.status}: ${receipt.capabilityId}${receipt.autonomy === "full" ? " (on my own)" : ""} — ${receipt.detail}`,
          salience: receipt.status === "completed" ? 0.7 : receipt.status === "failed" ? 0.6 : 0.35,
          valence: receipt.status === "completed" ? 0.5 : receipt.status === "failed" ? -0.4 : -0.1,
          refs: [`receipt:${sequence}`],
        });
        events.push({ kind: "receipt", status: receipt.status });
      }
      const added = await this.appendUnlocked(save, drafts);
      await this.writeJson(this.savePath(save, "state.json"), { version: ledgerVersion, receiptWatermark: watermark } satisfies SaveLedgerState);
      let mood = await this.moodUnlocked(save, now);
      for (const event of events) mood = applyMoodEvent(mood, event, now);
      await this.writeJson(this.savePath(save, "mood.json"), mood);
      return { added, skipped };
    });
  }

  // -------------------------------------------------------------------- mood

  /** The save's mood, decayed to `now` (not persisted until an event lands). */
  public async mood(save: string, now: Date): Promise<Mood> {
    return this.moodUnlocked(save, now);
  }

  public applyMood(save: string, events: readonly MoodEvent[], now: Date): Promise<Mood> {
    return this.exclusive(async () => {
      let mood = await this.moodUnlocked(save, now);
      for (const event of events) mood = applyMoodEvent(mood, event, now);
      await this.writeJson(this.savePath(save, "mood.json"), mood);
      return mood;
    });
  }

  // ------------------------------------------------------------------- story

  public async story(save: string): Promise<Story | null> {
    const raw = await readJson(this.savePath(save, "story.json")).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return undefined;
    });
    if (raw === null || raw === undefined) return null;
    const parsed = storySchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  public writeStory(save: string, story: Story): Promise<void> {
    return this.exclusive(() => this.writeJson(this.savePath(save, "story.json"), storySchema.parse(story)));
  }

  // ------------------------------------------------------------------ person

  /** The person file; absent is empty, damaged is a loud error. */
  public async person(): Promise<PersonLedger> {
    let raw: unknown;
    try {
      raw = await readJson(join(this.root, "person.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: ledgerVersion, traits: [], migratedGrowth: {} };
      throw new Error(`The persona ledger person file is unreadable: ${messageOf(error)}`);
    }
    return personLedgerSchema.parse(raw);
  }

  /** Replace the person file under the ledger lock with `update(current)`. */
  public updatePerson(update: (current: PersonLedger) => PersonLedger | Promise<PersonLedger>): Promise<PersonLedger> {
    return this.exclusive(async () => {
      const next = personLedgerSchema.parse(await update(await this.person()));
      await this.writeJson(join(this.root, "person.json"), next);
      return next;
    });
  }

  /**
   * Migrate the save's applied growth asset into traits once per revision.
   * An insight becomes a trait whose evidence is the receipt episodes it
   * cited; one receipt is not enough independent evidence, so such a trait
   * starts as a candidate and is never injected until a dream backs it.
   */
  public async migrateGrowth(session: string, save: string, now: Date): Promise<number> {
    const raw = await readJson(join(session, "growth", "growth.json")).catch(() => null);
    const growth = companionGrowthSchema.safeParse(raw);
    if (!growth.success) return 0;
    const { episodes } = await this.episodes(save);
    const byReceipt = new Map(episodes.flatMap((episode) => episode.refs.filter((ref) => ref.startsWith("receipt:")).map((ref) => [ref, episode.id] as const)));
    let migrated = 0;
    await this.updatePerson((person) => {
      if ((person.migratedGrowth[save] ?? -1) >= growth.data.revision) return person;
      const traits = [...person.traits];
      for (const insight of growth.data.insights) {
        const evidence = [...new Set(insight.basedOnReceiptSequences.map((sequence) => byReceipt.get(`receipt:${sequence}`)).filter((id) => id !== undefined))];
        if (evidence.length === 0) continue;
        const id = traitId("person", insight.text);
        if (traits.some((trait) => trait.id === id)) continue;
        const stamp = now.toISOString();
        traits.push({ id, text: clip(insight.text, 160), evidence, confidence: 0.5, scope: "person", status: evidence.length >= 2 && activeCount(traits) < ACTIVE_TRAIT_LIMIT ? "active" : "candidate", createdAt: stamp, updatedAt: stamp });
        migrated += 1;
      }
      return { ...person, traits, migratedGrowth: { ...person.migratedGrowth, [save]: growth.data.revision } };
    });
    return migrated;
  }

  // --------------------------------------------------------------------- why

  public async recordWhy(save: string, record: WhyRecord): Promise<void> {
    await this.exclusive(async () => {
      await mkdir(this.saveDirectory(save), { recursive: true });
      const path = this.savePath(save, "why.jsonl");
      const lines = (await readFile(path, "utf8").catch(() => "")).split("\n").filter((line) => line.trim() !== "");
      // Keep the recent tail only: "why" is about the last few replies.
      const kept = lines.slice(-49).flatMap((line) => { try { return [JSON.parse(line) as unknown]; } catch { return []; } });
      await this.writeLines(path, [...kept, record]);
    });
  }

  public async lastWhy(save: string): Promise<WhyRecord | null> {
    const lines = (await readFile(this.savePath(save, "why.jsonl"), "utf8").catch(() => "")).split("\n").filter((line) => line.trim() !== "");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try { return JSON.parse(lines[index]) as WhyRecord; } catch { /* skip a damaged line */ }
    }
    return null;
  }

  // ------------------------------------------------------------------- paths

  public saveDirectory(save: string): string {
    if (!SAVE_SEGMENT.test(save)) throw new Error(`Invalid save id: ${save}`);
    return join(this.root, "saves", save);
  }
  public savePath(save: string, file: string): string { return join(this.saveDirectory(save), file); }
  public async saves(): Promise<string[]> { return (await safeReaddir(join(this.root, "saves"))).filter((save) => SAVE_SEGMENT.test(save)).sort(); }

  /** Atomically replace one ledger file. */
  public async writeJson(path: string, value: unknown): Promise<void> {
    await this.replace(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  public async writeText(path: string, text: string): Promise<void> { await this.replace(path, text); }

  // ---------------------------------------------------------------- internal

  private async appendUnlocked(save: string, drafts: readonly EpisodeDraft[]): Promise<Episode[]> {
    const { episodes } = await this.episodes(save);
    const known = new Set(episodes.map((episode) => episode.id));
    const added: Episode[] = [];
    for (const draft of drafts) {
      const episode = episodeSchema.parse({
        ...draft,
        id: episodeId(save, draft.kind, draft.refs, draft.at, draft.summary),
        save,
        summary: clip(draft.summary, 240),
        salience: clamp(draft.salience, 0, 1),
        valence: clamp(draft.valence, -1, 1),
        refs: [...draft.refs],
      });
      if (known.has(episode.id)) continue;
      known.add(episode.id);
      added.push(episode);
    }
    if (added.length === 0) return added;
    const all = [...episodes, ...added];
    if (all.length > EPISODES_PER_SAVE) {
      await this.writeLines(this.savePath(save, "episodes.jsonl"), forgetLeastImportant(all, EPISODES_PER_SAVE));
    } else {
      await mkdir(this.saveDirectory(save), { recursive: true });
      const handle = await open(this.savePath(save, "episodes.jsonl"), "a");
      try { await handle.writeFile(added.map((episode) => `${JSON.stringify(episode)}\n`).join("")); } finally { await handle.close(); }
    }
    return added;
  }

  private async saveState(save: string): Promise<SaveLedgerState> {
    const parsed = saveLedgerStateSchema.safeParse(await readJson(this.savePath(save, "state.json")).catch(() => null));
    return parsed.success ? parsed.data : { version: ledgerVersion, receiptWatermark: 0 };
  }

  private async moodUnlocked(save: string, now: Date): Promise<Mood> {
    const parsed = moodSchema.safeParse(await readJson(this.savePath(save, "mood.json")).catch(() => null));
    return parsed.success ? decayMood(parsed.data, now) : restingMood(now);
  }

  private async writeLines(path: string, rows: readonly unknown[]): Promise<void> {
    await this.replace(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  }

  private async replace(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    try {
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

/** Keep the `limit` most important episodes, in their original order. */
export function forgetLeastImportant(episodes: readonly Episode[], limit: number): Episode[] {
  if (episodes.length <= limit) return [...episodes];
  const newest = Math.max(...episodes.map((episode) => Date.parse(episode.at)));
  const importance = (episode: Episode): number => {
    const ageDays = (newest - Date.parse(episode.at)) / 86_400_000;
    const kindBonus = episode.kind === "milestone" || episode.kind === "correction" ? 0.3 : episode.kind === "receipt" ? 0.1 : 0;
    return episode.salience + kindBonus + 0.5 * 0.5 ** (ageDays / 30);
  };
  const keep = new Set([...episodes].sort((left, right) => importance(right) - importance(left)).slice(0, limit).map((episode) => episode.id));
  return episodes.filter((episode) => keep.has(episode.id));
}

/** Count of active traits. */
export function activeCount(traits: readonly Trait[]): number {
  return traits.filter((trait) => trait.status === "active").length;
}

export function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

async function readJson(path: string): Promise<unknown> {
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    if (stats.size > 1024 * 1024) throw new Error(`${path} exceeds 1 MiB`);
    return JSON.parse(await handle.readFile({ encoding: "utf8" })) as unknown;
  } finally { await handle.close(); }
}

async function safeReaddir(path: string): Promise<string[]> {
  try { return await readdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
