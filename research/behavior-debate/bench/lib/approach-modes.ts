import type { RunContext } from "./harness.ts";
import type { BenchState } from "./port.ts";
import { controls, faceAndPress, goto, pressSteps, workTile, type Controls } from "./capabilities.ts";
import { planLeg } from "../../../../packages/dsh-companion-plugin/src/body/navigation.ts";
import { renderObservation } from "../../../../packages/dsh-companion-plugin/src/body/tools.ts";
import { evalPath, COND_PATH } from "./approach-llm-bt.ts";

/**
 * The "data-driven reflex/modes layer under the LLM" prototype, after the
 * modes advocate's sketch: the model (system 2) authors a small mode table as
 * JSON — priority-ordered entries whose `when`/`stopWhen` are predicates over
 * the exported state and whose `macro` names a procedure in a fixed, generic
 * macro library — and revises it on a mode-event digest when stuck. A fixed
 * selector (system 1) evaluates the table every ~150 ms between model turns,
 * keeps a mode sticky until its `stopWhen`, and lets a higher-priority mode
 * interrupt instantly. The model is never in the loop while the body acts.
 *
 * Mode table schema:
 *   { "doneWhen": { "all": [{ "path": "...", "op": ">=", "value": 6 }] },
 *     "modes": [ { "id": "...", "priority": 90,
 *                  "when":     { "all": [cond...] },
 *                  "macro":    "walkTo" | "guardedWalkTo" | "workRectTiles" | "faceAndPress" |
 *                              "retreatFromMonster" | "wait",
 *                  "params":   {...},
 *                  "stopWhen": { "all": [cond...] } } ] }
 * `when` defaults to always; `stopWhen` defaults to `when` no longer holding.
 */

export interface Cond { path: string; op: string; value?: unknown }
export type CondGroup = { all?: Cond[] } | Cond[];
export type MaybeGroup = CondGroup | undefined;
export interface ModeEntry {
  id: string;
  priority: number;
  when?: CondGroup;
  macro: string;
  params: Record<string, unknown>;
  stopWhen?: CondGroup;
}
export interface ModeTable {
  doneWhen: CondGroup;
  modes: ModeEntry[];
}

const MACROS = ["walkTo", "guardedWalkTo", "workRectTiles", "faceAndPress", "retreatFromMonster", "wait"];

/** Common spelling aliases the runtime accepts (documented ops are = =, !=, >, >=, <, <=, absent, present). */
const OP_ALIASES: Record<string, string> = {
  eq: "==", equals: "==", ne: "!=", neq: "!=", gt: ">", gte: ">=", ge: ">=", lt: "<", lte: "<=", le: "<=",
  exists: "present", has: "present", missing: "absent", "not-exists": "absent",
};
const normalizeOp = (op: string) => OP_ALIASES[op.toLowerCase()] ?? op;
const KNOWN_OPS = new Set(["==", "!=", ">", ">=", "<", "<=", "absent", "present", ...Object.keys(OP_ALIASES)]);

function evalCond(group: CondGroup | Cond[] | undefined, state: BenchState): boolean {
  const all = Array.isArray(group) ? group : group?.all;
  if (all === undefined || all.length === 0) return true;
  return all.every((cond) => {
    const value = evalPath(state, cond.path);
    const opName = normalizeOp(cond.op);
    const ops: Record<string, (a: unknown, b: unknown) => boolean> = {
      "==": (a, b) => String(a) === String(b),
      "!=": (a, b) => String(a) !== String(b),
      ">": (a, b) => Number(a) > Number(b),
      ">=": (a, b) => Number(a) >= Number(b),
      "<": (a, b) => Number(a) < Number(b),
      "<=": (a, b) => Number(a) <= Number(b),
      absent: (a) => a === undefined || a === null,
      present: (a) => a !== undefined && a !== null,
    };
    const op = ops[opName];
    if (op === undefined) return false;
    if (opName === "absent" || opName === "present") return op(value, undefined);
    if (value === undefined || value === null) return false;
    return op(value, cond.value);
  });
}

/** Accept both {"all":[...]} and a bare [...] condition list; null means malformed. */
function normalizeGroup(group: unknown): Cond[] | undefined | null {
  if (group === undefined) return undefined;
  if (Array.isArray(group)) return group as Cond[];
  if (typeof group === "object" && group !== null && Array.isArray((group as { all?: Cond[] }).all)) return (group as { all: Cond[] }).all;
  return null;
}

function checkConds(conds: Cond[], label: string): string[] {
  const errors: string[] = [];
  for (const cond of conds) {
    if (typeof cond.path !== "string" || typeof cond.op !== "string") {
      errors.push(`${label} condition needs path and op strings (got ${JSON.stringify(cond).slice(0, 80)})`);
      continue;
    }
    if (!KNOWN_OPS.has(cond.op)) errors.push(`${label} op "${cond.op}" is unknown (use ==, !=, >, >=, <, <=, absent, present)`);
    if (!COND_PATH.test(cond.path.trim())) errors.push(`${label} path is not in the grammar: ${cond.path} (use e.g. countObjects(kind=dirt, crop=Parsnip, watered=true), body.x, nearest(monster).dist)`);
  }
  return errors;
}

export function validateTable(table: unknown, extraMacros: string[] = []): string[] {
  const allowed = [...MACROS, ...extraMacros];
  const errors: string[] = [];
  const candidate = table as ModeTable;
  if (typeof candidate !== "object" || candidate === null) return ["not an object"];
  if (!Array.isArray(candidate.modes) || candidate.modes.length === 0) errors.push("modes must be a non-empty array");
  for (const mode of candidate.modes ?? []) {
    if (typeof mode.id !== "string" || mode.id.length === 0) errors.push("a mode has no id");
    if (typeof mode.priority !== "number") errors.push(`${mode.id}: priority must be a number`);
    if (mode.macro === undefined) errors.push(`${mode.id ?? "a mode"} is missing its "macro" field (one of: ${allowed.join(", ")})`);
    else if (!allowed.includes(mode.macro)) errors.push(`${mode.id}: unknown macro ${String(mode.macro)}`);
    if (typeof mode.params !== "object" || mode.params === null) errors.push(`${mode.id}: params must be an object`);
    for (const [label, group] of [["when", mode.when], ["stopWhen", mode.stopWhen]] as const) {
      const normalized = normalizeGroup(group);
      if (normalized === undefined) continue;
      if (normalized === null) { errors.push(`${mode.id}: ${label} must be {all: [conditions]} or [conditions]`); continue; }
      errors.push(...checkConds(normalized, `${mode.id}: ${label}`));
    }
  }
  const done = normalizeGroup(candidate.doneWhen);
  if (done === null) errors.push("doneWhen must be {all: [conditions]} or [conditions]");
  else if (done !== undefined) errors.push(...checkConds(done, "doneWhen"));
  return errors;
}

const TABLE_DOC = `Mode table schema (JSON):
{ "doneWhen": { "all": [ {"path": "...", "op": ">=", "value": 6} ] },
  "modes": [
    { "id": "unique-id", "priority": 90,
      "when":     { "all": [ conditions ] },
      "macro":    "...", "params": {...},
      "stopWhen": { "all": [ conditions ] } } ] }
- The selector checks modes by priority (higher first); a mode runs while its "when" holds (or its "stopWhen" has not met, making it sticky) unless a higher-priority mode's "when" fires — that one interrupts instantly.
- "when" omitted = always; "stopWhen" omitted = stop when "when" stops holding.
Condition paths: body.x, body.y, body.health, body.facing, body.location, body.slot, objects[X,Y].kind, objects[X,Y].extra.watered, objects[X,Y].extra.crop, nearest(monster).dist, nearest(monster).x, nearest(monster).y, countObjects(kind=dirt, crop=Parsnip, watered=true), items.<Exact Name>.count. Ops: ==, !=, >, >=, <, <=, absent, present.
Macros (params):
- walkTo {"x": n, "y": n, "mode": "stand"|"adjacent"} — robust walk; x/y may be "nearest(monster)"
- guardedWalkTo {"x": n, "y": n, "monsterWithin": 2} — walk that bails out (mode ends) when a monster comes within N tiles
- workRectTiles {"rect": {"x0": 7, "y0": 3, "x1": 9, "y1": 5}, "steps": [{"slot": 0, "button": "ControllerX"}, ...], "doneFilter": {"kind": "dirt", "crop": "Parsnip", "watered": true}} — for each tile in the rect not matching doneFilter, run every step (stand adjacent, select slot, press button); re-checks after each step
- faceAndPress {"x": "nearest(monster)", "slot": 0, "button": "ControllerX"} — face the orthogonal-adjacent tile, select a toolbar slot (0-based), press a button
- retreatFromMonster {"minDistanceTiles": 4} — step away until the nearest monster is at least N tiles away
- wait {"ms": 300}`;

export async function authorTable(ctx: RunContext, previous?: { table: string; error: string }): Promise<ModeTable> {
  const declaration = await ctx.port.declaration();
  const observation = renderObservation(await ctx.port.state(), 14);
  const buttons = declaration.inputs.map((input) => `${input.id} (${input.kind}): ${input.description}`).join("\n  ");
  const user = [
    `Goal:\n${ctx.task.goalText}`,
    `\nCurrent observation:\n${observation}`,
    `\nDeclared buttons:\n  ${buttons}`,
    previous === undefined ? "" : `\nYour previous mode table was:\n${previous.table}\n\nIt failed or got stuck with:\n${previous.error}\n\nWrite a corrected table.`,
    `\n${TABLE_DOC}`,
    ``,
    `Reply with ONLY the JSON mode table (no markdown fences, no commentary).`,
  ].filter((part) => part !== "").join("\n");
  const reply = await ctx.model.chat(
    [{ role: "system", content: "You author mode tables as JSON data for a game-playing reflex runtime. You reply with a JSON object only." }, { role: "user", content: user }],
    [],
    { maxTokens: 2_400 },
  );
  const text = (reply.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("{");
  if (start === -1) throw new Error(`no JSON in the reply: ${text.slice(0, 140)}`);
  let depth = 0;
  let end = -1;
  for (let index = start; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}") { depth--; if (depth === 0) { end = index; break; } }
  }
  if (end === -1) throw new Error(`unbalanced JSON: ${text.slice(0, 140)}`);
  return JSON.parse(text.slice(start, end + 1)) as ModeTable;
}

export async function runModes(ctx: RunContext): Promise<boolean> {
  const controlsRef = await controls(ctx.port);
  const fired = new Map<string, number>();
  let table: ModeTable | undefined;
  let authorError: string | undefined;
  for (let attempt = 0; attempt < 2 && table === undefined; attempt++) {
    try {
      table = await authorTable(ctx, authorError === undefined ? undefined : { table: "(unparseable)", error: authorError });
    } catch (error) {
      authorError = error instanceof Error ? error.message : String(error);
      ctx.noteRecovery(`table authoring failed: ${authorError.slice(0, 120)}`);
    }
  }
  if (table === undefined) return false;
  let errors = validateTable(table);
  for (let repairs = 0; errors.length > 0 && repairs < 2; repairs++) {
    ctx.noteRecovery(`table validation failed: ${errors.slice(0, 2).join("; ")}`);
    table = await authorTable(ctx, { table: JSON.stringify(table), error: errors.join("\n") });
    errors = validateTable(table);
  }
  if (errors.length > 0) { ctx.log(`mode table still invalid: ${errors.join("; ")}`); return false; }
  ctx.log(`authored mode table (${table.modes.length} modes: ${table.modes.map((mode) => mode.id).join(", ")})`);

  for (let revision = 0; revision < 3; revision++) {
    const macroResults: string[] = [];
    const outcome = await drive(ctx, controlsRef, table, fired, undefined, macroResults);
    if (outcome === "done") {
      if (await ctx.goalCheck()) return true;
      ctx.noteRecovery("goal round: the mode table reached doneWhen but the delegated goal is unmet; revising");
      table = await authorTable(ctx, { table: JSON.stringify(table), error: "the table reached its doneWhen but the delegated goal is still unmet — check your doneWhen conditions and mode coverage. Runtime digest follows." });
      if (validateTable(table).length > 0) return false;
      continue;
    }
    if (outcome === "budget") return false;
    ctx.noteRecovery(`selector stuck (${outcome}); revising the mode table`);
    table = await authorTable(ctx, {
      table: JSON.stringify(table),
      error: `the selector got stuck: ${outcome}. Mode-event digest: ${[...fired.entries()].map(([id, count]) => `${id} x${count}`).join(", ") || "no mode fired"}. Current observation:\n${renderObservation(await ctx.port.state(), 12)}`,
    });
    if (validateTable(table).length > 0) { ctx.log(`revised table invalid`); return false; }
  }
  return false;
}

export type SkillRunner = (name: string) => Promise<string>;

export async function drive(ctx: RunContext, controlsRef: Controls, table: ModeTable, fired: Map<string, number>, skillRunner?: SkillRunner, results?: string[]): Promise<"done" | "budget" | string> {
  let running: { modeId: string; cancel: AbortController; done: Promise<string> } | undefined;
  let idleTicks = 0;
  let macroFailures = 0;
  const stopMacro = () => { running?.cancel.abort(); running = undefined; };
  while (!ctx.signal.aborted) {
    const state = await ctx.port.state();
    if (evalCond(table.doneWhen, state)) { stopMacro(); return "done"; }
    if (state.body !== null && state.body.health <= 0) { stopMacro(); return "died"; }
    const active = [...table.modes]
      .filter((mode) => evalCond(mode.when, state))
      .sort((a, b) => b.priority - a.priority)[0];
    const currentMode = running === undefined ? undefined : table.modes.find((mode) => mode.id === running!.modeId);
    const keepRunning = running !== undefined && currentMode !== undefined
      && !evalCond(currentMode.stopWhen, state)
      && (active === undefined || currentMode.priority >= active.priority);

    if (keepRunning) { idleTicks = 0; await sleep(120); continue; }
    if (active !== undefined && (running === undefined || running.modeId !== active.id)) {
      if ((fired.get(active.id) ?? 0) >= 8) { stopMacro(); return `mode ${active.id} keeps re-firing without reaching doneWhen`; }
      stopMacro();
      fired.set(active.id, (fired.get(active.id) ?? 0) + 1);
      ctx.log(`[mode] ${active.id} engaged -> ${active.macro}(${JSON.stringify(active.params).slice(0, 80)})`);
      const cancel = new AbortController();
      const ctx2: RunContext = { ...ctx, signal: cancel.signal };
      const promise = runMacro(ctx2, controlsRef, active, skillRunner).finally(() => { if (running?.cancel === cancel) running = undefined; });
      running = { modeId: active.id, cancel, done: promise };
      // Only hard failures count against the table; "interrupted by monster" and
      // similar soft endings are the designed reactive outcomes, not failures.
      void promise.then((result) => { if (isHardFailure(result)) macroFailures++; if (results !== undefined && results.length < 40) results.push(`${active.id} -> ${result.slice(0, 110)}`); });
      idleTicks = 0;
      await sleep(120);
      continue;
    }
    if (running === undefined) {
      idleTicks++;
      if (idleTicks > 40) return "no mode applies and nothing runs";
      await sleep(120);
      continue;
    }
    await sleep(120);
    if (macroFailures >= 4) return "macros kept failing";
  }
  return "budget";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const HARD_FAILURES = ["walk failed", "no path", "cannot approach", "cornered", "threw", "unresolvable", "no body", "unknown macro", "skill check failed", "skill returned false"];
const isHardFailure = (result: string) => HARD_FAILURES.some((prefix) => result.startsWith(prefix));

function invert(_when: CondGroup | undefined, _stopWhen: CondGroup | undefined, _state: BenchState): boolean {
  return false;
}

export async function runMacro(ctx: RunContext, controlsRef: Controls, mode: ModeEntry, skillRunner?: SkillRunner): Promise<string> {
  const params = mode.params ?? {};
  const signal = ctx.signal;
  try {
    if (mode.macro === "skill") {
      if (skillRunner === undefined) return "unknown macro skill";
      return await skillRunner(String(params.name ?? ""));
    }
    switch (mode.macro) {
      case "wait":
        await sleep(Math.min(Number(params.ms ?? 300), 2_000));
        return "ok";
      case "walkTo": {
        const target = await resolveTarget(ctx, params.x, params.y);
        if (target === undefined) return "unresolvable target";
        const result = await goto(ctx.port, controlsRef, target, { mode: params.mode === "adjacent" ? "adjacent" : "stand", signal });
        return result.ok ? "ok" : `walk failed: ${result.reason.slice(0, 80)}`;
      }
      case "guardedWalkTo": {
        const target = await resolveTarget(ctx, params.x, params.y);
        if (target === undefined) return "unresolvable target";
        const radius = Number(params.monsterWithin ?? 2);
        for (let leg = 0; leg < 8 && !signal.aborted; leg++) {
          const state = await ctx.port.state();
          const body = state.body;
          if (body === null) return "no body";
          if (body.x === target.x && body.y === target.y) return "ok";
          const planned = planLeg(state, controlsRef, { tile: target, mode: params.mode === "adjacent" ? "adjacent" : "stand" });
          if (planned === undefined) return "no path";
          const run = await ctx.port.run(planned.steps.slice(0, 64), { until: { blockedMs: 600, monsterWithin: radius }, signal });
          if (run.status === "interrupted" && run.reason === "monster") return "interrupted by monster";
          if (run.status === "interrupted" && run.reason === "blocked") continue;
          const after = run.state?.body;
          if (after != null && (after.x === target.x && after.y === target.y || (params.mode === "adjacent" && Math.abs(after.x - target.x) + Math.abs(after.y - target.y) === 1))) return "ok";
        }
        return "gave up";
      }
      case "faceAndPress": {
        const target = await resolveTarget(ctx, params.x, params.y);
        if (target === undefined) return "unresolvable target";
        const state = await ctx.port.state();
        const body = state.body;
        if (body === null) return "no body";
        if (Math.abs(body.x - target.x) + Math.abs(body.y - target.y) !== 1) {
          const near = await goto(ctx.port, controlsRef, target, { mode: "adjacent", signal });
          if (!near.ok) return `cannot approach: ${near.reason.slice(0, 60)}`;
        }
        const result = await faceAndPress(ctx.port, controlsRef, target, String(params.button ?? "ControllerX"), params.slot === undefined ? undefined : Number(params.slot), signal);
        return result.ok ? "ok" : `press failed: ${result.detail.slice(0, 60)}`;
      }
      case "retreatFromMonster": {
        const minDistance = Number(params.minDistanceTiles ?? 4);
        for (let hop = 0; hop < 8 && !signal.aborted; hop++) {
          const state = await ctx.port.state();
          const body = state.body;
          const monster = state.characters.filter((c) => c.kind === "monster").sort((a, b) => (Math.abs(a.x - body!.x) + Math.abs(a.y - body!.y)) - (Math.abs(b.x - body!.x) + Math.abs(b.y - body!.y)))[0];
          if (body === null) return "no body";
          if (monster === undefined || Math.abs(monster.x - body.x) + Math.abs(monster.y - body.y) >= minDistance) return "ok";
          const dx = Math.sign(body.x - monster.x);
          const dy = Math.sign(body.y - monster.y);
          const candidates = dx !== 0 ? [{ x: body.x + dx * 2, y: body.y }, { x: body.x + dx * 4, y: body.y }] : [];
          candidates.push({ x: body.x, y: body.y + dy * 2 }, { x: body.x, y: body.y + dy * 4 });
          const walk = await goto(ctx.port, controlsRef, candidates[0], { signal });
          if (!walk.ok) {
            const second = await goto(ctx.port, controlsRef, candidates[1] ?? { x: body.x, y: body.y }, { signal });
            if (!second.ok) return "cornered";
          }
        }
        return "kept retreating";
      }
      case "workRectTiles": {
        const rect = params.rect as { x0: number; y0: number; x1: number; y1: number } | undefined;
        const steps = (params.steps ?? []) as { slot: number; button: string }[];
        const filter = (params.doneFilter ?? {}) as Record<string, string>;
        if (rect === undefined || steps.length === 0) return "workRectTiles needs rect and steps";
        const matches = (object: { kind: string; extra?: Record<string, unknown> }) =>
          (filter.kind === undefined || object.kind === filter.kind)
          && (filter.crop === undefined || object.extra?.crop === filter.crop)
          && (filter.watered === undefined || String(object.extra?.watered) === filter.watered);
        for (let y = rect.y0; y <= rect.y1 && !signal.aborted; y++) {
          for (let x = rect.x0; x <= rect.x1 && !signal.aborted; x++) {
            const state = await ctx.port.state();
            if (state.objects.some((object) => object.x === x && object.y === y && matches(object))) continue;
            for (const step of steps) {
              if (signal.aborted) return "stopped";
              const result = await workTile(ctx.port, controlsRef, { x, y }, step.slot, step.button, signal);
              ctx.log(`[mode] workRectTiles (${x},${y}) slot${step.slot} ${step.button} -> ${result.detail.slice(0, 80)}`);
            }
          }
        }
        return "ok";
      }
      default:
        return `unknown macro ${mode.macro}`;
    }
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function resolveTarget(ctx: RunContext, rawX: unknown, rawY: unknown): Promise<{ x: number; y: number } | undefined> {
  if (rawX === "nearest(monster)" || rawY === "nearest(monster)") {
    const state = await ctx.port.state();
    const body = state.body;
    if (body === null) return undefined;
    const monster = state.characters.filter((c) => c.kind === "monster").sort((a, b) => (Math.abs(a.x - body.x) + Math.abs(a.y - body.y)) - (Math.abs(b.x - body.x) + Math.abs(b.y - body.y)))[0];
    return monster === undefined ? undefined : { x: monster.x, y: monster.y };
  }
  const x = Number(rawX);
  const y = Number(rawY);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

