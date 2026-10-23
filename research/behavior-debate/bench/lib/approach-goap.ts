import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunContext } from "./harness.ts";
import type { BenchState } from "./port.ts";
import { controls, faceAndPress, goto, workTile, type Controls } from "./capabilities.ts";
import { planLeg } from "../../../../packages/dsh-companion-plugin/src/body/navigation.ts";
import { renderObservation } from "../../../../packages/dsh-companion-plugin/src/body/tools.ts";

/**
 * The "GOAP planner with LLM-produced goals" prototype, after the goap
 * advocate's sketch: a fixed, game-agnostic stack — a predicate extractor that
 * turns the raw body state into grounded facts using the domain's predicate
 * definitions, a planner over the domain's actions (backward chaining for
 * per-tile chains, forward BFS for inventory goals), and a plan runner that
 * re-checks preconditions before every step, executes operators through the
 * generic capability layer, applies the domain's interrupt policies, and
 * replans when the world violates the plan. The model's ONLY job is goal
 * translation: the player's words -> a goal spec in the domain's grammar (one
 * call, plus revisions on unmet goal rounds).
 *
 * The per-game part is the domain JSON (bench/domains/*.json): predicate
 * definitions over the exported state, actions with pre/add/del, and operator
 * bindings. The fixed stack never mentions parsnips or ladders.
 *
 * Porting history (counted in the report): the farm/mine stack needed three
 * additions for toy2 — the itemAtLeast predicate kind, the haveItems goal
 * kind with its forward BFS planner, and the pressAt operator — plus the
 * toy2 domain JSON. Those are the goap line of the porting-cost metric.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface PredicateDef {
  legend?: string;
  noObject?: boolean;
  objectKind?: string;
  extraKey?: string;
  test?: string;
  value?: unknown;
  monsterWithinTiles?: string;
  healthAtMost?: string;
  // [toy2-port]
  noObjectKind?: string;
  /** holds when the body's inventory has at least count of name. */
  itemAtLeast?: { name: string; count: number };
  // [/toy2-port]
}
interface ActionDef {
  id: string;
  cost: number;
  pre: string[];
  add: string[];
  del: string[];
  operator: { type: string; slot?: number; button?: string; monsterWithin?: number; minDistanceTiles?: number; anchorKind?: string };
  /** Domain data: what to do when this action's execution is interrupted, in order. */
  interrupt?: { when: string[]; action: string }[];
}
interface Domain {
  name: string;
  predicates: Record<string, PredicateDef>;
  actions: ActionDef[];
  goalChain: string[];
  // [toy2-port]
  /** door color -> the item name of the key that opens it. */
  doorKeys?: Record<string, string>;
  // [/toy2-port]
}

/** The LLM's goal-translation output: the same grammar for every game. */
interface GoalSpec {
  goalKind: "countInRect" | "reachTile"
  // [toy2-port]
  | "haveItems"
  // [/toy2-port]
  ;
  rect?: { x0: number; y0: number; x1: number; y1: number };
  count?: number;
  finalPredicate?: string;
  x?: number;
  y?: number;
  // [toy2-port]
  /** haveItems: collect these items; craft: also run the domain's Craft action. */
  items?: { name: string; count: number }[];
  craft?: boolean;
  // [/toy2-port]
}

function tileHolds(state: BenchState, def: PredicateDef, x: number, y: number): boolean {
  if (def.noObjectKind !== undefined) {
    const object = state.objects.find((o) => o.x === x && o.y === y);
    return object === undefined || object.kind !== def.noObjectKind;
  }
  const need = def.itemAtLeast;
  if (need !== undefined) {
    const held = state.body?.items.filter((item) => item.name === need.name).reduce((sum, item) => sum + item.stack, 0) ?? 0;
    return held >= need.count;
  }
  const object = state.objects.find((o) => o.x === x && o.y === y);
  if (def.objectKind !== undefined) {
    if (object === undefined || object.kind !== def.objectKind) return false;
    if (def.extraKey !== undefined) {
      const value = object.extra?.[def.extraKey];
      if (def.test === "present") return value !== undefined && value !== null;
      if (def.test === "==") return String(value) === String(def.value);
    }
    return true;
  }
  const row = state.map.rows[y];
  const legendOk = def.legend === undefined || row?.[x] === def.legend;
  const objectFree = def.noObject !== true || object === undefined;
  return legendOk && objectFree;
}

function parsePattern(pattern: string): { name: string; args: string[] } {
  const match = pattern.match(/^([a-z_]+)\(([^)]*)\)$/);
  if (match === null) return { name: pattern, args: [] };
  return { name: match[1], args: match[2].split(",").map((part) => part.trim()) };
}

function holds(state: BenchState, domain: Domain, pattern: string, x?: number, y?: number): boolean {
  const { name, args } = parsePattern(pattern);
  if (name === "not_planted" || name === "not_watered") {
    const base = name === "not_planted" ? "planted(x,y)" : "watered(x,y)";
    return !holds(state, domain, base, x, y);
  }
  const key = Object.keys(domain.predicates).find((candidate) => parsePattern(candidate).name === name);
  const def = key === undefined ? undefined : domain.predicates[key];
  if (def === undefined) return false;
  if (def.monsterWithinTiles !== undefined) {
    const body = state.body;
    if (body === null) return false;
    const n = Number.isFinite(Number(args[0])) ? Number(args[0]) : Number(def.monsterWithinTiles);
    return state.characters.some((c) => c.kind === "monster" && Math.abs(c.x - body.x) + Math.abs(c.y - body.y) <= n);
  }
  if (def.healthAtMost !== undefined) {
    const n = Number.isFinite(Number(args[0])) ? Number(args[0]) : Number(def.healthAtMost);
    return state.body !== null && state.body.health <= n;
  }
  if (def.itemAtLeast !== undefined) return tileHolds(state, def, 0, 0);
  const tx = x ?? Number(args[0]);
  const ty = y ?? Number(args[1]);
  return tileHolds(state, def, tx, ty);
}

interface PlanStep { action: ActionDef; x?: number; y?: number }

/** Backward-chaining planner for per-tile chains; BFS for inventory goals. */
function plan(state: BenchState, domain: Domain, goal: GoalSpec): PlanStep[] | undefined {
  const body = state.body;
  if (body === null) return undefined;
  const steps: PlanStep[] = [];
  if (goal.goalKind === "reachTile") {
    if (body.x === goal.x && body.y === goal.y) return []; // goal satisfied: empty plan = done
    const action = domain.actions.find((candidate) => candidate.operator.type === "guardedWalkTo");
    if (action === undefined) return undefined;
    steps.push({ action, x: goal.x, y: goal.y });
    return steps;
  }
  // [toy2-port]
  if (goal.goalKind === "haveItems") return planHaveItems(state, domain, goal);
  // [/toy2-port]
  const rect = goal.rect;
  if (rect === undefined || goal.finalPredicate === undefined) return undefined;
  const chain = domain.goalChain;
  const finalName = parsePattern(goal.finalPredicate).name;
  const satisfied = (x: number, y: number) => holds(state, domain, goal.finalPredicate!, x, y);
  const tiles: { x: number; y: number }[] = [];
  for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) tiles.push({ x, y });
  tiles.sort((a, b) => (Math.abs(a.x - body.x) + Math.abs(a.y - body.y)) - (Math.abs(b.x - body.x) + Math.abs(b.y - body.y)));
  const already = tiles.filter((tile) => satisfied(tile.x, tile.y)).length;
  const stillNeeded = Math.max(0, (goal.count ?? 1) - already);
  const needed = tiles.filter((tile) => !satisfied(tile.x, tile.y)).slice(0, stillNeeded);
  for (const tile of needed) {
    for (const pattern of chain) {
      if (holds(state, domain, pattern, tile.x, tile.y)) continue;
      if (parsePattern(pattern).name === finalName && satisfied(tile.x, tile.y)) continue;
      const action = domain.actions.find((candidate) => candidate.add.some((added) => parsePattern(added).name === parsePattern(pattern).name));
      if (action === undefined) return undefined;
      steps.push({ action, x: tile.x, y: tile.y });
    }
  }
  return steps;
}

// [toy2-port]
/**
 * Forward BFS over grounded actions (pick up, open door, craft) for inventory
 * goals, with a flood-fill reachability precondition (closed doors are
 * walls). Pickups and door openings never undo, so a visited-set on the fact
 * signature keeps the search small.
 */
function planHaveItems(state: BenchState, domain: Domain, goal: GoalSpec): PlanStep[] | undefined {
  const body = state.body;
  if (body === null) return undefined;
  const pick = domain.actions.find((action) => action.operator.type === "pressAt" && action.id.startsWith("Pick"));
  const open = domain.actions.find((action) => action.operator.type === "pressAt" && action.id.startsWith("Open"));
  const craft = domain.actions.find((action) => action.id === "Craft");
  if (pick === undefined) return undefined;

  interface SearchNode { held: Map<string, number>; opened: Set<string>; taken: Set<string>; steps: PlanStep[] }
  const heldOf = (node: SearchNode, name: string) => node.held.get(name) ?? 0;
  // A craft goal is met by holding the crafted artifact; the recipe items are
  // consumed by crafting, so requiring both is unsatisfiable.
  const goalMet = (node: SearchNode) =>
    goal.craft === true ? heldOf(node, "Crown") >= 1
      : (goal.items ?? []).every((item) => heldOf(node, item.name) >= item.count);

  const start: SearchNode = {
    held: new Map(body.items.map((item) => [item.name, item.stack] as const)),
    opened: new Set<string>(),
    taken: new Set<string>(),
    steps: [],
  };
  if (goalMet(start)) return [];
  // A node's world model: which objects are taken and which doors are opened.
  const signature = (node: SearchNode) => `${[...node.held.entries()].sort().map(([name, count]) => `${name}x${count}`).join(",")}|${[...node.taken].sort().join(",")}|${[...node.opened].sort().join(",")}`;

  /**
   * Procedural precondition (the goap advocate's "path existence" check): the
   * tiles the body can actually reach, flooding the exported map with closed
   * doors (and other impassable objects) as walls. A pickup needs its tile
   * reachable; opening a door needs a reachable orthogonal neighbour.
   */
  const reachable = (opened: Set<string>): Set<string> => {
    const tiles = new Set<string>();
    const blocked = (x: number, y: number): boolean => {
      const row = state.map.rows[y];
      if (row?.[x] !== ".") return true;
      const object = state.objects.find((o) => o.x === x && o.y === y);
      if (object !== undefined && object.extra?.passable === false) {
        return !(object.kind === "door" && opened.has(`${x},${y}`));
      }
      return false;
    };
    const queue = [[body.x, body.y]];
    tiles.add(`${body.x},${body.y}`);
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (tiles.has(key) || blocked(nx, ny)) continue;
        tiles.add(key);
        queue.push([nx, ny]);
      }
    }
    return tiles;
  };
  const canStandNextTo = (tiles: Set<string>, x: number, y: number): boolean =>
    [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => tiles.has(`${x + dx},${y + dy}`));

  const queue: SearchNode[] = [start];
  const seen = new Set([signature(start)]);
  while (queue.length > 0 && queue.length < 4_000) {
    const node = queue.shift()!;
    const tiles = reachable(node.opened);
    for (const object of state.objects) {
      if (object.kind === "door") {
        if (open === undefined || node.opened.has(`${object.x},${object.y}`)) continue;
        const keyName = object.extra?.color === undefined ? undefined : domain.doorKeys?.[String(object.extra.color)];
        if (keyName === undefined || heldOf(node, keyName) < 1) continue; // needs the right key first
        if (!canStandNextTo(tiles, object.x, object.y)) continue; // and a reachable side
        const next: SearchNode = { held: new Map(node.held), opened: new Set([...node.opened, `${object.x},${object.y}`]), taken: new Set(node.taken), steps: [...node.steps, { action: open, x: object.x, y: object.y }] };
        if (!seen.has(signature(next))) { seen.add(signature(next)); queue.push(next); }
        continue;
      }
      if (object.kind === "key" || object.kind === "material") {
        if (node.taken.has(`${object.x},${object.y}`)) continue; // already taken in this branch
        if (!canStandNextTo(tiles, object.x, object.y)) continue; // behind a closed door: not yet
        const next: SearchNode = { held: new Map(node.held), opened: new Set(node.opened), taken: new Set([...node.taken, `${object.x},${object.y}`]), steps: [...node.steps, { action: pick, x: object.x, y: object.y }] };
        next.held.set(object.name, heldOf(node, object.name) + 1);
        if (goalMet(next)) return next.steps;
        if (!seen.has(signature(next))) { seen.add(signature(next)); queue.push(next); }
      }
    }
    if (craft !== undefined && goal.craft === true) {
      const wood = heldOf(node, "Wood");
      const stone = heldOf(node, "Stone");
      if (wood >= 3 && stone >= 2) {
        const next: SearchNode = { held: new Map(node.held), opened: new Set(node.opened), taken: new Set(node.taken), steps: [...node.steps, { action: craft }] };
        next.held.set("Wood", wood - 3);
        next.held.set("Stone", stone - 2);
        next.held.set("Crown", heldOf(node, "Crown") + 1);
        if (goalMet(next)) return next.steps;
        if (!seen.has(signature(next))) { seen.add(signature(next)); queue.push(next); }
      }
    }
  }
  return undefined;
}
// [/toy2-port]

async function authorGoal(ctx: RunContext, domain: Domain, previous?: { spec: string; error: string }): Promise<GoalSpec> {
  const observation = renderObservation(await ctx.port.state(), 14);
  const user = [
    `Goal:\n${ctx.task.goalText}`,
    `\nCurrent observation:\n${observation}`,
    `\nDomain ${domain.name} actions: ${domain.actions.map((action) => action.id).join(", ")}`,
    `\nTranslate the goal into a goal spec. Grammar (JSON):`,
    `{"goalKind": "countInRect", "rect": {"x0": 7, "y0": 3, "x1": 9, "y1": 5}, "count": 6, "finalPredicate": "watered(x,y)"}   — make at least "count" tiles in the rect satisfy the final predicate`,
    `{"goalKind": "reachTile", "x": 11, "y": 1}   — stand on that tile`,
    // [toy2-port]
    `{"goalKind": "haveItems", "items": [{"name": "Wood", "count": 3}], "craft": true}   — hold these item counts (exact names from the observation); craft: true also crafts`,
    // [/toy2-port]
    previous === undefined ? "" : `\nYour previous translation was:\n${previous.spec}\n\nIt failed with:\n${previous.error}\n\nWrite a corrected spec.`,
    `\nReply with ONLY the JSON goal spec (no markdown fences, no commentary).`,
  ].filter((part) => part !== "").join("\n");
  const reply = await ctx.model.chat(
    [{ role: "system", content: "You translate a player's goal into a planner goal spec. You reply with a JSON object only." }, { role: "user", content: user }],
    [],
    { maxTokens: 400 },
  );
  const text = (reply.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`no JSON in the reply: ${text.slice(0, 120)}`);
  const spec = JSON.parse(text.slice(start, end + 1)) as GoalSpec;
  if (!["countInRect", "reachTile", "haveItems"].includes(spec.goalKind)) throw new Error(`bad goalKind: ${String(spec.goalKind)}`);
  return spec;
}

export async function runGoap(ctx: RunContext): Promise<boolean> {
  const controlsRef = await controls(ctx.port);
  const domain = JSON.parse(await readFile(path.join(ROOT, "domains", `${ctx.task.scenario}.json`), "utf8")) as Domain;

  let goal: GoalSpec | undefined;
  let authorError: string | undefined;
  for (let attempt = 0; attempt < 2 && goal === undefined; attempt++) {
    try {
      goal = await authorGoal(ctx, domain, authorError === undefined ? undefined : { spec: "(unparseable)", error: authorError });
    } catch (error) {
      authorError = error instanceof Error ? error.message : String(error);
      ctx.noteRecovery(`goal translation failed: ${authorError.slice(0, 120)}`);
    }
  }
  if (goal === undefined) return false;
  ctx.log(`translated goal: ${JSON.stringify(goal)}`);

  for (let revisions = 0; revisions < 3; revisions++) {
    const done = await drivePlan(ctx, controlsRef, domain, goal);
    if (done === "done") {
      if (await ctx.goalCheck()) return true;
      ctx.noteRecovery("goal round: the plan completed but the delegated goal is unmet; revising the goal spec");
      goal = await authorGoal(ctx, domain, { spec: JSON.stringify(goal), error: "the plan ran to completion but the delegated goal is still unmet — check the goal spec (rect, count, finalPredicate, items)" });
      continue;
    }
    if (done === "budget" || done === "died") return false;
    ctx.noteRecovery(`planner stuck: ${done}; revising the goal spec`);
    goal = await authorGoal(ctx, domain, { spec: JSON.stringify(goal), error: `the planner got stuck: ${done}` });
  }
  return false;
}

async function drivePlan(ctx: RunContext, controlsRef: Controls, domain: Domain, goal: GoalSpec): Promise<"done" | "budget" | "died" | string> {
  let replans = 0;
  while (!ctx.signal.aborted) {
    const state = await ctx.port.state();
    if (state.body !== null && state.body.health <= 0) return "died";
    const steps = plan(state, domain, goal);
    if (steps === undefined) return "no plan for the goal";
    if (steps.length === 0) return "done";
    const step = steps[0];
    ctx.log(`[goap] step ${step.action.id}${step.x !== undefined ? ` (${step.x},${step.y})` : ""} (plan ${steps.length} steps, replan #${replans})`);
    // Re-check preconditions (the planner built the plan from the same state, but keep the discipline visible).
    const preOk = step.action.pre.every((pattern) => {
      const { name, args } = parsePattern(pattern);
      if (name === "not_planted" || name === "not_watered") return !holds(state, domain, name === "not_planted" ? "planted(x,y)" : "watered(x,y)", step.x, step.y);
      if (args.length === 1 && /\d/.test(args[0])) return holds(state, domain, pattern);
      return holds(state, domain, pattern, step.x, step.y);
    });
    if (!preOk) { replans++; ctx.noteRecovery(`precondition of ${step.action.id} broke; replanning`); continue; }
    const result = await runOperator(ctx, controlsRef, step);
    if (result === "died") return "died";
    if (result === "interrupted") {
      const policies = step.action.interrupt ?? [];
      const stateNow = await ctx.port.state();
      const policy = policies.find((candidate) => candidate.when.every((pattern) => holds(stateNow, domain, pattern)));
      const reactive = policy === undefined ? undefined : domain.actions.find((action) => action.id === policy.action);
      if (reactive !== undefined) {
        ctx.log(`[goap] interrupt policy: ${reactive.id}`);
        const reactiveResult = await runOperator(ctx, controlsRef, { action: reactive });
        ctx.noteRecovery(`${step.action.id} interrupted -> ${reactive.id}`);
        if (reactiveResult === "died") return "died";
        replans++;
        if (replans > 20) return "too many replans";
        continue;
      }
      replans++;
      ctx.noteRecovery(`${step.action.id} interrupted; replanning`);
      continue;
    }
    // Verify the step's declared effect before calling it a success (tile effects only).
    const added = step.action.add.find((pattern) => parsePattern(pattern).name !== "at_ladder");
    if (added !== undefined && step.x !== undefined && step.y !== undefined && step.action.operator.type === "workTile") {
      const after = await ctx.port.state();
      if (!holds(after, domain, added, step.x, step.y)) {
        replans++;
        ctx.noteRecovery(`${step.action.id} did not achieve ${added}`);
        if (replans > 12) return `too many replans (${step.action.id} never achieves ${added})`;
        continue;
      }
    }
    if (result === "failed") { replans++; ctx.noteRecovery(`${step.action.id} failed; replanning`); if (replans > 12) return "too many replans"; continue; }
    if (replans > 20) return "too many replans";
  }
  return "budget";
}

async function runOperator(ctx: RunContext, controlsRef: Controls, step: PlanStep): Promise<"ok" | "failed" | "interrupted" | "died"> {
  const operator = step.action.operator;
  const signal = ctx.signal;
  if (operator.type === "workTile") {
    if (step.x === undefined || step.y === undefined) return "failed";
    const result = await workTile(ctx.port, controlsRef, { x: step.x, y: step.y }, operator.slot ?? 0, operator.button ?? "ControllerX", signal);
    ctx.log(`[goap]   -> ${result.detail.slice(0, 90)}`);
    return result.ok ? "ok" : "failed";
  }
  // [toy2-port]
  if (operator.type === "pressAt") {
    let tx = step.x;
    let ty = step.y;
    if (tx === undefined || ty === undefined) {
      // Craft-style press: anchor on the object kind the operator names.
      const state = await ctx.port.state();
      const anchor = state.objects.find((object) => object.kind === operator.anchorKind);
      if (anchor === undefined) return "failed";
      tx = anchor.x;
      ty = anchor.y;
    }
    const walk = await goto(ctx.port, controlsRef, { x: tx, y: ty }, { mode: "adjacent", signal });
    if (!walk.ok) return "failed";
    const fresh = await ctx.port.state();
    if (fresh.body === null || Math.abs(fresh.body.x - tx) + Math.abs(fresh.body.y - ty) !== 1) return "failed";
    const result = await faceAndPress(ctx.port, controlsRef, { x: tx, y: ty }, operator.button ?? "ControllerX", undefined, signal);
    ctx.log(`[goap]   pressAt(${tx},${ty}) -> ${result.detail.slice(0, 90)}`);
    return result.ok ? "ok" : "failed";
  }
  // [/toy2-port]
  if (operator.type === "guardedWalkTo") {
    if (step.x === undefined || step.y === undefined) return "failed";
    for (let leg = 0; leg < 8 && !signal.aborted; leg++) {
      const state = await ctx.port.state();
      const body = state.body;
      if (body === null) return "failed";
      if (body.x === step.x && body.y === step.y) return "ok";
      const planned = planLeg(state, controlsRef, { tile: { x: step.x, y: step.y }, mode: "stand" });
      if (planned === undefined) return "failed";
      const run = await ctx.port.run(planned.steps.slice(0, 64), { until: { blockedMs: 600, monsterWithin: operator.monsterWithin ?? 2 }, signal });
      if (run.status === "interrupted" && run.reason === "monster") return "interrupted";
      if (run.status === "interrupted" && run.reason === "blocked") continue;
      const after = run.state?.body;
      if (after != null && after.x === step.x && after.y === step.y) return "ok";
    }
    return "failed";
  }
  if (operator.type === "swingNearest") {
    const state = await ctx.port.state();
    const body = state.body;
    if (body === null) return "failed";
    const monster = state.characters.filter((c) => c.kind === "monster").sort((a, b) => (Math.abs(a.x - body.x) + Math.abs(a.y - body.y)) - (Math.abs(b.x - body.x) + Math.abs(b.y - body.y)))[0];
    if (monster === undefined) return "ok";
    if (Math.abs(monster.x - body.x) + Math.abs(monster.y - body.y) > 1) {
      const near = await goto(ctx.port, controlsRef, { x: monster.x, y: monster.y }, { mode: "adjacent", signal });
      if (!near.ok) return "failed";
    }
    const fresh = await ctx.port.state();
    const bodyNow = fresh.body;
    const target = fresh.characters.filter((c) => c.kind === "monster").sort((a, b) => (Math.abs(a.x - bodyNow!.x) + Math.abs(a.y - bodyNow!.y)) - (Math.abs(b.x - bodyNow!.x) + Math.abs(b.y - bodyNow!.y)))[0];
    if (target === undefined) return "ok";
    const result = await faceAndPress(ctx.port, controlsRef, { x: target.x, y: target.y }, operator.button ?? "ControllerX", operator.slot, signal);
    ctx.log(`[goap]   swing -> ${result.detail.slice(0, 90)}`);
    return result.ok ? "ok" : "failed";
  }
  if (operator.type === "retreat") {
    for (let hop = 0; hop < 8 && !signal.aborted; hop++) {
      const state = await ctx.port.state();
      const body = state.body;
      if (body === null) return "failed";
      const monster = state.characters.filter((c) => c.kind === "monster").sort((a, b) => (Math.abs(a.x - body.x) + Math.abs(a.y - body.y)) - (Math.abs(b.x - body.x) + Math.abs(b.y - body.y)))[0];
      if (monster === undefined || Math.abs(monster.x - body.x) + Math.abs(monster.y - body.y) >= (operator.minDistanceTiles ?? 5)) return "ok";
      const dx = Math.sign(body.x - monster.x);
      const dy = Math.sign(body.y - monster.y);
      const away = dx !== 0 ? { x: body.x + dx * 3, y: body.y } : { x: body.x, y: body.y + dy * 3 };
      const walk = await goto(ctx.port, controlsRef, away, { signal });
      if (!walk.ok) return "failed";
    }
    return "ok";
  }
  return "failed";
}
