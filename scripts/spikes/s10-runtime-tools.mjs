// S10 (P2-0021): can DSH register and retire model-facing tools while a
// composition is live? Keyless: real cordis + dsh-tools registries, no model.
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";

const ctx = new Context();
await ctx.plugin(SystemPrompt);
await ctx.plugin(ToolRuntime);
let changes = 0;
ctx.on("tools/change", () => { changes++; });
const names = () => ctx.tools.schemas().map((schema) => schema.name).sort();
const tool = (name) => defineTool({
  name,
  description: `Declared by the adapter: ${name}.`,
  parameters: { durationMs: { type: "integer", required: true } },
  output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
  execute: async (args) => `${name} ${args.durationMs}`,
});

const before = names();
const disposeA = ctx.tools.register(tool("body_move_right"));
const afterA = names();
const disposeB = ctx.tools.register(tool("body_use_tool"));
const afterB = names();
const signal = new AbortController().signal;
const result = await ctx.tools.execute({ callId: ToolCallId("s10"), name: "body_use_tool", arguments: { durationMs: 120 }, signal });
disposeA();
const afterDispose = names();
disposeB();

assert.deepEqual(before, []);
assert.deepEqual(afterA, ["body_move_right"]);
assert.deepEqual(afterB, ["body_move_right", "body_use_tool"]);
assert.notEqual(result.isError, true);
assert.deepEqual(afterDispose, ["body_use_tool"]);
assert.ok(changes >= 4, `expected a tools/change per registration change, saw ${changes}`);
console.log(JSON.stringify({ spike: "S10", verdict: "pass", before, afterA, afterB, afterDispose, changes, result: result.content }));
