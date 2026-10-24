import type { RunContext } from "./harness.ts";
import type { TaskOutcome } from "./port.ts";
import { WebSim } from "./web-sim.ts";
import { bodyTools, drivenLoop, failingSignatureSummary, waitTool, type DrivenTool } from "./driven.ts";
import type { ChatMessage } from "./model.ts";

/**
 * Option (a): stuck detector + reflect-and-search that writes lessons
 * (Reflexion/ExpeL style), with a web search for world facts.
 *
 * DSH seams stood in by the bench: the stuck detector is the plugin's
 * `agent/pre-step` listener (it sees the same task outcomes the body port
 * emits); the lessons are the plugin's own files (the memory-ledger pattern,
 * here in-memory per run — cross-run persistence is option (b)'s claim);
 * web_search/web_fetch are the simulated `ctx.web`.
 */

const STUCK_REPEATS = 2;

export const REFLECT_SYSTEM = [
  "You are Player2, a co-op player companion in a game, working a delegated goal.",
  "You act only through your tools: look with world_observe/world_map/world_find, move with body_walk_to (mode \"adjacent\" before working a tile), act with body_input.",
  "Raw body_input steps look like " + '{"hold":["DPadUp"],"ms":400} or {"press":["ControllerA"],"ms":50} — button ids come from body_controls.',
  "You also have: web_search/web_fetch (a game wiki — use it when a blocker might be world knowledge you lack, e.g. something closed or invulnerable),",
  "lesson_save (write a durable lesson: condition -> what to do instead), lesson_list, and wait_minutes (let time pass when something is known to resolve later).",
  "If you fail the same way twice, STOP retrying: check lessons, search the wiki if facts might explain it, write a lesson, and change approach.",
  "When the whole task is complete, reply with DONE alone.",
].join(" ");

export async function runReflect(ctx: RunContext): Promise<boolean> {
  const web = await WebSim.forScenario(ctx.task.scenario);
  const lessons: string[] = [];

  const webSearch: DrivenTool = {
    name: "web_search",
    description: "Search the game's public wiki (simulated, deterministic, offline). Returns titles, urls and snippets.",
    parameters: { queries: { type: "array", items: { type: "string" }, description: "one or more search queries", required: true } },
    execute: async (args) => {
      const queries = Array.isArray(args.queries) ? args.queries.map(String) : [];
      const { hits, note } = web.search(queries);
      if (hits.length === 0) return note;
      return [note, ...hits.map((hit) => `- ${hit.title} (${hit.url}): ${hit.snippet}`)].join("\n");
    },
  };
  const webFetch: DrivenTool = {
    name: "web_fetch",
    description: "Fetch one wiki page's full text by url (from web_search results).",
    parameters: { url: { type: "string", description: "the page url", required: true } },
    execute: async (args) => web.fetch(String(args.url ?? "")),
  };
  const lessonSave: DrivenTool = {
    name: "lesson_save",
    description: "Save one durable lesson for this run (condition -> what to do instead), so you stop repeating the mistake.",
    parameters: { lesson: { type: "string", description: "one sentence: when <condition>, do <instead> because <why>", required: true } },
    execute: async (args) => {
      const lesson = String(args.lesson ?? "").trim().slice(0, 300);
      if (lesson.length === 0) return "empty lesson";
      if (!lessons.includes(lesson)) lessons.push(lesson);
      return `saved (${lessons.length} lessons this run)`;
    },
  };
  const lessonList: DrivenTool = {
    name: "lesson_list",
    description: "List the lessons saved this run.",
    parameters: {},
    execute: async () => lessons.length === 0 ? "no lessons yet" : lessons.map((lesson, index) => `${index + 1}. ${lesson}`).join("\n"),
  };

  // The stuck detector: consecutive failing body tasks with the same signature.
  let lastSignature: string | null = null;
  let sameFailures = 0;
  const afterTurn = async ({ newOutcomes }: { messages: ChatMessage[]; newOutcomes: readonly TaskOutcome[] }): Promise<string | null> => {
    const failures = newOutcomes.filter((outcome) => outcome.status === "interrupted" || outcome.status === "failed" || outcome.status === "timeout");
    if (failures.length === 0) { lastSignature = null; sameFailures = 0; return null; }
    const signature = failures[failures.length - 1].signature;
    if (signature === lastSignature) sameFailures++;
    else { lastSignature = signature; sameFailures = 1; }
    if (sameFailures < STUCK_REPEATS) return null;
    sameFailures = 0;
    return [
      `[stuck] The last ${failures.length} body tasks failed the same way (${failingSignatureSummary(failures)}). Do not submit that same action again.`,
      "Step back: 1) lesson_list; 2) if the blocker could be world knowledge (something closed, scheduled, or immune), web_search for it and web_fetch the best page;",
      "3) lesson_save what you learned; 4) act differently — a different route, tool, action, or wait_minutes if the wiki says the blocker clears later.",
    ].join(" ");
  };

  const tools = [...bodyTools(ctx), webSearch, webFetch, lessonSave, lessonList, waitTool(ctx)];
  const ok = await drivenLoop(ctx, { system: REFLECT_SYSTEM, tools, afterTurn });
  ctx.log(`lessons saved this run: ${lessons.length}${lessons.length > 0 ? ` — ${lessons.join(" | ")}` : ""}`);
  return ok;
}
