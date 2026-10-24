import { createBodyTools, BODY_TOOL_NAMES } from "../../../../packages/dsh-companion-plugin/src/body/tools.ts";
import type { RunContext } from "./harness.ts";
import type { ChatMessage } from "./model.ts";

/**
 * The pure LLM tool-calling baseline — today's shipped architecture, rebuilt
 * minimally for the bench: the model owns the whole loop and drives the SAME
 * product tools (`createBodyTools`, imported from the plugin, unmodified) in a
 * tool-calling loop. The only bench additions are the loop itself, a condensed
 * system prompt, and (mine only) one health line appended to world_observe,
 * because the sim adapter exports no body health of its own.
 */

interface DrivenTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, exec: { callId: string; signal: AbortSignal }): Promise<string>;
}

const SYSTEM_PROMPT = [
  "You are Player2, a co-op farmer companion playing alongside a human in a farming game.",
  "You act in the game only through your tools. Work the delegated task step by step:",
  "look with world_observe and world_map, move with body_walk_to (use mode \"adjacent\" before working a tile),",
  "and act with body_input (Slot buttons select toolbar slots; presses fire once).",
  "Prefer few, purposeful calls; verify with world_observe after actions that matter.",
  "When the whole task is complete, reply with DONE alone. If you cannot finish, say why in one line.",
].join("\n");

export const LLM_DONE = "DONE";

export async function runLlmBaseline(ctx: RunContext): Promise<boolean> {
  const tools = createBodyTools({ body: ctx.port }) as unknown as DrivenTool[];
  const driven: DrivenTool[] = tools.map((tool) => ({
    ...tool,
    execute: async (args, exec) => {
      const result = await tool.execute(args, exec);
      if (tool.name === BODY_TOOL_NAMES.observe) {
        const state = await ctx.port.state();
        const health = state.body?.health;
        if (health !== undefined && health < 100) return `${result}\nYour health: ${Math.round(health)}/100.`;
      }
      return result;
    },
  }));

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `${ctx.task.goalText}\n\nUse your tools. Reply with DONE alone when the whole task is complete.` },
  ];

  let nudges = 0;
  for (;;) {
    if (ctx.signal.aborted) { ctx.log("aborted"); return false; }
    if (ctx.model.counters.calls >= ctx.task.maxModelCalls) { ctx.log(`model call cap (${ctx.task.maxModelCalls}) reached`); return false; }
    const reply = await ctx.model.chat(
      messages,
      driven.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
      { maxTokens: 700 },
    );
    messages.push({
      role: "assistant",
      content: reply.content ?? "",
      ...(reply.toolCalls.length === 0 ? {} : { tool_calls: reply.toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: JSON.stringify(call.args) } })) }),
    });
    if (reply.toolCalls.length === 0) {
      const text = (reply.content ?? "").trim();
      if (/\bDONE\b/.test(text.toUpperCase())) { ctx.log(`model declared DONE: ${text.slice(0, 120)}`); return true; }
      if (nudges >= 3) { ctx.log(`model stopped replying with tools: ${text.slice(0, 200)}`); return false; }
      nudges++;
      messages.push({ role: "user", content: "Continue with your tools. (Reply DONE alone only when the whole task is complete.)" });
      continue;
    }
    for (const call of reply.toolCalls) {
      const tool = driven.find((candidate) => candidate.name === call.name);
      let result: string;
      if (tool === undefined) {
        result = `no such tool: ${call.name}`;
      } else {
        try {
          result = await tool.execute(call.args, { callId: call.id, signal: ctx.signal });
        } catch (error) {
          result = `tool error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      ctx.log(`${call.name}(${JSON.stringify(call.args).slice(0, 100)}) -> ${result.slice(0, 140).replace(/\n/g, " ")}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 4_000) });
    }
    // DSH-style goal latching: once the delegated goal's own check holds, the
    // turn ends instead of burning more model calls (same rule every option gets).
    if (await ctx.goalCheck()) { ctx.log("goal condition holds; ending the turn"); return true; }
  }
}
