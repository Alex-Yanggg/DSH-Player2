import type { RunContext } from "./harness.ts";
import type { BenchState } from "./port.ts";
import { controls, faceAndPress, goto, pressSteps, type Controls } from "./capabilities.ts";
import { renderObservation } from "../../../../packages/dsh-companion-plugin/src/body/tools.ts";
import { planLeg } from "../../../../packages/dsh-companion-plugin/src/body/navigation.ts";
import type { BodyInputStep } from "@dsh-player2/contracts";

/**
 * The "behavior trees as data, authored and edited by the LLM" prototype, after
 * the llm-bt advocate's sketch: the model emits a BT as JSON (a small, fixed
 * node vocabulary over generic port actions and state predicates); a fixed
 * game-agnostic interpreter executes it. The interpreter statically validates
 * the tree (BTGenBot-style), evaluates fresh from the root each pass (per-item
 * done-conditions keep completed work from being redone), and re-authors the
 * tree through the model on persistent failure or an unmet goal round.
 */

type BtNode = Record<string, unknown>;
type Status = "success" | "failure";

const ACT_CALLS = ["walkTo", "guardedWalkTo", "input", "wait", "faceAndPress"];
export const COND_PATH = /^(body\.(x|y|health|facing|location|slot)|nearest\(monster\)(\.(dist|x|y))?|countObjects\([^)]*\)|items\.[A-Za-z ]+\.count|objects\[\d+,\d+\](\.(kind|extra\.[A-Za-z]+))?)$/;
const COND_OPS = ["==", "!=", ">", ">=", "<", "<=", "absent", "present"];

export function validateTree(node: BtNode, errors: string[] = [], path = "root"): string[] {
  const type = node.node;
  if (type === "seq" || type === "fallback") {
    const children = node.children;
    if (!Array.isArray(children) || children.length === 0) errors.push(`${path}: ${type} needs children`);
    else (children as BtNode[]).forEach((child, index) => validateTree(child, errors, `${path}/${index}`));
  } else if (type === "retry") {
    if (typeof node.n !== "number" || node.n < 1) errors.push(`${path}: retry needs n >= 1`);
    if (node.child === undefined) errors.push(`${path}: retry needs a child`);
    else validateTree(node.child as BtNode, errors, `${path}/retry`);
  } else if (type === "act") {
    if (!ACT_CALLS.includes(String(node.call))) errors.push(`${path}: unknown act call ${String(node.call)}`);
    if (typeof node.args !== "object" || node.args === null) errors.push(`${path}: act needs args`);
  } else if (type === "cond") {
    const check = node.check as { path?: string; op?: string } | undefined;
    if (check === undefined || typeof check.path !== "string" || !COND_PATH.test(check.path)) errors.push(`${path}: bad cond path ${JSON.stringify(check?.path)}`);
    if (check === undefined || !COND_OPS.includes(String(check.op))) errors.push(`${path}: bad cond op ${String(check?.op)}`);
  } else {
    errors.push(`${path}: unknown node type ${JSON.stringify(type)}`);
  }
  return errors;
}

function nearestMonster(state: BenchState): { x: number; y: number; dist: number } | undefined {
  const body = state.body;
  if (body === null) return undefined;
  let best: { x: number; y: number; dist: number } | undefined;
  for (const character of state.characters) {
    if (character.kind !== "monster") continue;
    const dist = Math.abs(character.x - body.x) + Math.abs(character.y - body.y);
    if (best === undefined || dist < best.dist) best = { x: character.x, y: character.y, dist };
  }
  return best;
}

export function evalPath(state: BenchState, rawPath: string): unknown {
  const path = rawPath.trim();
  const body = state.body;
  if (path.startsWith("body.")) {
    if (body === null) return undefined;
    const field = path.slice(5);
    if (field === "slot") return body.selectedSlot;
    if (field === "health") return body.health;
    return (body as unknown as Record<string, unknown>)[field];
  }
  const objectMatch = path.match(/^objects\[(\d+),(\d+)\](?:\.(kind|extra\.[A-Za-z]+))?$/);
  if (objectMatch !== null) {
    const object = state.objects.find((o) => o.x === Number(objectMatch[1]) && o.y === Number(objectMatch[2]));
    if (object === undefined) return undefined;
    if (objectMatch[3] === undefined) return object;
    if (objectMatch[3] === "kind") return object.kind;
    return object.extra?.[objectMatch[3].slice("extra.".length)];
  }
  if (path === "nearest(monster)") return nearestMonster(state);
  if (path.startsWith("nearest(monster).")) {
    const monster = nearestMonster(state);
    if (monster === undefined) return undefined;
    if (path.endsWith(".dist")) return monster.dist;
    if (path.endsWith(".x")) return monster.x;
    if (path.endsWith(".y")) return monster.y;
    return undefined;
  }
  const countMatch = path.match(/^countObjects\((.*)\)$/);
  if (countMatch !== null) {
    const filters = Object.fromEntries(
      countMatch[1].split(",").map((part) => part.split("=").map((piece) => piece.trim())).filter((pair) => pair.length === 2),
    ) as Record<string, string>;
    return state.objects.filter((object) =>
      (filters.kind === undefined || object.kind === filters.kind)
      && (filters.crop === undefined || object.extra?.crop === filters.crop)
      && (filters.watered === undefined || String(object.extra?.watered) === filters.watered)).length;
  }
  const itemMatch = path.match(/^items\.(.+)\.count$/);
  if (itemMatch !== null && body !== null) {
    return body.items.filter((item) => item.name === itemMatch[1]).reduce((sum, item) => sum + item.stack, 0);
  }
  return undefined;
}

function compare(value: unknown, op: string, expected: unknown): boolean {
  if (op === "absent") return value === undefined || value === null;
  if (op === "present") return value !== undefined && value !== null;
  if (value === undefined || value === null) return false;
  if (op === "==") return String(value) === String(expected);
  if (op === "!=") return String(value) !== String(expected);
  const numeric = typeof value === "number" ? value : Number(value);
  const target = typeof expected === "number" ? expected : Number(expected);
  if (Number.isNaN(numeric) || Number.isNaN(target)) return false;
  if (op === ">") return numeric > target;
  if (op === ">=") return numeric >= target;
  if (op === "<") return numeric < target;
  return numeric <= target;
}

const VOCAB_DOC = `Tree node vocabulary (JSON):
- {"node": "seq", "children": [...]}                          run children in order, all must succeed
- {"node": "fallback", "children": [...]}                     try children in order, stop at the first success
- {"node": "retry", "n": 2, "child": {...}}                   retry the child up to n times
- {"node": "act", "call": "walkTo", "args": {"x": 7, "y": 3, "mode": "stand"|"adjacent"}}   robust walk (plans around obstacles); "adjacent" stops next to the tile facing it; x/y may be the string "nearest(monster)"
- {"node": "act", "call": "guardedWalkTo", "args": {"x": 11, "y": 1}, "until": {"monsterWithin": 2}}   walk that bails out (counts as success) when a monster comes within N tiles
- {"node": "act", "call": "input", "args": {"steps": [{"press": ["Slot1"], "ms": 100}, {"press": ["ControllerX"], "ms": 120}]}}
- {"node": "act", "call": "faceAndPress", "args": {"x": 8, "y": 4, "slot": 1, "button": "ControllerX"}}   face the orthogonal-adjacent tile (x/y may be "nearest(monster)"), optionally select a toolbar slot (0-based), press a button
- {"node": "act", "call": "wait", "args": {"ms": 300}}
- {"node": "cond", "check": {"path": "...", "op": "==", "value": ...}}
Condition paths: body.x, body.y, body.health, body.facing, body.location, body.slot, objects[X,Y].kind, objects[X,Y].extra.watered, objects[X,Y].extra.crop, nearest(monster).dist, nearest(monster).x, nearest(monster).y, countObjects(kind=dirt, crop=Parsnip, watered=true), items.<Exact Name>.count
Ops: ==, !=, >, >=, <, <=, absent, present (absent/present fit nearest(monster)).
The tree re-evaluates from the root after each pass, so put completion conditions FIRST:
- whole-goal check first: seq[ fallback[ cond(goal done), work... ] ]
- several items (one per tile/object): a seq of fallbacks, ONE PER ITEM, each checking that item's own completion first:
  seq[ fallback[ cond(item1 done), work-item1 ], fallback[ cond(item2 done), work-item2 ], ... ]
Never list work branches for multiple items as siblings under ONE fallback: it stops at the first success and later items never run.`;

export async function authorTree(ctx: RunContext, previous?: { tree: string; error: string }): Promise<BtNode> {
  const declaration = await ctx.port.declaration();
  const observation = renderObservation(await ctx.port.state(), 14);
  const buttons = declaration.inputs.map((input) => `${input.id} (${input.kind}): ${input.description}`).join("\n  ");
  const user = [
    `Goal:\n${ctx.task.goalText}`,
    `\nCurrent observation:\n${observation}`,
    `\nDeclared buttons:\n  ${buttons}`,
    previous === undefined ? "" : `\nYour previous tree was:\n${previous.tree}\n\nIt failed with:\n${previous.error}\n\nWrite a corrected tree.`,
    `\n${VOCAB_DOC}`,
    ``,
    `Reply with ONLY the JSON tree object for the root node (no markdown fences, no commentary).`,
  ].filter((part) => part !== "").join("\n");
  const reply = await ctx.model.chat(
    [{ role: "system", content: "You author behavior trees as JSON data for a game-playing runtime. You reply with a JSON object only." }, { role: "user", content: user }],
    [],
    { maxTokens: 3_000 },
  );
  const text = (reply.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("{");
  if (start === -1) throw new Error(`no JSON in the reply: ${text.slice(0, 140)}`);
  const end = balancedEnd(text, start);
  if (end === -1) throw new Error(`unbalanced JSON in the reply: ${text.slice(0, 140)}`);
  return JSON.parse(text.slice(start, end + 1)) as BtNode;
}

/** Index of the `}` closing the object opened at `start`, honouring strings. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const ch = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function countNodes(node: BtNode): number {
  const children = [node.children, node.child].flat(2).filter((child) => child !== undefined) as BtNode[];
  return 1 + children.reduce((sum, child) => sum + countNodes(child), 0);
}

export async function runLlmBt(ctx: RunContext): Promise<boolean> {
  const trace: string[] = [];
  const inner: RunContext = { ...ctx, log: (line: string) => { if (line.startsWith("[bt]")) trace.push(line); ctx.log(line); } };
  const controlsRef = await controls(ctx.port);

  let tree: BtNode | undefined;
  let authorError: string | undefined;
  for (let attempt = 0; attempt < 2 && tree === undefined; attempt++) {
    try {
      tree = await authorTree(inner, authorError === undefined ? undefined : { tree: "(the previous reply was not parseable JSON)", error: authorError });
    } catch (error) {
      authorError = error instanceof Error ? error.message : String(error);
      ctx.noteRecovery(`authoring failed: ${authorError.slice(0, 120)}`);
    }
  }
  if (tree === undefined) return false;
  let errors = validateTree(tree);
  for (let repairs = 0; errors.length > 0 && repairs < 2; repairs++) {
    ctx.noteRecovery(`static validation failed: ${errors.slice(0, 2).join("; ")}`);
    tree = await authorTree(inner, { tree: JSON.stringify(tree), error: errors.join("\n") });
    errors = validateTree(tree);
  }
  if (errors.length > 0) { ctx.log(`tree still invalid: ${errors.join("; ")}`); return false; }
  ctx.log(`authored tree (${countNodes(tree)} nodes)`);

  let rootFailures = 0;
  for (let authors = 0; authors < 3; authors++) {
    const traceStart = trace.length;
    const ok = await runTree(inner, controlsRef, tree);
    const traceTail = trace.slice(traceStart).slice(-30).join("\n");
    if (ok) {
      if (await ctx.goalCheck()) return true;
      ctx.noteRecovery("goal round: the tree succeeded but the delegated goal is unmet; re-authoring");
      tree = await authorTree(inner, { tree: JSON.stringify(tree), error: `the tree ran to success but the delegated goal is still unmet. Likely a structural mistake (per-item work branches as fallback siblings stop after the first success — use seq for 'do each', fallback only for 'first that applies'). Runtime trace:\n${traceTail}` });
      errors = validateTree(tree);
      if (errors.length > 0) { ctx.log(`re-authored tree invalid: ${errors.join("; ")}`); return false; }
      continue;
    }
    // runTree already burned its 3 internal root passes; that is a full failure.
    rootFailures += 3;
    if (authors < 2) {
      ctx.noteRecovery("tree failed its root passes; re-authoring with the runtime trace");
      tree = await authorTree(inner, { tree: JSON.stringify(tree), error: `the tree kept failing. Runtime trace:\n${traceTail}` });
      errors = validateTree(tree);
      if (errors.length > 0) { ctx.log(`re-authored tree invalid: ${errors.join("; ")}`); return false; }
    }
  }
  return false;
}

async function runTree(ctx: RunContext, controlsRef: Controls, root: BtNode): Promise<boolean> {
  let rootFailures = 0;
  while (!ctx.signal.aborted && rootFailures < 3) {
    // Fresh evaluation each root pass: conditions are cheap, and per-item done-conds
    // (the recommended pattern) keep completed work from being redone.
    const status = await tick(ctx, controlsRef, root, "", new Set<string>(), new Set<string>());
    if (status === "success") return true;
    rootFailures++;
    ctx.log(`[bt] root pass failed (${rootFailures}/3)`);
  }
  return false;
}

async function tick(ctx: RunContext, controlsRef: Controls, node: BtNode, path: string, done: Set<string>, failed: Set<string>): Promise<Status> {
  if (ctx.signal.aborted) return "failure";
  const type = String(node.node);
  if (type === "cond") {
    const check = node.check as { path: string; op: string; value?: unknown };
    const value = evalPath(await ctx.port.state(), check.path);
    const ok = compare(value, check.op, check.value);
    ctx.log(`[bt] ${path} cond ${check.path} ${check.op} ${JSON.stringify(check.value ?? "")} -> ${value === undefined ? "absent" : JSON.stringify(value)} (${ok ? "ok" : "no"})`);
    return ok ? "success" : "failure";
  }
  if (type === "act") return act(ctx, controlsRef, node, path);
  if (type === "seq" || type === "fallback") {
    const children = (node.children ?? []) as BtNode[];
    for (let index = 0; index < children.length; index++) {
      const key = `${path}/${index}`;
      const memory = type === "seq" ? done : failed;
      if (memory.has(key)) continue;
      const status = await tick(ctx, controlsRef, children[index], key, done, failed);
      if (status === "success") {
        if (type === "seq") { done.add(key); failed.delete(key); continue; }
        done.add(key);
        return "success";
      }
      if (type === "fallback") { failed.add(key); done.delete(key); continue; }
      return "failure";
    }
    return type === "seq" ? "success" : "failure";
  }
  if (type === "retry") {
    const limit = Number(node.n);
    for (let attempt = 0; attempt < limit; attempt++) {
      const status = await tick(ctx, controlsRef, node.child as BtNode, `${path}/r${attempt}`, new Set<string>(), new Set<string>());
      if (status === "success") return "success";
    }
    return "failure";
  }
  return "failure";
}

/** Resolve act coordinates; "nearest(monster)" tracks the closest monster at call time. */
async function resolveTarget(ctx: RunContext, rawX: unknown, rawY: unknown): Promise<{ x: number; y: number } | undefined> {
  if (rawX === "nearest(monster)" || rawY === "nearest(monster)") {
    const monster = nearestMonster(await ctx.port.state());
    return monster === undefined ? undefined : { x: monster.x, y: monster.y };
  }
  const x = Number(rawX);
  const y = Number(rawY);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

async function act(ctx: RunContext, controlsRef: Controls, node: BtNode, path: string): Promise<Status> {
  const call = String(node.call);
  const args = (node.args ?? {}) as Record<string, unknown>;
  const until = node.until as { monsterWithin?: number } | undefined;
  if (call === "wait") {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(Number(args.ms ?? 200), 2_000)));
    ctx.log(`[bt] ${path} wait ${String(args.ms ?? 200)}ms`);
    return "success";
  }
  if (call === "input") {
    const steps = (args.steps ?? []) as BodyInputStep[];
    const run = await pressSteps(ctx.port, steps, ctx.signal);
    const events = run.events.map((event) => `${event.kind}: ${event.detail}`).join("; ").slice(0, 120);
    ctx.log(`[bt] ${path} input -> ${run.status} ${events}`);
    return run.status === "done" ? "success" : "failure";
  }
  const target = await resolveTarget(ctx, args.x, args.y);
  if (target === undefined) { ctx.log(`[bt] ${path} ${call}: unresolvable target`); return "failure"; }
  const { x, y } = target;
  const mode = args.mode === "adjacent" ? "adjacent" : "stand";
  if (call === "faceAndPress") {
    const result = await faceAndPress(ctx.port, controlsRef, target, String(args.button ?? "ControllerX"), args.slot === undefined ? undefined : Number(args.slot), ctx.signal);
    ctx.log(`[bt] ${path} faceAndPress(${x},${y}) -> ${result.detail.slice(0, 90)}`);
    return result.ok ? "success" : "failure";
  }
  if (call === "guardedWalkTo" || (call === "walkTo" && until?.monsterWithin !== undefined)) {
    const radius = until?.monsterWithin ?? 2;
    for (let leg = 0; leg < 6; leg++) {
      if (ctx.signal.aborted) return "failure";
      const state = await ctx.port.state();
      const body = state.body;
      if (body === null) return "failure";
      if (body.x === x && body.y === y) return "success";
      if (mode === "adjacent" && Math.abs(body.x - x) + Math.abs(body.y - y) === 1) return "success";
      const planned = planLeg(state, controlsRef, { tile: { x, y }, mode });
      if (planned === undefined) { ctx.log(`[bt] ${path} guardedWalkTo no path`); return "failure"; }
      const run = await ctx.port.run(planned.steps.slice(0, 64), { until: { blockedMs: 600, monsterWithin: radius }, signal: ctx.signal });
      if (run.status === "interrupted" && run.reason === "monster") { ctx.log(`[bt] ${path} guardedWalkTo interrupted by monster`); return "success"; }
      if (run.status === "interrupted" && run.reason === "blocked") continue;
      const after = run.state?.body;
      if (after != null && (after.x === x && after.y === y || (mode === "adjacent" && Math.abs(after.x - x) + Math.abs(after.y - y) === 1))) return "success";
    }
    return "failure";
  }
  const walk = await goto(ctx.port, controlsRef, { x, y }, { mode, signal: ctx.signal });
  ctx.log(`[bt] ${path} walkTo(${x},${y},${mode}) -> ${walk.ok ? "ok" : walk.reason.slice(0, 80)}`);
  return walk.ok ? "success" : "failure";
}
