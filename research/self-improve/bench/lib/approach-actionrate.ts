import type { RunContext } from "./harness.ts";
import { bodyTools, drivenLoop, planSubmitTool } from "./driven.ts";

/**
 * Option (d): fewer model round-trips per action. The model plans a batch of
 * body-tool calls (the same tools it could call one at a time) and submits
 * them with plan_submit; a plugin-side executor runs them in order without
 * the model and returns one digest line per call, stopping on the first
 * failure. This is the bench stand-in for the DSH PTC seam
 * (`@deepseek-ai/dsh-ptc-runtime`: one model-written program, many tool
 * calls, one round-trip) plus the product's reflex tier keeping the body busy
 * while the model is not consulted.
 */

const SYSTEM = [
  "You are Player2, a co-op player companion in a game, working a delegated goal.",
  "Act through your tools: look with world_observe/world_map/world_find, move with body_walk_to (mode \"adjacent\" before working a tile), act with body_input.",
  "Raw body_input steps look like " + '{"hold":["DPadUp"],"ms":400} or {"press":["ControllerA"],"ms":50} — button ids come from body_controls.',
  "Work in batches: submit up to 8 planned tool calls at once with plan_submit (they run in order without waiting on you; the batch stops at the first failing call).",
  "Batch pattern: observe once, then plan the next several concrete actions (walk there, do the thing, walk on), then observe again. Verify after actions that matter.",
  "When the whole task is complete, reply with DONE alone.",
].join(" ");

export async function runActionRate(ctx: RunContext): Promise<boolean> {
  const tools = bodyTools(ctx);
  const plan = planSubmitTool(ctx, tools, { maxCalls: 8, stopOnFailure: true });
  return drivenLoop(ctx, { system: SYSTEM, tools: [...tools, plan] });
}
