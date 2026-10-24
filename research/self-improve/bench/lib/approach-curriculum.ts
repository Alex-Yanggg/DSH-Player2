import type { RunContext } from "./harness.ts";
import { bodyTools, drivenLoop, waitTool, type DrivenTool } from "./driven.ts";
import type { ChatMessage } from "./model.ts";

/**
 * Option (c): an exploration-first automatic curriculum (Voyager-style
 * "learn the world before the goal"). Phase 1 the model surveys the world it
 * starts in — visit areas, read notices, try doors — recording findings in a
 * field guide (guide_write) and declaring the survey complete with
 * curriculum_done; the bench forces the switch after a call budget so a lazy
 * survey cannot burn the whole run. Phase 2 works the delegated goal with the
 * guide injected into the prompt. One run, two phases, the way a DSH plugin
 * would drive them through turn markers on `agent/pre-step`.
 */

const EXPLORE_SYSTEM = [
  "You are Player2, a co-op player companion. A delegated goal exists, but FIRST follow your standing curriculum policy: learn the world before working the goal.",
  "Phase now: SURVEY. Explore the areas reachable from where you stand with world_map/world_observe and body_walk_to; read every notice/sign you find (face it, then body_input with the action button); try doors and machines you meet; note where things are.",
  "Record each finding with guide_write(topic, note) — durable facts about this world (what is closed until when, what is guarded, what opens what).",
  "When you have surveyed the reachable world, call curriculum_done. Do not work the delegated goal during the survey except as it helps you explore.",
].join(" ");

const WORK_SYSTEM = [
  "You are Player2, a co-op player companion in a game, working a delegated goal.",
  "You act only through your tools: look with world_observe/world_map/world_find, move with body_walk_to (mode \"adjacent\" before working a tile), act with body_input.",
  "Raw body_input steps look like " + '{"hold":["DPadUp"],"ms":400} or {"press":["ControllerA"],"ms":50} — button ids come from body_controls.',
  "wait_minutes lets time pass when something you know resolves later.",
  "When the whole task is complete, reply with DONE alone.",
].join(" ");

export async function runCurriculum(ctx: RunContext): Promise<boolean> {
  const guide: { topic: string; note: string }[] = [];
  const maxTokens = 700;

  const guideWrite: DrivenTool = {
    name: "guide_write",
    description: "Write one field-guide entry: a durable fact you learned about this world.",
    parameters: {
      topic: { type: "string", description: "short tag, e.g. 'north pass'", required: true },
      note: { type: "string", description: "the fact, one sentence", required: true },
    },
    execute: async (args) => {
      const note = String(args.note ?? "").trim().slice(0, 300);
      const topic = String(args.topic ?? "general").trim().slice(0, 40) || "general";
      if (note.length === 0) return "empty note";
      if (!guide.some((entry) => entry.note === note)) guide.push({ topic, note });
      return `recorded (${guide.length} entries)`;
    },
  };
  const curriculumDone: DrivenTool = {
    name: "curriculum_done",
    description: "Declare the world survey complete; from now on you work the delegated goal with your field guide in hand.",
    parameters: {},
    execute: async () => {
      surveyed = true;
      return "survey accepted; work the delegated goal now";
    },
  };

  let surveyed = false;
  let surveyTurns = 0;
  const surveyBudgetTurns = 8;

  const afterTurn = async ({ messages }: { messages: ChatMessage[]; newOutcomes: readonly unknown[] }): Promise<string | null> => {
    if (surveyed) return null;
    surveyTurns++;
    if (surveyTurns >= surveyBudgetTurns) {
      surveyed = true;
      ctx.log(`survey budget (${surveyBudgetTurns} turns) reached; switching to the goal`);
      return null;
    }
    return null;
  };

  // Phase 1: the survey. The survey prompt does not authorize DONE, so run a
  // bounded survey loop instead of drivenLoop.
  const surveyTools = [...bodyTools(ctx), guideWrite, curriculumDone, waitTool(ctx)];
  const surveyMessages: ChatMessage[] = [
    { role: "system", content: EXPLORE_SYSTEM },
    { role: "user", content: `${ctx.task.goalText}\n\n(the goal is for later — survey first; call curriculum_done when done surveying)` },
  ];
  let seenOutcomes = 0;
  for (;;) {
    if (ctx.signal.aborted || ctx.model.counters.calls >= ctx.task.maxModelCalls || surveyed) break;
    const reply = await ctx.model.chat(surveyMessages, surveyTools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), { maxTokens });
    surveyMessages.push({
      role: "assistant",
      content: reply.content ?? "",
      ...(reply.toolCalls.length === 0 ? {} : { tool_calls: reply.toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: JSON.stringify(call.args) } })) }),
    });
    if (reply.toolCalls.length === 0) {
      surveyed = true;
      break;
    }
    for (const call of reply.toolCalls) {
      const tool = surveyTools.find((candidate) => candidate.name === call.name);
      let result: string;
      if (tool === undefined) result = `no such tool: ${call.name}`;
      else {
        try {
          result = await tool.execute(call.args, { callId: call.id, signal: ctx.signal });
        } catch (error) {
          result = `tool error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      ctx.log(`survey ${call.name}(${JSON.stringify(call.args).slice(0, 80)}) -> ${result.slice(0, 120).replace(/\n/g, " ")}`);
      surveyMessages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 4_000) });
    }
    await afterTurn({ messages: surveyMessages, newOutcomes: ctx.port.taskOutcomes.slice(seenOutcomes) });
    seenOutcomes = ctx.port.taskOutcomes.length;
  }
  ctx.log(`survey finished after ${surveyTurns} turns with ${guide.length} guide entries`);

  // Phase 2: the goal, with the guide in the prompt.
  const guideSection = guide.length === 0 ? "" : `\n\nYour field guide from the survey:\n${guide.map((entry) => `- [${entry.topic}] ${entry.note}`).join("\n")}`;
  const tools = [...bodyTools(ctx), guideWrite, waitTool(ctx)];
  const ok = await drivenLoop(ctx, { system: WORK_SYSTEM + guideSection, tools, maxTokens });
  ctx.log(`guide entries: ${guide.length}${guide.length > 0 ? ` — ${guide.map((entry) => entry.note).join(" | ")}` : ""}`);
  return ok;
}
