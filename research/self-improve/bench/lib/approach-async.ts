import type { BodyInputStep } from "@dsh-player2/contracts";
import type { RunContext } from "./harness.ts";
import { bodyTools, waitTool, type DrivenTool } from "./driven.ts";
import { WebSim } from "./web-sim.ts";
import { controls, faceAndPress, goto, pressSteps, type Controls } from "./capabilities.ts";
import type { ChatMessage } from "./model.ts";

/**
 * Option (e), the owner's design: a big-brain/small-brain async split, because
 * "intelligence must stay online".
 *
 * - The BIG BRAIN is the DSH session model: it plans, reflects and
 *   web-searches asynchronously and never blocks the body. In the bench it is
 *   a model loop whose only tools are observe/web_search/web_fetch and
 *   submit_plan; it wakes when the plan is exhausted, when the small brain
 *   escalates, or when the goal check holds.
 * - The SMALL BRAIN lives in the plugin: it keeps acting on the current plan
 *   (game-agnostic primitives: walk-to, interact, raw input, wait), detects
 *   repeated failure itself (3 failing tasks with the same outcome signature),
 *   and escalates to the big brain.
 * - Plans and status pass between them through the plugin (the bench's shared
 *   state object stands in for the plugin-owned message board).
 *
 * Two small-brain variants share everything except action selection:
 * - `async` (code): replays the plan's explicit steps with fixed code.
 * - `async-llm` (cheap model): the big brain hands down a directive and a
 *   minimal-prompt model picks each primitive per step. The bench stands in
 *   for DSH's flash tier / subagent path; its extra calls and latency are the
 *   measured cost.
 */

type PlanStep =
  | { kind: "walk_to"; x: number; y: number; mode?: "stand" | "adjacent" }
  | { kind: "interact"; x: number; y: number; button: string; slot?: number }
  | { kind: "raw_input"; steps: { hold?: string[]; press?: string[]; ms: number }[] }
  | { kind: "wait"; minutes: number };

interface Plan {
  approach: string;
  steps: PlanStep[];
}

interface Shared {
  plan: Plan | null;
  directive: string;
  /** Index of the next step (code variant) — the LLM variant tracks progress textually. */
  planIndex: number;
  escalated: boolean;
  escalation: string | null;
  needPlan: boolean;
  statusLog: string[];
  failureCounts: Map<string, number>;
  stop: boolean;
}

function newShared(): Shared {
  return { plan: null, directive: "", planIndex: 0, escalated: false, escalation: null, needPlan: true, statusLog: [], failureCounts: new Map(), stop: false };
}

const BIG_BRAIN_SYSTEM = [
  "You are Player2's big brain: a co-op companion's planner. You NEVER act in the world directly — a fast small brain executes your plans while you think.",
  "Available planning knowledge: world_observe/world_map/world_find results you request, and web_search/web_fetch against the game's public wiki (a simulated offline copy) for world facts you cannot know (closures, schedules, immunities).",
  "You plan with game-agnostic primitives only: walk_to {x,y,mode}, interact {x,y,button,slot?} (walks next to the tile, faces it, presses the button), raw_input {steps:[{hold?,press?,ms}]}, wait {minutes}.",
  "Plans must keep the body busy for a while (several steps). If a past approach keeps failing, change the approach or wait — never hand back the same failing steps.",
  "Call submit_plan when ready. If the goal is already achieved, call submit_plan with an empty plan and approach \"done\".",
].join(" ");

async function bigBrain(ctx: RunContext, shared: Shared, web: WebSim, llmSmallBrain: boolean): Promise<void> {
  const messages: ChatMessage[] = [
    { role: "system", content: BIG_BRAIN_SYSTEM },
    { role: "user", content: `${ctx.task.goalText}\n\nThe small brain is idle. Plan the first approach. Button ids and world state come from your tools.` },
  ];

  const observe: DrivenTool = {
    name: "world_observe",
    description: "Look around the body (radius in tiles).",
    parameters: { radius: { type: "integer", description: "tiles around the body; up to 20" } },
    execute: async (args) => {
      const tools = bodyTools(ctx);
      const tool = tools.find((candidate) => candidate.name === "world_observe")!;
      return tool.execute({ radius: args.radius ?? 12 }, { callId: "bb-observe", signal: ctx.signal });
    },
  };
  const worldMap: DrivenTool = {
    name: "world_map",
    description: "The body's map, or a window around a tile.",
    parameters: { x: { type: "integer" }, y: { type: "integer" }, radius: { type: "integer", description: "up to 20" } },
    execute: async (args) => {
      const tools = bodyTools(ctx);
      const tool = tools.find((candidate) => candidate.name === "world_map")!;
      return tool.execute(args, { callId: "bb-map", signal: ctx.signal });
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
  const planningTools = [observe, worldMap, webSearch, webFetch];

  const digest = (): string => [
    llmSmallBrain ? `Directive in force: ${shared.directive || "(none)"}` : `Plan in force: ${shared.plan?.approach ?? "(none)"}; step ${shared.planIndex}/${shared.plan?.steps.length ?? 0}`,
    `Small-brain status since last planning session: ${shared.statusLog.slice(-14).join(" | ") || "(nothing)"}`,
    `Repeated failures by action: ${[...shared.failureCounts.entries()].filter(([, count]) => count > 0).map(([signature, count]) => `${signature} x${count}`).join(", ") || "none"}`,
    shared.escalated ? `ESCALATION: the small brain stopped after repeated failure (${shared.escalation}). Reflect: search the wiki if this could be world knowledge, then change the approach.` : "",
  ].filter((line) => line !== "").join("\n");

  const submitPlan: DrivenTool = {
    name: "submit_plan",
    description: "Hand a new plan down to the small brain. This ends the planning session; the big brain sleeps until the plan is exhausted, the small brain escalates, or the goal holds.",
    parameters: {
      type: "object",
      properties: {
        approach: { type: "string", description: "one line: what this plan tries and why it differs from what failed" },
        steps: {
          type: "array",
          description: "ordered primitives: {kind:'walk_to',x,y,mode?} | {kind:'interact',x,y,button,slot?} | {kind:'raw_input',steps:[{hold?,press?,ms}]} | {kind:'wait',minutes}",
          items: { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] },
        },
      },
      required: ["approach", "steps"],
    },
    execute: async (args) => {
      const steps = sanitizeSteps(args.steps);
      shared.plan = { approach: String(args.approach ?? "").slice(0, 200) || "unnamed approach", steps };
      shared.directive = shared.plan.approach;
      shared.planIndex = 0;
      shared.escalated = false;
      shared.escalation = null;
      shared.needPlan = steps.length === 0;
      shared.statusLog = [];
      return `plan handed down (${steps.length} steps); the small brain is acting; you sleep until it finishes or escalates`;
    },
  };

  for (;;) {
    if (ctx.signal.aborted || shared.stop) return;
    if (ctx.model.counters.calls >= ctx.task.maxModelCalls) { shared.stop = true; return; }
    const wake = [
      { role: "user" as const, content: `${digest()}\n\n${shared.needPlan || shared.escalated ? "Plan the next approach now (submit_plan)." : "Decide: if the goal is already achieved, submit an empty plan with approach \"done\"; otherwise you may submit a refreshed plan or wait for the small brain."}` },
    ];
    // One planning session: a few observe/search turns ending in submit_plan.
    let planned = false;
    const sessionMessages = [...messages, ...wake];
    for (let turn = 0; turn < 6 && !planned; turn++) {
      if (ctx.model.counters.calls >= ctx.task.maxModelCalls) { shared.stop = true; return; }
      const reply = await ctx.model.chat(sessionMessages, [...planningTools, submitPlan].map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), { maxTokens: 900 });
      sessionMessages.push({
        role: "assistant",
        content: reply.content ?? "",
        ...(reply.toolCalls.length === 0 ? {} : { tool_calls: reply.toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: JSON.stringify(call.args) } })) }),
      });
      if (reply.toolCalls.length === 0) {
        planned = true; // nothing to execute from prose; sleep and re-wake later
        break;
      }
      for (const call of reply.toolCalls) {
        const tool = [...planningTools, submitPlan].find((candidate) => candidate.name === call.name);
        let result = `no such tool: ${call.name}`;
        if (tool !== undefined) {
          try {
            result = await tool.execute(call.args, { callId: call.id, signal: ctx.signal });
          } catch (error) {
            result = `tool error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        ctx.log(`big-brain ${call.name} -> ${result.slice(0, 120).replace(/\n/g, " ")}`);
        sessionMessages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 4_000) });
        if (call.name === "submit_plan") planned = true;
      }
    }
    if (!planned) shared.needPlan = true;
    // Persist the planning session so the next wake keeps context; never let
    // the trimmed history start on an orphaned tool message.
    let keep = sessionMessages.length - 24;
    if (keep > 1) {
      while (keep < sessionMessages.length && sessionMessages[keep].role === "tool") keep++;
      sessionMessages.splice(1, keep - 1);
    }
    messages.length = 0;
    messages.push(...sessionMessages);

    // Sleep until the small brain needs attention.
    for (;;) {
      if (ctx.signal.aborted || shared.stop) return;
      if (shared.escalated || shared.needPlan) break;
      if (await ctx.goalCheck()) { shared.stop = true; return; }
      await sleep(150);
    }
  }
}

function sanitizeSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  const steps: PlanStep[] = [];
  for (const raw of value.slice(0, 12)) {
    if (typeof raw !== "object" || raw === null) continue;
    const step = raw as Record<string, unknown>;
    const kind = String(step.kind ?? "");
    if (kind === "walk_to" && typeof step.x === "number" && typeof step.y === "number") {
      steps.push({ kind: "walk_to", x: step.x, y: step.y, ...(step.mode === "adjacent" ? { mode: "adjacent" as const } : {}) });
    } else if (kind === "interact" && typeof step.x === "number" && typeof step.y === "number" && typeof step.button === "string") {
      steps.push({ kind: "interact", x: step.x, y: step.y, button: step.button, ...(typeof step.slot === "number" ? { slot: step.slot } : {}) });
    } else if (kind === "raw_input" && Array.isArray(step.steps)) {
      steps.push({ kind: "raw_input", steps: step.steps as { hold?: string[]; press?: string[]; ms: number }[] });
    } else if (kind === "wait" && typeof step.minutes === "number") {
      steps.push({ kind: "wait", minutes: Math.max(1, Math.min(600, step.minutes)) });
    }
  }
  return steps;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The code small brain: replays the plan's explicit steps; escalates after 3 same-signature failures. */
async function smallBrainCode(ctx: RunContext, shared: Shared): Promise<void> {
  const ctrl = await controls(ctx.port);
  while (!shared.stop && !ctx.signal.aborted) {
    if (await ctx.goalCheck()) { shared.stop = true; return; }
    const plan = shared.plan;
    if (plan === null || shared.needPlan || shared.escalated) {
      await sleep(100); // idle while the big brain thinks (deliberate, counted)
      continue;
    }
    if (shared.planIndex >= plan.steps.length) { shared.needPlan = true; continue; }
    const step = plan.steps[shared.planIndex++];
    const outcome = await executeStep(ctx, ctrl, step);
    shared.statusLog.push(`${step.kind}@${"x" in step ? `${(step as { x?: number }).x ?? ""},${(step as { y?: number }).y ?? ""}` : ""}: ${outcome.status}/${outcome.detail.slice(0, 60)}`);
    if (outcome.status !== "ok") {
      const count = (shared.failureCounts.get(outcome.signature) ?? 0) + 1;
      shared.failureCounts.set(outcome.signature, count);
      if (count >= 3) {
        shared.escalated = true;
        shared.escalation = `${outcome.signature} failed ${count}x (${outcome.detail.slice(0, 80)})`;
        ctx.noteRecovery(`small-brain escalation: ${shared.escalation}`);
      }
    }
    if (await ctx.goalCheck()) { shared.stop = true; return; }
  }
}

interface StepOutcome {
  status: "ok" | "fail";
  detail: string;
  signature: string;
}

async function executeStep(ctx: RunContext, ctrl: Controls, step: PlanStep): Promise<StepOutcome> {
  try {
    if (step.kind === "walk_to") {
      const result = await goto(ctx.port, ctrl, { x: step.x, y: step.y }, { mode: step.mode ?? "stand" });
      return { status: result.ok ? "ok" : "fail", detail: result.reason, signature: `walk:${step.x},${step.y}` };
    }
    if (step.kind === "interact") {
      const result = await faceAndPressRelaxed(ctx, ctrl, { x: step.x, y: step.y }, step.button, step.slot);
      return { status: result.ok ? "ok" : "fail", detail: result.detail, signature: `press:${step.button}@${step.x},${step.y}` };
    }
    if (step.kind === "raw_input") {
      const steps: BodyInputStep[] = step.steps.map((raw) => ({ ...(raw.hold !== undefined ? { hold: raw.hold } : {}), ...(raw.press !== undefined ? { press: raw.press } : {}), ms: raw.ms }));
      const result = await pressSteps(ctx.port, steps, ctx.signal);
      const failed = result.status !== "done";
      return { status: failed ? "fail" : "ok", detail: `${result.status}: ${result.events.map((event) => `${event.kind}:${event.detail}`).join("; ").slice(0, 100)}`, signature: `raw:${result.events[0]?.detail?.slice(0, 24) ?? steps.map((s) => [...(s.press ?? []), ...(s.hold ?? [])].join("+")).join("|")}` };
    }
    if (step.kind === "wait") {
      const deadline = Date.now() + step.minutes * 17;
      while (Date.now() < deadline && !ctx.signal.aborted) {
        await sleep(150);
        if (await ctx.goalCheck()) break;
      }
      return { status: "ok", detail: `waited ${step.minutes}m`, signature: `wait` };
    }
    return { status: "fail", detail: "unknown step kind", signature: "unknown" };
  } catch (error) {
    return { status: "fail", detail: error instanceof Error ? error.message : String(error), signature: "error" };
  }
}

/** faceAndPress that walks itself next to the tile first (the generic interact primitive). */
async function faceAndPressRelaxed(ctx: RunContext, ctrl: Controls, tile: { x: number; y: number }, button: string, slot?: number): Promise<{ ok: boolean; detail: string }> {
  const state = await ctx.port.state();
  const body = state.body;
  if (body !== null && Math.abs(body.x - tile.x) + Math.abs(body.y - tile.y) === 1) {
    return faceAndPress(ctx.port, ctrl, tile, button, slot, ctx.signal);
  }
  const walk = await goto(ctx.port, ctrl, tile, { mode: "adjacent" });
  if (!walk.ok) return { ok: false, detail: `cannot approach: ${walk.reason}` };
  return faceAndPress(ctx.port, ctrl, tile, button, slot, ctx.signal);
}

/** The cheap-model small brain: the big brain's directive + a minimal prompt pick each primitive. */
async function smallBrainLlm(ctx: RunContext, shared: Shared): Promise<void> {
  const SYSTEM = [
    "You are a fast game executor (the small brain). Pick ONE primitive per step to serve the directive.",
    "Return STRICT JSON: {\"kind\":\"walk_to\",\"x\":<int>,\"y\":<int>,\"mode\":\"stand\"|\"adjacent\"} | {\"kind\":\"interact\",\"x\":<int>,\"y\":<int>,\"button\":\"<id>\",\"slot\":<int?>} | {\"kind\":\"raw_input\",\"steps\":[{\"hold\":[...],\"press\":[...],\"ms\":<int>}]} | {\"kind\":\"wait\",\"minutes\":<int>} | {\"kind\":\"idle\"}.",
    "Rules: never repeat an action the status says failed 3 times; prefer walk_to toward the directive's target; interact needs the exact button id from the status; JSON only.",
  ].join(" ");
  let idles = 0;
  let actionsSinceDirective = 0;
  while (!shared.stop && !ctx.signal.aborted) {
    if (await ctx.goalCheck()) { shared.stop = true; return; }
    if (shared.needPlan || shared.escalated || shared.directive === "") {
      await sleep(100);
      continue;
    }
    if (ctx.model.counters.calls >= ctx.task.maxModelCalls) { shared.stop = true; return; }
    // The cheap-model small brain asks for a fresh directive when it keeps
    // idling or after a bounded stretch of work — the analog of the code
    // variant running out of plan steps.
    if (idles >= 2 || actionsSinceDirective >= 10) {
      shared.needPlan = true;
      idles = 0;
      actionsSinceDirective = 0;
      continue;
    }
    const state = await ctx.port.state();
    const body = state.body;
    const prompt = [
      `Directive from the big brain: ${shared.directive}`,
      `Body: ${body === null ? "none" : `at (${body.x},${body.y}) facing ${body.facing}, items ${body.items.map((item) => item.name).join("/")}`}`,
      `Day ${state.time.day}.`,
      `Last statuses: ${shared.statusLog.slice(-6).join(" | ") || "(none)"}`,
      `Repeated failures: ${[...shared.failureCounts.entries()].map(([signature, count]) => `${signature} x${count}`).join(", ") || "none"}`,
      "Next primitive (JSON only):",
    ].join("\n");
    try {
      const reply = await ctx.model.chat([{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], [], { maxTokens: 200 });
      const match = reply.content?.match(/\{[\s\S]*\}/);
      if (match === undefined || match === null) {
        shared.statusLog.push("small-brain: unparsable reply; idling");
        await sleep(300);
        continue;
      }
      const chosen = JSON.parse(match[0]) as Record<string, unknown>;
      if (chosen.kind === "idle") { idles++; await sleep(300); continue; }
      idles = 0;
      actionsSinceDirective++;
      const ctrl = await controls(ctx.port);
      const steps = sanitizeSteps([chosen]);
      if (steps.length === 0) { shared.statusLog.push("small-brain: invalid primitive; idling"); await sleep(300); continue; }
      const outcome = await executeStep(ctx, ctrl, steps[0]);
      shared.statusLog.push(`${steps[0].kind}: ${outcome.status}/${outcome.detail.slice(0, 60)}`);
      if (outcome.status !== "ok") {
        const count = (shared.failureCounts.get(outcome.signature) ?? 0) + 1;
        shared.failureCounts.set(outcome.signature, count);
        if (count >= 3) {
          shared.escalated = true;
          shared.escalation = `${outcome.signature} failed ${count}x (${outcome.detail.slice(0, 80)})`;
          ctx.noteRecovery(`small-brain escalation: ${shared.escalation}`);
        }
      }
      if (await ctx.goalCheck()) { shared.stop = true; return; }
    } catch {
      await sleep(300);
    }
  }
}

export async function runAsync(ctx: RunContext, options: { llmSmallBrain?: boolean } = {}): Promise<boolean> {
  const web = await WebSim.forScenario(ctx.task.scenario);
  const shared = newShared();
  void waitTool(ctx); // the small brain owns waiting; the big brain plans wait steps instead
  const big = bigBrain(ctx, shared, web, options.llmSmallBrain === true).catch((error) => { shared.stop = true; ctx.log(`big brain crashed: ${error instanceof Error ? error.message : String(error)}`); });
  const small = (options.llmSmallBrain === true ? smallBrainLlm(ctx, shared) : smallBrainCode(ctx, shared)).catch((error) => { shared.stop = true; ctx.log(`small brain crashed: ${error instanceof Error ? error.message : String(error)}`); });
  await Promise.all([big, small]);
  return ctx.signal.aborted ? false : await ctx.goalCheck();
}
