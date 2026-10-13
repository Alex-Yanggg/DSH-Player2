/**
 * Episode retrieval for the Mind Core (P2-0016). The first version is
 * deliberately vector-free: BM25 over episode summaries, weighted by
 * recency and salience. Chinese text has no spaces, so CJK runs contribute
 * single characters and bigrams; Latin runs contribute lowercase words.
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/retrieval
 */
import type { Episode } from "@dsh-player2/contracts";

const CJK = /[㐀-鿿豈-﫿]/u;
const K1 = 1.2;
const B = 0.75;
/** Relevance floor so a salient, recent episode can still surface without a keyword hit. */
const RELEVANCE_FLOOR = 0.15;
/** Recency half-life, in game days (or wall-clock days when no game day is known). */
const RECENCY_HALF_LIFE_DAYS = 14;

/** Splits text into retrieval terms: Latin words, CJK unigrams and bigrams. */
export function tokenize(text: string): string[] {
  const terms: string[] = [];
  for (const run of text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u)) {
    if (run === "") continue;
    let latin = "";
    let previousCjk = "";
    const flushLatin = (): void => {
      if (latin.length >= 2) terms.push(latin);
      latin = "";
    };
    for (const character of run) {
      if (CJK.test(character)) {
        flushLatin();
        terms.push(character);
        if (previousCjk !== "") terms.push(previousCjk + character);
        previousCjk = character;
      } else {
        previousCjk = "";
        latin += character;
      }
    }
    flushLatin();
  }
  return terms;
}

/** One retrieved episode with the parts of its score, for "why did you say that". */
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

/**
 * Rank episodes for one turn: `(floor + bm25) × (0.5 + salience) × recency`,
 * with BM25 normalised to the best hit of this query. Ties keep the newer
 * episode first, so results are deterministic for a fixed ledger.
 */
export function retrieveEpisodes(episodes: readonly Episode[], query: RetrievalQuery): RetrievedEpisode[] {
  const limit = query.limit ?? 5;
  if (episodes.length === 0 || limit <= 0) return [];
  const documents = episodes.map((episode) => tokenize(episode.summary));
  const averageLength = documents.reduce((sum, terms) => sum + terms.length, 0) / documents.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const terms of documents) {
    for (const term of new Set(terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const queryTerms = [...new Set(tokenize(query.text))];
  const raw = documents.map((terms) => {
    if (queryTerms.length === 0) return 0;
    const frequency = new Map<string, number>();
    for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const tf = frequency.get(term) ?? 0;
      if (tf === 0) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (terms.length / averageLength)));
    }
    return score;
  });
  const best = Math.max(...raw);
  const ranked = episodes.map((episode, index) => {
    const relevance = best > 0 ? raw[index] / best : 0;
    const score = (RELEVANCE_FLOOR + relevance) * (0.5 + episode.salience) * recencyOf(episode, query);
    return { episode, score, relevance };
  });
  ranked.sort((left, right) => right.score - left.score || right.episode.at.localeCompare(left.episode.at));
  return ranked.slice(0, limit);
}

function recencyOf(episode: Episode, query: RetrievalQuery): number {
  const ageDays = episode.gameDay !== null && query.gameDay !== null
    ? Math.max(0, query.gameDay - episode.gameDay)
    : Math.max(0, (query.now.getTime() - Date.parse(episode.at)) / 86_400_000);
  return 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}
