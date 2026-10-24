/**
 * Dream upgrade (P2-0016): the day-end dream now also tends the Persona
 * Ledger. Its input is the day's episodes (≤40), the current traits, and the
 * current story; its optional `ledger` output rewrites the story, proposes
 * trait changes with episode evidence, and forgets trivia. "No change" stays
 * a normal, common outcome. The model proposes; this module decides.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/dream-ledger
 */
import type { Episode, PersonLedger, Story, Trait } from "@dsh-player2/contracts";
import { ACTIVE_TRAIT_LIMIT, activeCount, clip, traitId } from "./ledger.js";

/** Episodes a dream reads. */
export const DREAM_EPISODE_LIMIT = 40;
const TRAIT_FILE_LIMIT = 64;
const RETIRE_BELOW = 0.15;

/** A dream's proposed ledger edits, shape-checked but not yet validated. */
export interface LedgerEdits {
  readonly story: string | null;
  readonly traits: readonly TraitEdit[];
  readonly forget: readonly string[];
  /** Durable lessons the day taught (P2-0020 T1), as save facts; the code rule promotes (P2-0021). */
  readonly lessons: readonly LessonEdit[];
}

export interface LessonEdit {
  readonly text: string;
  readonly topic: string;
  /** The day showed this approach working in this save. */
  readonly worked?: true;
}

export type TraitEdit =
  | { readonly op: "add"; readonly text: string; readonly scope: string; readonly episodeIds: readonly string[] }
  | { readonly op: "strengthen" | "weaken" | "retire"; readonly id: string; readonly episodeIds: readonly string[] };

/** What happened to each edit, for the trace and the export. */
export interface LedgerEditOutcome {
  readonly person: PersonLedger;
  readonly story: Story | null;
  readonly forget: readonly string[];
  readonly applied: readonly string[];
  readonly rejected: readonly string[];
}

/** The day's episodes a dream reads: this game day first, most salient first. */
export function dreamEpisodes(episodes: readonly Episode[], gameDay: number): Episode[] {
  const today = episodes.filter((episode) => episode.gameDay === gameDay);
  const pool = today.length > 0 ? today : episodes.slice(-DREAM_EPISODE_LIMIT);
  return [...pool].sort((left, right) => right.salience - left.salience || left.at.localeCompare(right.at)).slice(0, DREAM_EPISODE_LIMIT);
}

/** The ledger half of the dream input. */
export function ledgerDigest(episodes: readonly Episode[], traits: readonly Trait[], story: Story | null, memory: readonly string[] = []): string {
  const live = traits.filter((trait) => trait.status !== "retired");
  return [
    `OUR_STORY=${story === null || story.text.trim() === "" ? "(none yet)" : JSON.stringify(story.text)}`,
    `TRAITS(${live.length}):`,
    ...live.map((trait) => `- ${trait.id} [${trait.status}, confidence ${trait.confidence.toFixed(2)}, ${trait.scope}] ${trait.text} (evidence: ${trait.evidence.join(", ")})`),
    `TODAYS_EPISODES(${episodes.length}):`,
    ...episodes.map((episode) => `- ${episode.id} ${episode.kind} salience ${episode.salience.toFixed(2)}: ${episode.summary}`),
    `MEMORY_ALREADY_KEPT(${memory.length}) — never write a lesson that repeats one of these:`,
    ...memory,
  ].join("\n");
}

/** The instruction lines that teach the `dream_commit` arguments. */
export const DREAM_LEDGER_INSTRUCTIONS = [
  'When something is worth keeping, call dream_commit once with {"story":"<=600 chars or null","traits":[...],"forget":["ep-…"],"lessons":[{"text":"...","topic":"...","worked":true?}]}.',
  '- story: rewrite our story so far in your own voice when today changed it; null keeps it. Mention only what the episodes and the existing story support.',
  '- traits: {"op":"add","text":"...","scope":"person","episodeIds":["ep-…","ep-…"]} needs two independent episodes (or one player correction); fewer keeps it as a candidate. {"op":"strengthen"|"weaken"|"retire","id":"tr-…","episodeIds":["ep-…"]} changes an existing trait and needs at least one episode.',
  "- forget: trivial episode ids not worth keeping; receipts are never forgotten.",
  '- lessons: durable facts and policies the day taught about this world, one sentence each. Mark "worked": true only when today really showed the approach working; a lesson that proves out in two different saves joins your library on its own. Nothing new learned: omit the field.',
  "Do not call dream_commit when nothing changed. Every id you write must appear above.",
];

/** Shape-check the raw `ledger` field; anything malformed is dropped whole. */
export function parseLedgerEdits(raw: unknown): LedgerEdits | null {
  if (typeof raw !== "object" || raw === null) return null;
  const ledger = (raw as { ledger?: unknown }).ledger;
  if (typeof ledger !== "object" || ledger === null) return null;
  const value = ledger as { story?: unknown; traits?: unknown; forget?: unknown; lessons?: unknown };
  const story = typeof value.story === "string" && value.story.trim() !== "" ? value.story.trim() : null;
  const traits: TraitEdit[] = [];
  for (const item of Array.isArray(value.traits) ? value.traits : []) {
    const edit = item as { op?: unknown; id?: unknown; text?: unknown; scope?: unknown; episodeIds?: unknown };
    const episodeIds = Array.isArray(edit.episodeIds) ? edit.episodeIds.filter((id): id is string => typeof id === "string") : [];
    if (edit.op === "add" && typeof edit.text === "string" && edit.text.trim() !== "") {
      traits.push({ op: "add", text: edit.text.trim(), scope: typeof edit.scope === "string" ? edit.scope : "person", episodeIds });
    } else if ((edit.op === "strengthen" || edit.op === "weaken" || edit.op === "retire") && typeof edit.id === "string") {
      traits.push({ op: edit.op, id: edit.id, episodeIds });
    }
  }
  const forget = Array.isArray(value.forget) ? value.forget.filter((id): id is string => typeof id === "string") : [];
  const lessons: LessonEdit[] = [];
  for (const item of Array.isArray(value.lessons) ? value.lessons : []) {
    const edit = item as { text?: unknown; topic?: unknown; worked?: unknown };
    if (typeof edit.text === "string" && edit.text.trim() !== "") {
      lessons.push({ text: edit.text, topic: typeof edit.topic === "string" ? edit.topic : "general", ...(edit.worked === true ? { worked: true as const } : {}) });
    }
  }
  return { story, traits, forget, lessons };
}

/**
 * Validate and apply a dream's edits against the ledger it was shown.
 * Evidence must name known episodes; "independent" means two episodes that
 * share no provenance ref. A trait without enough evidence is kept as a
 * candidate so evidence can accumulate over later days.
 */
export function applyLedgerEdits(
  edits: LedgerEdits,
  context: { readonly person: PersonLedger; readonly story: Story | null; readonly shown: readonly Episode[]; readonly known: readonly Episode[]; readonly game: string; readonly now: Date },
): LedgerEditOutcome {
  const known = new Map(context.known.map((episode) => [episode.id, episode]));
  const applied: string[] = [];
  const rejected: string[] = [];
  const stamp = context.now.toISOString();
  let traits = [...context.person.traits];

  for (const edit of edits.traits) {
    const evidence = [...new Set(edit.episodeIds)].filter((id) => known.has(id));
    const unknown = edit.episodeIds.filter((id) => !known.has(id));
    if (unknown.length > 0) { rejected.push(`${describe(edit)}: unknown episode ${unknown.join(", ")}`); continue; }
    if (edit.op === "add") {
      if (edit.scope !== "person" && edit.scope !== `game:${context.game}`) { rejected.push(`${describe(edit)}: scope must be person or game:${context.game}`); continue; }
      if (evidence.length === 0) { rejected.push(`${describe(edit)}: no evidence`); continue; }
      const id = traitId(edit.scope, edit.text);
      const existing = traits.find((trait) => trait.id === id);
      if (existing !== undefined) {
        traits = traits.map((trait) => trait.id === id ? strengthen(trait, evidence, known, stamp) : trait);
        applied.push(`${describe(edit)}: merged into ${id}`);
        continue;
      }
      const independent = isIndependent(evidence.map((id) => known.get(id)!));
      const status = independent && activeCount(traits) < ACTIVE_TRAIT_LIMIT ? "active" : "candidate";
      traits.push({ id, text: clip(edit.text, 160), evidence: evidence.slice(0, 16), confidence: status === "active" ? 0.5 : 0.35, scope: edit.scope, status, createdAt: stamp, updatedAt: stamp });
      applied.push(`${describe(edit)}: ${status} ${id}`);
      continue;
    }
    const target = traits.find((trait) => trait.id === edit.id);
    if (target === undefined || target.status === "retired") { rejected.push(`${describe(edit)}: no such live trait`); continue; }
    if (evidence.length === 0) { rejected.push(`${describe(edit)}: no evidence`); continue; }
    if (edit.op === "strengthen") {
      const next = strengthen(target, evidence, known, stamp);
      if (next.status === "active" && target.status !== "active" && activeCount(traits) >= ACTIVE_TRAIT_LIMIT) {
        traits = traits.map((trait) => trait.id === edit.id ? { ...next, status: "candidate" } : trait);
      } else {
        traits = traits.map((trait) => trait.id === edit.id ? next : trait);
      }
    } else if (edit.op === "weaken") {
      const confidence = round(target.confidence - 0.2);
      traits = traits.map((trait) => trait.id === edit.id ? { ...trait, confidence: Math.max(0, confidence), status: confidence < RETIRE_BELOW ? "retired" : trait.status, evidence: mergeEvidence(trait.evidence, evidence), updatedAt: stamp } : trait);
    } else {
      traits = traits.map((trait) => trait.id === edit.id ? { ...trait, status: "retired", evidence: mergeEvidence(trait.evidence, evidence), updatedAt: stamp } : trait);
    }
    applied.push(describe(edit));
  }
  traits = boundTraits(traits);

  let story = context.story;
  if (edits.story !== null) {
    if (edits.story.length > 600) {
      rejected.push("story: longer than 600 characters");
    } else {
      story = { revision: (context.story?.revision ?? 0) + 1, text: edits.story, basedOnEpisodeIds: context.shown.map((episode) => episode.id).slice(0, 40), updatedAt: stamp };
      applied.push(`story: revision ${story.revision}`);
    }
  }

  const forget: string[] = [];
  for (const id of edits.forget) {
    const episode = known.get(id);
    if (episode === undefined) rejected.push(`forget ${id}: unknown episode`);
    else if (episode.kind === "receipt") rejected.push(`forget ${id}: receipts are never forgotten`);
    else if (traits.some((trait) => trait.status !== "retired" && trait.evidence.includes(id))) rejected.push(`forget ${id}: still evidence for a trait`);
    else forget.push(id);
  }
  if (forget.length > 0) applied.push(`forget: ${forget.length}`);

  return { person: { ...context.person, traits }, story, forget, applied, rejected };
}

/** Two or more episodes with no shared provenance, or one player correction. */
export function isIndependent(episodes: readonly Episode[]): boolean {
  if (episodes.some((episode) => episode.kind === "correction")) return true;
  for (let left = 0; left < episodes.length; left += 1) {
    for (let right = left + 1; right < episodes.length; right += 1) {
      const refs = new Set(episodes[left].refs);
      if (!episodes[right].refs.some((ref) => refs.has(ref))) return true;
    }
  }
  return false;
}

function strengthen(trait: Trait, evidence: readonly string[], known: ReadonlyMap<string, Episode>, stamp: string): Trait {
  const merged = mergeEvidence(trait.evidence, evidence);
  const independent = isIndependent(merged.map((id) => known.get(id)).filter((episode) => episode !== undefined));
  return {
    ...trait,
    evidence: merged,
    confidence: round(Math.min(1, trait.confidence + 0.15)),
    status: trait.status === "candidate" && independent ? "active" : trait.status,
    updatedAt: stamp,
  };
}

function mergeEvidence(current: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...current, ...added])].slice(-16);
}

/** Keep the person file bounded: drop retired first, then weakest candidates. */
function boundTraits(traits: Trait[]): Trait[] {
  if (traits.length <= TRAIT_FILE_LIMIT) return traits;
  const order = (trait: Trait): number => (trait.status === "retired" ? 0 : trait.status === "candidate" ? 1 : 2) * 10 + trait.confidence;
  const keep = new Set([...traits].sort((left, right) => order(right) - order(left)).slice(0, TRAIT_FILE_LIMIT).map((trait) => trait.id));
  return traits.filter((trait) => keep.has(trait.id));
}

function describe(edit: TraitEdit): string {
  return edit.op === "add" ? `add "${clip(edit.text, 40)}"` : `${edit.op} ${edit.id}`;
}

function round(value: number): number { return Math.round(value * 1000) / 1000; }
