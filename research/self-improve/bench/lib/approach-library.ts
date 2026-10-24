import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunContext } from "./harness.ts";
import type { TaskOutcome } from "./port.ts";
import type { ChatMessage } from "./model.ts";
import { bodyTools, drivenLoop, waitTool, type DrivenTool } from "./driven.ts";

/**
 * Option (b), the owner-agreed baseline: a three-layer memory.
 *
 * - Layer 1, the persona library (lessons, skills, character): shared across
 *   saves — one companion, many worlds. Stored in the plugin's own files.
 * - Layer 2, save memory: keyed by the game's own unique save id (the bench
 *   scenario declares it, exactly as the mod reads `uniqueIDForThisGame`; no
 *   watermarking).
 * - Layer 3, the session: one DSH session covers one play sitting. It loads
 *   both layers at start (transparently, into the prompt) and distils new
 *   lessons back at end with one model call.
 *
 * `cold` is the control: both layers empty per seed, isolating what the
 * carried memory buys.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIBRARY_DIR = path.join(ROOT, "results", "library");

interface PersonaLibrary {
  /** Durable, game-generic knowledge and policies. */
  lessons: string[];
  /** Who the companion is on every save (tone, policies the player approved). */
  character: string[];
}

interface SaveMemory {
  saveId: string;
  lessons: { lesson: string; topic: string; session: number }[];
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

const BASE_SYSTEM = [
  "You are Player2, a co-op player companion in a game, working a delegated goal on this save.",
  "You act only through your tools: look with world_observe/world_map/world_find, move with body_walk_to (mode \"adjacent\" before working a tile), act with body_input.",
  "Raw body_input steps look like " + '{"hold":["DPadUp"],"ms":400} or {"press":["ControllerA"],"ms":50} — button ids come from body_controls.',
  "You also have: library_learn (record a durable fact you just established about this save) and wait_minutes (let time pass when something resolves later).",
  "Standing policies: when blocked, look around (world_map/world_observe) and read anything readable nearby before retrying; when you learn a durable fact about this save, library_learn it immediately.",
  "When the whole task is complete, reply with DONE alone.",
].join(" ");

const DISTIL_SYSTEM = [
  "You maintain Player2's memory. You get a session digest of one play sitting (goal, what happened, what was learned).",
  "Return STRICT JSON: {\"save\": [\"...\"], \"persona\": [\"...\"]} where each entry is one durable lesson.",
  "save: facts about THIS save/world (places, schedules, guardians, where things come from). persona: game-generic policies or companion character notes worth keeping on every save.",
  "Only durable, reusable knowledge — no coordinates of transient objects, no step-by-step replays. Empty arrays are fine. JSON only, no prose.",
].join(" ");

export async function runLibrary(ctx: RunContext, options: { cold?: boolean } = {}): Promise<boolean> {
  const baseId = ctx.saveId ?? `scenario-${ctx.task.scenario}`;
  // Each option architecture owns its own store (b and e are rival
  // deployments). Cold control: per-seed files, so every session starts empty.
  const scope = options.cold === true ? `cold-seed${ctx.seed}` : "main";
  const personaFile = path.join(LIBRARY_DIR, `library-${scope}-persona.json`);
  const saveFile = path.join(LIBRARY_DIR, `library-${scope}-save-${baseId}.json`);
  const persona = (await readJson<PersonaLibrary>(personaFile)) ?? { lessons: [], character: [] };
  const save = (await readJson<SaveMemory>(saveFile)) ?? { saveId: baseId, lessons: [] };
  const session = save.lessons.length === 0 ? 1 : Math.max(...save.lessons.map((fact) => fact.session)) + 1;
  const learned: string[] = [];
  const sessionEvents: string[] = [];

  const libraryLearn: DrivenTool = {
    name: "library_learn",
    description: "Record one durable fact about this save for your own future sessions on it (goes into save memory now; the persona layer is distilled at session end).",
    parameters: {
      lesson: { type: "string", description: "the fact, one sentence", required: true },
      topic: { type: "string", description: "a short topic tag, e.g. 'north pass', 'golem'" },
    },
    execute: async (args) => {
      const lesson = String(args.lesson ?? "").trim().slice(0, 300);
      if (lesson.length === 0) return "empty lesson";
      if (!save.lessons.some((fact) => fact.lesson === lesson) && !learned.includes(lesson)) {
        learned.push(lesson);
        save.lessons.push({ lesson, topic: String(args.topic ?? "general").slice(0, 40), session });
        await writeJson(saveFile, save);
        sessionEvents.push(`learned: ${lesson}`);
      }
      return `recorded (${save.lessons.length} facts on this save)`;
    },
  };

  const priorSection = [
    persona.lessons.length > 0 ? `What you know everywhere (your persona library):\n${persona.lessons.map((lesson) => `- ${lesson}`).join("\n")}` : "",
    persona.character.length > 0 ? `Who you are (persona library):\n${persona.character.map((line) => `- ${line}`).join("\n")}` : "",
    save.lessons.length > 0 ? `What you know about this save (from your own previous sessions on it):\n${save.lessons.map((fact) => `- [${fact.topic}] ${fact.lesson}`).join("\n")}` : "",
  ].filter((section) => section !== "").join("\n\n");

  const tools = [...bodyTools(ctx), libraryLearn, waitTool(ctx)];
  let ok = false;
  try {
    ok = await drivenLoop(ctx, { system: BASE_SYSTEM + (priorSection === "" ? "" : `\n\n${priorSection}`), tools });
  } finally {
    // Session end: distil the sitting back into memory (one model call).
    const digest = [
      `Goal: ${ctx.task.goalText.split("\n")[0]}`,
      `Outcome: ${ok === true ? "goal reached" : "not reached"} in ${ctx.port.taskOutcomes.length} body tasks.`,
      `Body tasks (signature -> status): ${ctx.port.taskOutcomes.slice(-25).map((outcome: TaskOutcome) => `${outcome.signature}->${outcome.status}`).join("; ")}`,
      `Learned this session: ${learned.length === 0 ? "nothing explicit" : learned.join(" | ")}`,
      sessionEvents.length > 0 ? `Events: ${sessionEvents.slice(0, 12).join(" | ")}` : "",
    ].filter((line) => line !== "").join("\n");
    try {
      if (ctx.model.counters.calls < ctx.task.maxModelCalls) {
        const reply = await ctx.model.chat(
          [
            { role: "system", content: DISTIL_SYSTEM },
            { role: "user", content: digest } satisfies ChatMessage,
          ],
          [],
          { maxTokens: 400 },
        );
        const match = reply.content?.match(/\{[\s\S]*\}/);
        if (match !== undefined && match !== null) {
          const distilled = JSON.parse(match[0]) as { save?: string[]; persona?: string[] };
          for (const lesson of distilled.save ?? []) {
            const text = String(lesson).trim().slice(0, 300);
            if (text.length > 0 && !save.lessons.some((fact) => fact.lesson === text)) save.lessons.push({ lesson: text, topic: "distilled", session });
          }
          for (const lesson of distilled.persona ?? []) {
            const text = String(lesson).trim().slice(0, 300);
            if (text.length > 0 && !persona.lessons.includes(text)) persona.lessons.push(text);
          }
          await writeJson(saveFile, save);
          await writeJson(personaFile, persona);
          ctx.log(`distilled: +${(distilled.save ?? []).length} save / +${(distilled.persona ?? []).length} persona lessons`);
        }
      }
    } catch (error) {
      ctx.log(`distil failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  ctx.log(`library ${scope}/${baseId}: save ${save.lessons.length} facts, persona ${persona.lessons.length} lessons`);
  return ok;
}
