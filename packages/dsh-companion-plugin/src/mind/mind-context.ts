/**
 * MindContext (P2-0016): the one bounded note through which every lane
 * speaks from the same mind. The stable soul stays in the persona preset;
 * this note carries the semi-stable layer (our story, top traits) and the
 * per-turn layer (mood, retrieved episodes), always as history and never as
 * current world evidence.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/mind-context
 */
import type { Episode, Mood, Story, Trait } from "@dsh-player2/contracts";
import { describeMood } from "./mood.js";
import type { RetrievedEpisode } from "./retrieval.js";
import type { WhyRecord } from "./ledger.js";

/** Marker prefix of the note; the lane policies tell the model how to read it. */
export const MIND_CONTEXT_TAG = "MIND_CONTEXT";
/** Upper bound of one MindContext note. */
export const MIND_CONTEXT_LIMIT = 1_400;
/** Traits shown per turn. */
const TRAITS_SHOWN = 5;

export interface MindContextInput {
  readonly game: string;
  readonly mood: Mood;
  readonly story: Story | null;
  readonly traits: readonly Trait[];
  readonly retrieved: readonly RetrievedEpisode[];
  /** Present when the player asks why the previous reply was said. */
  readonly why?: { readonly record: WhyRecord; readonly episodes: readonly Episode[] } | null;
}

/** Traits a lane may inject for one game: active, in scope, most confident first. */
export function traitsInScope(traits: readonly Trait[], game: string): Trait[] {
  return traits
    .filter((trait) => trait.status === "active" && (trait.scope === "person" || trait.scope === `game:${game}`))
    .sort((left, right) => right.confidence - left.confidence || left.createdAt.localeCompare(right.createdAt));
}

/**
 * Render the note. Lines are added in priority order (why → mood → episodes
 * → story → traits) and dropped whole once the next would cross the limit,
 * so a fact is never cut mid-line. Returns "" only when there is nothing.
 */
export function mindContextNote(input: MindContextInput, limit: number = MIND_CONTEXT_LIMIT): string {
  const lines: string[] = [];
  if (input.why) {
    lines.push(`- the player asks why you said: "${clip(input.why.record.reply, 160)}". That reply was given these memories; explain honestly from them, and say so if none applied:`);
    for (const episode of input.why.episodes) lines.push(episodeLine(episode));
    if (input.why.episodes.length === 0) lines.push("  (no remembered episode was in front of you then)");
  }
  lines.push(`- mood: ${describeMood(input.mood)} (let it colour tone only)`);
  const shown = new Set((input.why?.episodes ?? []).map((episode) => episode.id));
  for (const item of input.retrieved) {
    if (shown.has(item.episode.id)) continue;
    lines.push(episodeLine(item.episode));
  }
  if (input.story !== null && input.story.text.trim() !== "") lines.push(`- our story so far: ${clip(input.story.text, 600)}`);
  const traits = traitsInScope(input.traits, input.game).slice(0, TRAITS_SHOWN);
  if (traits.length > 0) lines.push(`- tendencies you have shown: ${traits.map((trait) => clip(trait.text, 120)).join("; ")}`);
  const header = `${MIND_CONTEXT_TAG} (your own memory: history, never current facts):`;
  let note = header;
  for (const line of lines) {
    if (note.length + 1 + line.length > limit) continue;
    note = `${note}\n${line}`;
  }
  return note === header ? "" : note;
}

/** Whether a player message asks the companion to explain its last reply. */
export function isWhyQuestion(text: string): boolean {
  return /为什么这么说|为啥这么说|为什么这样说|为什么会这么说|怎么知道的|你怎么知道|why did you say|why do you say|how do you know/i.test(text);
}

function episodeLine(episode: Episode): string {
  const day = episode.gameDay === null ? "" : `day ${episode.gameDay}, `;
  return `- [${episode.id}] ${day}${episode.kind}: ${clip(episode.summary, 180)}`;
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
