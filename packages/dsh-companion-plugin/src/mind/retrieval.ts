/**
 * Flavor cues for the Mind Core (P2-0016). This is deliberately thin: real
 * memory search belongs to DSH, so Player2 only picks a handful of recent,
 * salient episodes and nudges the ones that share words with the turn. It is
 * one replaceable function ({@link EpisodeSelector}); a DSH-provided recall
 * can take its place without touching the ledger or the lanes.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/retrieval
 */
import type { Episode } from "@dsh-player2/contracts";

const CJK = /[㐀-鿿豈-﫿]/u;
/** Recency half-life, in game days (or wall-clock days when no game day is known). */
const RECENCY_HALF_LIFE_DAYS = 14;

/** Splits text into overlap terms: Latin words, CJK unigrams and bigrams. */
export function tokenize(text: string): string[] {
  const terms: string[] = [];
  for (const run of text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u)) {
    let latin = "";
    let previousCjk = "";
    for (const character of run) {
      if (CJK.test(character)) {
        if (latin.length >= 2) terms.push(latin);
        latin = "";
        terms.push(character);
        if (previousCjk !== "") terms.push(previousCjk + character);
        previousCjk = character;
      } else {
        previousCjk = "";
        latin += character;
      }
    }
    if (latin.length >= 2) terms.push(latin);
  }
  return terms;
}

/** One picked episode and how much it overlapped the turn, for "why did you say that". */
export interface RetrievedEpisode {
  readonly episode: Episode;
  readonly score: number;
  readonly relevance: number;
}

export interface RetrievalQuery {
  readonly text: string;
  /** The current game day; recency is measured from it when episodes carry one. */
  readonly gameDay: number | null;
  readonly now: Date;
  readonly limit?: number;
}

/** The seam a richer (DSH-side) recall can replace. */
export type EpisodeSelector = (episodes: readonly Episode[], query: RetrievalQuery) => RetrievedEpisode[];

/**
 * Default selector: `salience × recency × (1 + overlap)`, where overlap is
 * the share of the turn's terms found in the summary. Ties keep the newer
 * episode first, so results are deterministic for a fixed ledger.
 */
export const retrieveEpisodes: EpisodeSelector = (episodes, query) => {
  const limit = query.limit ?? 3;
  if (episodes.length === 0 || limit <= 0) return [];
  const queryTerms = [...new Set(tokenize(query.text))];
  const ranked = episodes.map((episode) => {
    const terms = new Set(tokenize(episode.summary));
    const relevance = queryTerms.length === 0 ? 0 : queryTerms.filter((term) => terms.has(term)).length / queryTerms.length;
    return { episode, relevance, score: (0.2 + episode.salience) * recencyOf(episode, query) * (1 + 2 * relevance) };
  });
  ranked.sort((left, right) => right.score - left.score || right.episode.at.localeCompare(left.episode.at));
  return ranked.slice(0, limit);
};

function recencyOf(episode: Episode, query: RetrievalQuery): number {
  const ageDays = episode.gameDay !== null && query.gameDay !== null
    ? Math.max(0, query.gameDay - episode.gameDay)
    : Math.max(0, (query.now.getTime() - Date.parse(episode.at)) / 86_400_000);
  return 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}
