import { createBodyTools, BODY_TOOL_NAMES } from "../../../../packages/dsh-companion-plugin/src/body/tools.ts";
import type { RunContext } from "./harness.ts";
import type { TaskOutcome } from "./port.ts";
import type { ChatMessage } from "./model.ts";

/**
 * Shared tool-calling loop for the self-improve option prototypes (a-e). The
 * prior round's approach-*.ts files each carry their own copy of the baseline
 * loop; here the loop is factored out so an approach module contains only its
 * own machinery (the loc metric then reflects the option, not boilerplate).
 * Every option still gets the same DSH-style goal rounds: DONE is accepted
 * only while ctx.goalCheck holds.
 */

export interface DrivenTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, exec: { callId: string; signal: AbortSignal }): Promise<string>;
}

/** The product's body tools, driven, plus the health line the sim needs. */
export function bodyTools(ctx: RunContext): DrivenTool[] {
  const tools = createBodyTools({ body: ctx.port }) as unknown as DrivenTool[];
  return tools.map((tool) => ({
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
}

export interface DrivenLoopOptions {
  system: string;
  tools: DrivenTool[];
  maxTokens?: number;
  maxNudges?: number;
  /**
   * Called after each assistant turn's tools have run. Returns a user message
   * to inject before the next model call (stuck detectors use this), or null.
   */
  afterTurn?: (turn: { messages: ChatMessage[]; newOutcomes: readonly TaskOutcome[] }) => Promise<string | null>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The wait tool: let game time pass without model round-trips; ends early if the goal becomes true. */
export function waitTool(ctx: RunContext): DrivenTool {
  return {
    name: "wait_minutes",
    description: "Let in-game time pass without doing anything (the world keeps running). Use when a blocked thing is known to resolve later. Ends early if the goal becomes reachable.",
    parameters: { minutes: { type: "integer", description: "game minutes to wait; at most 600 per call", required: true } },
    execute: async (args) => {
      const minutes = Math.max(1, Math.min(600, Number(args.minutes ?? 0)));
      const msPerMinute = 17;
      const deadline = Date.now() + minutes * msPerMinute;
      const startState = await ctx.port.state();
      const startTick = startState.tick;
      while (Date.now() < deadline && !ctx.signal.aborted) {
        await sleep(200);
        if (await ctx.goalCheck()) return `waited; the goal condition now holds (about ${Math.round(((await ctx.port.state()).tick - startTick))} game minutes passed)`;
      }
      const endState = await ctx.port.state();
      return `waited ${Math.max(0, endState.tick - startTick)} game minutes; time is now day ${endState.time.day}, ${endState.time.timeOfDay}`;
    },
  };
}

/** Run one batch of driven tool calls; returns per-call result strings. */
async function executeCalls(ctx: RunContext, calls: { id: string; name: string; args: Record<string, unknown> }[], tools: readonly DrivenTool[], messages: ChatMessage[]): Promise<void> {
  for (const call of calls) {
    const tool = tools.find((candidate) => candidate.name === call.name);
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
}

export async function drivenLoop(ctx: RunContext, options: DrivenLoopOptions): Promise<boolean> {
  const messages: ChatMessage[] = [
    { role: "system", content: options.system },
    { role: "user", content: `${ctx.task.goalText}\n\nUse your tools. Reply with DONE alone when the whole task is complete.` },
  ];
  let nudges = 0;
  let seenOutcomes = 0;
  for (;;) {
    if (ctx.signal.aborted) { ctx.log("aborted"); return false; }
    if (ctx.model.counters.calls >= ctx.task.maxModelCalls) { ctx.log(`model call cap (${ctx.task.maxModelCalls}) reached`); return false; }
    const reply = await ctx.model.chat(messages, options.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), { maxTokens: options.maxTokens ?? 700 });
    messages.push({
      role: "assistant",
      content: reply.content ?? "",
      ...(reply.toolCalls.length === 0 ? {} : { tool_calls: reply.toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: JSON.stringify(call.args) } })) }),
    });
    if (reply.toolCalls.length === 0) {
      const text = (reply.content ?? "").trim();
      if (/\bDONE\b/.test(text.toUpperCase())) {
        if (await ctx.goalCheck()) { ctx.log(`model declared DONE: ${text.slice(0, 120)}`); return true; }
        if (nudges >= (options.maxNudges ?? 3)) { ctx.log(`DONE claimed but the goal is unmet; nudges exhausted`); return false; }
        nudges++;
        messages.push({ role: "user", content: "The delegated goal is not complete yet. Continue with your tools. (Reply DONE alone only when it truly holds.)" });
        continue;
      }
      if (nudges >= (options.maxNudges ?? 3)) { ctx.log(`model stopped replying with tools: ${text.slice(0, 200)}`); return false; }
      nudges++;
      messages.push({ role: "user", content: "Continue with your tools. (Reply DONE alone only when the whole task is complete.)" });
      continue;
    }
    await executeCalls(ctx, reply.toolCalls, options.tools, messages);
    // DSH-style goal latching: once the delegated goal's own check holds, the
    // turn ends instead of burning more model calls.
    if (await ctx.goalCheck()) { ctx.log("goal condition holds; ending the turn"); return true; }
    const outcomes = ctx.port.taskOutcomes.slice(seenOutcomes);
    seenOutcomes = ctx.port.taskOutcomes.length;
    if (options.afterTurn !== undefined) {
      const injection = await options.afterTurn({ messages, newOutcomes: outcomes });
      if (injection !== null) messages.push({ role: "user", content: injection });
    }
  }
}

/** [plan-submit] The plan_submit tool (option d/e): one model call, many body-tool calls. */
export function planSubmitTool(ctx: RunContext, tools: readonly DrivenTool[], options: { maxCalls?: number; stopOnFailure?: boolean } = {}): DrivenTool {
  const maxCalls = options.maxCalls ?? 8;
  const stopOnFailure = options.stopOnFailure ?? true;
  return {
    name: "plan_submit",
    description: `Submit a batch of ${maxCalls} or fewer planned body-tool calls (the same tools you call directly, e.g. body_walk_to, body_input, world_observe). They run in order without further model round-trips; you get one digest line per call. The batch stops early on the first failing call when stopOnFailure is true.`,
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: `Ordered calls: {"tool": "<name>", "args": {...}} — exactly the arguments the tool takes directly.`,
          items: { type: "object", properties: { tool: { type: "string" }, args: { type: "object" } }, required: ["tool", "args"] },
        },
        stopOnFailure: { type: "boolean", description: "stop the batch at the first failing call (default true)" },
      },
      required: ["steps"],
    },
    execute: async (args, exec) => {
      const steps = Array.isArray(args.steps) ? args.steps as { tool?: string; args?: Record<string, unknown> }[] : [];
      if (steps.length === 0) return "empty plan";
      const stop = args.stopOnFailure === undefined ? stopOnFailure : args.stopOnFailure !== false;
      const lines: string[] = [];
      let ran = 0;
      for (const step of steps.slice(0, maxCalls)) {
        if (exec.signal.aborted) { lines.push("batch aborted"); break; }
        const tool = tools.find((candidate) => candidate.name === step.tool);
        if (tool === undefined) { lines.push(`${step.tool}: no such tool`); if (stop) break; continue; }
        let result: string;
        let failed = false;
        try {
          result = await tool.execute(step.args ?? {}, { callId: `plan-${ran}`, signal: exec.signal });
        } catch (error) {
          result = `tool error: ${error instanceof Error ? error.message : String(error)}`;
          failed = true;
        }
        ran++;
        const status = /error|failed|interrupted|blocked|locked|timeout|no such/i.test(result.slice(0, 400)) ? "FAIL" : "ok";
        if (status === "FAIL") failed = true;
        ctx.log(`plan[${ran}] ${step.tool} -> ${result.slice(0, 140).replace(/\n/g, " ")}`);
        lines.push(`${ran}. ${step.tool}: ${status === "FAIL" ? "FAILED" : "ok"} — ${result.replace(/\s+/g, " ").slice(0, 220)}`);
        if (stop && failed) { lines.push("batch stopped on failure"); break; }
      }
      if (steps.length > maxCalls) lines.push(`(plan truncated to ${maxCalls} calls)`);
      return [`plan digest (${ran}/${Math.min(steps.length, maxCalls)} calls ran):`, ...lines].join("\n");
    },
  };
}
// [/plan-submit]

/** Signature helper shared by stuck detectors: how the body's last failing tasks failed. */
export function failingSignatureSummary(outcomes: readonly TaskOutcome[]): string {
  return outcomes.map((outcome) => `${outcome.signature}(${outcome.status}/${outcome.reason ?? "?"})`).join(", ");
}
