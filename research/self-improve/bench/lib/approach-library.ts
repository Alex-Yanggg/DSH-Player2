import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunContext } from "./harness.ts";
import { bodyTools, drivenLoop, waitTool, type DrivenTool } from "./driven.ts";

/**
 * Option (b): a persona-level library shared across sessions on one save.
 *
 * The library lives in the plugin's own files (the memory-ledger seam), keyed
 * by the save's own id — the bench scenario declares it, exactly as the real
 * mod reads the game's unique save id. Each session starts with the library
 * rendered into the persona/policy prompt sections (transparent loading: the
 * model is not asked to "load memory"); session discoveries are added through
 * library_learn. The `cold` control variant keys the same store per-seed, so
 * every session starts empty — the delta between warm and cold isolates what
 * the shared library itself buys.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIBRARY_DIR = path.join(ROOT, "results", "library");

interface LibraryFile {
  saveId: string;
  facts: { lesson: string; topic: string; session: number }[];
}

async function readLibrary(file: string): Promise<LibraryFile | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as LibraryFile;
  } catch {
    return null;
  }
}

async function writeLibrary(file: string, library: LibraryFile): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(library, null, 2), "utf8");
}

const BASE_SYSTEM = [
  "You are Player2, a co-op player companion in a game, working a delegated goal on this save.",
  "You act only through your tools: look with world_observe/world_map/world_find, move with body_walk_to (mode \"adjacent\" before working a tile), act with body_input.",
  "Raw body_input steps look like " + '{"hold":["DPadUp"],"ms":400} or {"press":["ControllerA"],"ms":50} — button ids come from body_controls.',
  "You also have: library_learn (record a durable fact about this save for your future sessions) and wait_minutes (let time pass when something resolves later).",
  "Standing policies: when blocked, look around (world_map/world_observe) and read anything readable nearby before retrying; when you learn a durable fact about this save (something closed until a date, an invulnerable guardian, where a key comes from), library_learn it immediately.",
  "When the whole task is complete, reply with DONE alone.",
].join(" ");

export async function runLibrary(ctx: RunContext, options: { cold?: boolean } = {}): Promise<boolean> {
  // The save id: the scenario's own id when it declares one, else the scenario
  // name. Each option architecture owns its own store (b and e are rival
  // deployments of the same save), and the cold control keys per-seed so every
  // session starts with an empty library.
  const baseId = ctx.saveId ?? `scenario-${ctx.task.scenario}`;
  const saveId = (options.cold === true ? `${baseId}-cold-seed${ctx.seed}` : `${baseId}`);
  const file = path.join(LIBRARY_DIR, `library-${saveId}.json`);
  const library = (await readLibrary(file)) ?? { saveId, facts: [] };
  // This run is a new session on the save: number it after the last recorded one.
  const session = library.facts.length === 0 ? 1 : Math.max(...library.facts.map((fact) => fact.session)) + 1;

  const learned: string[] = [];
  const libraryLearn: DrivenTool = {
    name: "library_learn",
    description: "Record one durable fact about this save for your own future sessions on it (e.g. 'the north pass opens on day 5').",
    parameters: {
      lesson: { type: "string", description: "the fact, one sentence", required: true },
      topic: { type: "string", description: "a short topic tag, e.g. 'north pass', 'golem'" },
    },
    execute: async (args) => {
      const lesson = String(args.lesson ?? "").trim().slice(0, 300);
      if (lesson.length === 0) return "empty lesson";
      if (!library.facts.some((fact) => fact.lesson === lesson) && !learned.includes(lesson)) {
        learned.push(lesson);
        library.facts.push({ lesson, topic: String(args.topic ?? "general").slice(0, 40), session });
        await writeLibrary(file, library);
      }
      return `recorded (${library.facts.length} facts on this save)`;
    },
  };

  const priorSection = library.facts.length === 0
    ? ""
    : `\n\nLessons you already know about this save (from your own previous sessions on it):\n${library.facts.map((fact) => `- [${fact.topic}] ${fact.lesson}`).join("\n")}`;

  const tools = [...bodyTools(ctx), libraryLearn, waitTool(ctx)];
  const ok = await drivenLoop(ctx, { system: BASE_SYSTEM + priorSection, tools });
  ctx.log(`library ${saveId}: ${library.facts.length} facts (${learned.length} learned this session)`);
  return ok;
}
