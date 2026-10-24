import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The simulated web: a deterministic, offline search corpus per scenario.
 *
 * The scenarios' hidden facts (a closure date, an invulnerable guardian) are
 * discoverable ONLY through this tool or through in-world exploration, mirroring
 * the P2-0019 mine failure where the spring-5 landslide was knowable neither
 * from the map nor from the goal text. The corpus stands in for what a DSH
 * plugin reaches through `ctx.web` (`@deepseek-ai/dsh-web` + the DeepSeek
 * search provider; see ../../dsh-facts.md). It is game fixture data, like the
 * map rows — approaches never edit it, and no network request is made.
 */

const CORPUS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus");

export interface CorpusPage {
  url: string;
  title: string;
  text: string;
}

export interface WebSearchHit {
  url: string;
  title: string;
  snippet: string;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 2);
}

export class WebSim {
  private readonly pages: CorpusPage[];

  private constructor(pages: CorpusPage[]) {
    this.pages = pages;
  }

  public static async forScenario(scenario: string): Promise<WebSim> {
    try {
      const raw = await readFile(path.join(CORPUS_DIR, `${scenario}.json`), "utf8");
      const parsed = JSON.parse(raw) as { pages: CorpusPage[] };
      return new WebSim(parsed.pages);
    } catch {
      // A scenario without a corpus has no searchable web; searches return nothing.
      return new WebSim([]);
    }
  }

  /** Deterministic keyword-ranked search; no network, no randomness. */
  public search(queries: readonly string[], maxResults = 3): { hits: WebSearchHit[]; note: string } {
    const queryTerms = new Set(queries.flatMap((query) => tokenize(query)));
    if (queryTerms.size === 0) return { hits: [], note: "No results found (empty query)." };
    const scored = this.pages.map((page) => {
      const titleTerms = tokenize(page.title);
      const textTerms = tokenize(page.text);
      let score = 0;
      for (const term of queryTerms) {
        if (titleTerms.includes(term)) score += 3;
        score += textTerms.filter((candidate) => candidate === term).length;
      }
      return { page, score };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, maxResults);
    if (scored.length === 0) return { hits: [], note: "No results found. Try different words." };
    return {
      hits: scored.map(({ page }) => ({ url: page.url, title: page.title, snippet: page.text.slice(0, 220) })),
      note: "Simulated offline wiki search (deterministic). Fetch a page with web_fetch for the full text.",
    };
  }

  public fetch(url: string): string {
    const page = this.pages.find((candidate) => candidate.url === url);
    if (page === undefined) return `no page at ${url}`;
    return `# ${page.title}\n${page.text}`;
  }
}
