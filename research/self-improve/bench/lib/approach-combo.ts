import type { RunContext } from "./harness.ts";
import type { TaskOutcome } from "./port.ts";
import { WebSim } from "./web-sim.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bodyTools, drivenLoop, failingSignatureSummary, planSubmitTool, waitTool, type DrivenTool } from "./driven.ts";
import type { ChatMessage } from "./model.ts";

/**
 * Option (e): the combination — the option (b) cross-save persona library,
 * the option (a) stuck detector with reflect-and-search (web) on top of it,
 * and the option (d) plan batching for action rate. Curriculum-style
 * exploration is NOT folded in: its cost is part of the debate, and the
 * library plus standing "look around before retrying" policies stand in for
 * the cheap part of it.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIBRARY_DIR = path.join(ROOT, "results", "library");

interface LibraryFile {
  saveId: string;
  facts: { lesson: string; topic: string; session: number }[];
}

const STUCK_REPEATS = 2;

const SYSTEM = [
  "You are Player2, a co-op player companion in a game, working a delegated goal on this save.",
  "Act through your tools: look with world_observe/world_map/world_find, move with body_walk_to (mode \"adjacent\" before working a tile), act with body_input.",
  "Raw body_input steps look like " + '{"hold":["DPadUp"],"ms":400} or {"press":["ControllerA"],"ms":50} — button ids come from body_controls.',
  "Work in batches with plan_submit (up to 8 planned body-tool calls run without waiting on you; the batch stops at the first failing call).",
  "You also have web_search/web_fetch (a game wiki, for world-knowledge blockers), library_learn (record durable facts about this save for future sessions), and wait_minutes (when something resolves later).",
  "Standing policies: when blocked, look around and read anything readable nearby before retrying; if you fail the same way twice, stop and reflect (lessons, wiki, then a different approach); when you learn a durable fact about this save, library_learn it.",
  "When the whole task is complete, reply with DONE alone.",
].join(" ");

export async function runCombo(ctx: RunContext): Promise<boolean> {
  const baseId = ctx.saveId ?? `scenario-${ctx.task.scenario}`;
  const file = path.join(LIBRARY_DIR, `combo-${baseId}.json`);
  const library = (await readFile(file, "utf8").then((raw) => JSON.parse(raw) as LibraryFile).catch(() => null)) ?? { saveId: baseId, facts: [] };
  const session = library.facts.length === 0 ? 1 : Math.max(...library.facts.map((fact) => fact.session)) + 1;
  const web = await WebSim.forScenario(ctx.task.scenario);

  const libraryLearn: DrivenTool = {
    name: "library_learn",
    description: "Record one durable fact about this save for your own future sessions on it.",
    parameters: {
      lesson: { type: "string", description: "the fact, one sentence", required: true },
      topic: { type: "string", description: "a short topic tag" },
    },
    execute: async (args) => {
      const lesson = String(args.lesson ?? "").trim().slice(0, 300);
      if (lesson.length === 0) return "empty lesson";
      if (!library.facts.some((fact) => fact.lesson === lesson)) {
        library.facts.push({ lesson, topic: String(args.topic ?? "general").slice(0, 40), session });
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(library, null, 2), "utf8");
      }
      return `recorded (${library.facts.length} facts on this save)`;
    },
  };
  const webSearch: DrivenTool = {
    name: "web_search",
    description: "Search the game's public wiki (simulated, deterministic, offline).",
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
    description: "Fetch one wiki page's full text by url.",
    parameters: { url: { type: "string", description: "the page url", required: true } },
    execute: async (args) => web.fetch(String(args.url ?? "")),
  };

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
      "Reflect: if the blocker could be world knowledge, web_search and web_fetch; library_learn what you find; then change approach — different route, tool, action, or wait_minutes if the wiki says the blocker clears later.",
    ].join(" ");
  };

  const priorSection = library.facts.length === 0
    ? ""
    : `\n\nLessons you already know about this save (from your own previous sessions on it):\n${library.facts.map((fact) => `- [${fact.topic}] ${fact.lesson}`).join("\n")}`;

  const tools = bodyTools(ctx);
  const plan = planSubmitTool(ctx, tools, { maxCalls: 8, stopOnFailure: true });
  const ok = await drivenLoop(ctx, { system: SYSTEM + priorSection, tools: [...tools, plan, libraryLearn, webSearch, webFetch, waitTool(ctx)], afterTurn });
  ctx.log(`library ${baseId}: ${library.facts.length} facts`);
  return ok;
}
