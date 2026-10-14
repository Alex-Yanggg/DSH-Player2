import { defineTool } from "@deepseek-ai/dsh-tools";
import type { BodyDeclaration, BodyInputStep, BodyItem, BodyState, BodyUntil, BodyWorld } from "@dsh-player2/contracts";
import type { BodyPort, BodyRun } from "./client.js";
import type { PersonaDice } from "./knobs.js";
import { runMelee } from "./reflex.js";
import { walkTo } from "./walk.js";

/**
 * What the goal lane hands the companion plugin (P2-0021 T21.4). The host owns
 * the goal record and budget; the plugin owns the model-facing tools.
 */
export interface GoalController {
  readonly goalId: string;
  readonly body: BodyPort;
  readonly dice: PersonaDice;
  /** Aborted when the player stops or replaces the goal. */
  readonly signal: AbortSignal;
  /** Whether cheat-class inputs are allowed right now (settings switch or spoken grant). */
  cheatsAllowed(): Promise<boolean>;
  note(text: string): Promise<void>;
  finish(status: "done" | "failed", summary: string): Promise<void>;
  /** Tool calls left in the engineering budget. */
  toolCallsLeft(): number;
  /** Counts one executed tool call against the budget. */
  toolCalled?(name: string): void;
}

export const GOAL_TOOL_NAMES = {
  observe: "world_observe",
  find: "world_find",
  map: "world_map",
  locations: "world_locations",
  walk: "body_walk_to",
  use: "body_use",
  input: "body_input",
  melee: "reflex_melee",
  say: "companion_say",
  note: "goal_note",
  finish: "goal_finish",
} as const;

const textOutput = { schema: { type: "string" }, render: (_args: unknown, value: unknown) => [{ type: "text" as const, text: String(value) }] } as const;

export function createGoalTools(goal: GoalController) {
  let declaration: BodyDeclaration | undefined;
  let world: BodyWorld | undefined;
  const limits = async () => (declaration ??= await goal.body.declaration()).limits;
  const loadWorld = async () => (world ??= await goal.body.world());
  const signalOpt = () => ({ signal: goal.signal });

  return [
    defineTool({
      name: GOAL_TOOL_NAMES.observe,
      description: "Look at the game right now: clock, your body (location, tile, toolbar, stamina), the player, things near you nearest first, characters and exits. Raw game state, no interpretation.",
      parameters: { radius: { type: "integer", description: "How many tiles around you to list things (default 10, max 40)." } },
      output: textOutput,
      execute: async (args) => renderObservation(await goal.body.state(), Math.min(40, Math.max(1, args.radius ?? 10))),
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.find,
      description: "Search everything exported in your current location by kind and/or name (case-insensitive substring), nearest to you first. Kinds include object, forage, dirt, tree, grass, clump, bush, item, machine.",
      parameters: {
        kind: { type: "string", description: "Exact kind, optional." },
        name: { type: "string", description: "Substring of the name or id, optional." },
        readyOnly: { type: "boolean", description: "Only crops/machines marked ready." },
        limit: { type: "integer", description: "Maximum results (default 20, max 80)." },
      },
      output: textOutput,
      execute: async (args) => {
        const state = await goal.body.state();
        const name = args.name?.toLowerCase();
        const origin = state.body ?? state.player;
        const hits = state.objects
          .filter((o) => (args.kind === undefined || o.kind === args.kind)
            && (name === undefined || o.name.toLowerCase().includes(name) || (o.id ?? "").toLowerCase().includes(name) || String(o.extra?.crop ?? "").toLowerCase().includes(name))
            && (args.readyOnly !== true || o.extra?.ready === true))
          .map((o) => ({ o, d: Math.abs(o.x - origin.x) + Math.abs(o.y - origin.y) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, Math.min(80, Math.max(1, args.limit ?? 20)));
        if (hits.length === 0) return `Nothing matching in ${state.map.location}${state.truncated.objects > 0 ? ` (${state.truncated.objects} far objects were not exported)` : ""}.`;
        return [`${hits.length} match(es) in ${state.map.location}, nearest first:`, ...hits.map(({ o, d }) => `- ${describeObject(o)} [${d} tiles]`)].join("\n");
      },
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.map,
      description: "Read the raw tile grid around a point of your current location, using the adapter's legend ('.' walkable, '#' blocked, '~' water, 'W' walk warp, 'D' door). Row labels are y, column header is x.",
      parameters: {
        x: { type: "integer", description: "Centre x (default: your tile)." },
        y: { type: "integer", description: "Centre y (default: your tile)." },
        radius: { type: "integer", description: "Half-size of the window (default 8, max 20)." },
      },
      output: textOutput,
      execute: async (args) => renderMap(await goal.body.state(), args.x, args.y, Math.min(20, Math.max(2, args.radius ?? 8))),
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.locations,
      description: "List the game's locations and how they connect (exits), from the exported world graph.",
      parameters: { near: { type: "string", description: "Only this location and its neighbours." } },
      output: textOutput,
      execute: async (args) => {
        const graph = await loadWorld();
        const rows = graph.locations
          .filter((l) => args.near === undefined || l.name === args.near || l.warps.some((w) => w.to === args.near))
          .map((l) => `- ${l.name}${l.displayName !== l.name ? ` (${l.displayName})` : ""}${l.outdoors ? ", outdoors" : ""}: exits to ${[...new Set(l.warps.map((w) => w.to))].join(", ") || "none"}`);
        return rows.length === 0 ? "No such location in the world graph." : rows.join("\n");
      },
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.walk,
      description: "Navigation helper: walk your body to a tile, across locations if needed. It plans a route on the exported map and plays it as held direction buttons, looking again after each leg. mode stand = stand on the tile; adjacent = stop next to it and face it (use before a tool or the action button on that tile). Reports honestly where you ended up.",
      parameters: {
        x: { type: "integer", required: true, description: "Target tile x." },
        y: { type: "integer", required: true, description: "Target tile y." },
        location: { type: "string", description: "Target location name (default: where you are)." },
        mode: { type: "string", enum: ["stand", "adjacent"], description: "Default stand." },
      },
      output: textOutput,
      execute: async (args) => {
        const result = await walkTo(goal.body, await limits(), loadWorld, { x: args.x, y: args.y, mode: args.mode === "adjacent" ? "adjacent" : "stand", ...(args.location ? { location: args.location } : {}) }, goal.signal);
        return `${result.ok ? "OK" : "NOT REACHED"}: ${result.reason}. Now at ${result.location ?? "?"} (${result.x ?? "?"},${result.y ?? "?"}) after ${result.legs} leg(s), ${Math.round(result.ms / 100) / 10} s.${eventsLine(result.events)}`;
      },
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.use,
      description: "Press a button with your body: UseTool (the selected tool on the faced tile), Action (harvest, plant the selected seed, pick up forage, open a door), or DropItem (drop the selected stack in front of you). Optionally walk next to tile x,y first, select a toolbar slot (1-12) and press several times. Reports what the game did and how your inventory changed.",
      parameters: {
        button: { type: "string", required: true, enum: ["UseTool", "Action", "DropItem"], description: "Which button." },
        x: { type: "integer", description: "Tile to act on (walk adjacent and face it first)." },
        y: { type: "integer", description: "Tile to act on." },
        slot: { type: "integer", description: "Toolbar slot to select first, 1-12." },
        times: { type: "integer", description: "Presses, 1-20 (default 1)." },
      },
      output: textOutput,
      execute: async (args) => {
        const before = await goal.body.state();
        if (args.x !== undefined && args.y !== undefined) {
          const walk = await walkTo(goal.body, await limits(), loadWorld, { x: args.x, y: args.y, mode: "adjacent" }, goal.signal);
          if (!walk.ok) return `Did not press ${args.button}: could not get next to (${args.x},${args.y}): ${walk.reason}.`;
        }
        const steps: BodyInputStep[] = [];
        if (args.slot !== undefined) steps.push({ press: [`Slot${Math.min(12, Math.max(1, args.slot))}`], ms: 0 });
        const gap = args.button === "UseTool" ? 350 : 150;
        for (let i = 0; i < Math.min(20, Math.max(1, args.times ?? 1)); i++) steps.push({ press: [args.button], ms: gap });
        const run = await goal.body.run(steps, signalOpt());
        return describeRun(run, before);
      },
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.input,
      description: "Raw input: play a sequence of steps on your body. Each step holds buttons (hold) for ms milliseconds and fires press buttons once at its start. Button ids come from the adapter's declaration (MoveUp/Right/Down/Left hold; FaceUp..., UseTool, Action, DropItem, Slot1-12, MenuUp/MenuDown/MenuConfirm/MenuClose press; cheat modifiers only while a cheat switch is on). until can stop early: blockedMs, monsterWithin (tiles), warped, arrive {location,x,y,radius}.",
      parameters: {
        steps: {
          type: "array", required: true, description: "1-64 steps.",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              hold: { type: "array", items: { type: "string" } },
              press: { type: "array", items: { type: "string" } },
              ms: { type: "integer", required: true },
            },
          },
        },
        until: { type: "object", additionalProperties: true, description: "Optional stop conditions." },
      },
      output: textOutput,
      execute: async (args) => {
        const decl = declaration ??= await goal.body.declaration();
        const cheatIds = new Set(decl.inputs.filter((input) => input.cheat === true).map((input) => input.id));
        const steps = args.steps as BodyInputStep[];
        if (steps.some((step) => [...(step.hold ?? []), ...(step.press ?? [])].some((id) => cheatIds.has(id))) && !await goal.cheatsAllowed()) {
          return "Refused: that sequence uses a cheat input and no cheat switch is on (settings switch off and the player has not allowed it in chat for this save).";
        }
        const before = await goal.body.state();
        const run = await goal.body.run(steps, { ...(args.until ? { until: args.until as BodyUntil } : {}), ...signalOpt() });
        return describeRun(run, before);
      },
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.melee,
      description: "Reflex script: fight nearby monsters with your weapon in a closed loop at the game's pace (face, swing, step in), until the time is up, the area is clear, or enough monsters are gone. You set the tactic; it reports swings, monsters gone and the measured loop latency.",
      parameters: {
        seconds: { type: "integer", description: "How long, 1-120 (default 20)." },
        chaseTiles: { type: "integer", description: "Chase monsters up to this far, 1-15 (default 6)." },
        targetKills: { type: "integer", description: "Stop after this many are gone (0 = no target)." },
      },
      output: textOutput,
      execute: async (args) => {
        const report = await runMelee(goal.body, await limits(), {
          seconds: Math.min(120, Math.max(1, args.seconds ?? 20)),
          chaseTiles: Math.min(15, Math.max(1, args.chaseTiles ?? 6)),
          targetKills: Math.max(0, args.targetKills ?? 0),
        }, goal.dice.hands(), `${goal.goalId}:melee`, goal.signal);
        return `Melee ended by ${report.endedBy}: ${report.detail}. Swings ${report.swings}, steps ${report.steps}, monsters gone ${report.monstersGone}. Loop latency: state age p50 ${report.stateAgeMs.p50} ms / p95 ${report.stateAgeMs.p95} ms; input accept p50 ${report.acceptMs.p50} ms / p95 ${report.acceptMs.p95} ms.`;
      },
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.say,
      description: "Say one line to the player in the game world (above your head, or on their screen when you are elsewhere). Your own words, in character.",
      parameters: { text: { type: "string", required: true, description: "At most 400 characters." } },
      output: textOutput,
      execute: async (args) => { await goal.body.say(args.text); return "Said."; },
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.note,
      description: "Keep a short note about your route for this goal (what you chose and why: plant or buy, where, what it cost). Notes carry across turns and days.",
      parameters: { text: { type: "string", required: true, description: "At most 240 characters." } },
      output: textOutput,
      execute: async (args) => { await goal.note(args.text.slice(0, 240)); return "Noted."; },
    }),
    defineTool({
      name: GOAL_TOOL_NAMES.finish,
      description: "End this goal. status done when it is achieved (check the state first), failed when it cannot be done or you decide to stop. summary is what you tell the player: the route you took (planted or bought, where, how much it cost) or honestly why it failed. It is said in the game.",
      parameters: {
        status: { type: "string", required: true, enum: ["done", "failed"] },
        summary: { type: "string", required: true, description: "At most 400 characters, in character." },
      },
      output: textOutput,
      execute: async (args) => {
        await goal.finish(args.status === "done" ? "done" : "failed", args.summary.slice(0, 400));
        return `Goal closed as ${args.status}.`;
      },
    }),
  ] as const;
}

/** The goal lane's standing policy. */
export function goalPolicyText(languageLine: string): string {
  return [
    "You are {{companion_name}}, {{companion_relationship_role}}. This lane is your hands: you are playing the game alongside the player, pursuing a goal they gave you.",
    "The player's request is your authorization. How you pursue it is your call, in character: spending, routes, risks and shortcuts are your choices. Nothing here asks you to check back first.",
    "You perceive the world only through world_* tools (raw game state) and act only through body_* and reflex_* tools (raw input: walking, the tool button, the action button). No tool knows what anything is for: you plan.",
    "Use what you know about the game. When you are unsure, use a web search tool if one is available; treat what you find as a hint and check it against the state, never as fact.",
    "Work in short loops: observe, plan, do one step, observe again. Prefer body_walk_to for travel and body_use for tools; fall back to body_input for anything else.",
    "Be honest: when something fails, is blocked, or the game refuses, say so plainly and adapt. Never claim progress the state does not show.",
    "Keep route notes with goal_note. When the goal is achieved, check the state, then call goal_finish done with a summary of your route. If it cannot be done, call goal_finish failed with the real reason. Do not loop on the same failing step.",
    "End each turn with one short plain sentence about where you are in the plan; the next turn continues from the state.",
    "Everything you say to the player (companion_say, the goal_finish summary) is heard in the game: say it as a person, with places by their in-game names, no coordinates, tool names or budgets.",
    "A paused game is the player stepping away, not a failure: when the state says paused, end the turn and wait; never close the goal because of it.",
    languageLine,
  ].join("\n");
}

function describeRun(run: BodyRun, before: BodyState): string {
  const after = run.state;
  const lines = [`Input ${run.status}${run.reason ? ` (${run.reason})` : ""}.${eventsLine(run.events)}`];
  if (after?.body && before.body) {
    const diff = inventoryDiff(before.body.items, after.body.items);
    if (diff !== "") lines.push(`Your toolbar changed: ${diff}.`);
    lines.push(`Stamina ${Math.round(after.body.stamina)}. Now at ${after.body.location} (${after.body.x},${after.body.y}) facing ${after.body.facing}.`);
  }
  if (after) {
    const diff = inventoryDiff(before.player.items, after.player.items);
    if (diff !== "") lines.push(`The player's inventory changed: ${diff}.`);
  }
  return lines.join(" ");
}

function eventsLine(events: readonly { kind: string; detail: string }[]): string {
  const shown = events.filter((e) => !["done", "running"].includes(e.kind)).slice(-8);
  return shown.length === 0 ? "" : ` Events: ${shown.map((e) => `${e.kind}: ${e.detail}`).join("; ")}.`;
}

export function inventoryDiff(before: readonly BodyItem[], after: readonly BodyItem[]): string {
  const count = (items: readonly BodyItem[]) => items.reduce((map, item) => map.set(item.name, (map.get(item.name) ?? 0) + item.stack), new Map<string, number>());
  const a = count(before);
  const b = count(after);
  const changes: string[] = [];
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    const delta = (b.get(name) ?? 0) - (a.get(name) ?? 0);
    if (delta !== 0) changes.push(`${name} ${delta > 0 ? "+" : ""}${delta}`);
  }
  return changes.join(", ");
}

function describeObject(o: BodyState["objects"][number]): string {
  const extra = o.extra ?? {};
  const bits: string[] = [];
  if (o.kind === "dirt") {
    if (extra.crop) bits.push(`crop ${String(extra.crop)} phase ${String(extra.phase)}/${String(Number(extra.phases) - 1)}${extra.ready ? " READY" : ""}${extra.dead ? " dead" : ""}`);
    else bits.push("empty");
    bits.push(extra.watered ? "watered" : "dry");
  }
  if (o.kind === "item" && extra.count) bits.push(`x${String(extra.count)}`);
  if (extra.ready === true && o.kind !== "dirt") bits.push("ready");
  if (extra.passable === false) bits.push("blocks");
  if (o.kind === "tree") bits.push(`stage ${String(extra.stage)}${extra.stump ? " stump" : ""}`);
  return `${o.name} (${o.kind}${o.id ? ` ${o.id}` : ""}) at (${o.x},${o.y})${bits.length ? `: ${bits.join(", ")}` : ""}`;
}

function itemsLine(items: readonly BodyItem[]): string {
  if (items.length === 0) return "empty";
  return items.map((item) => {
    const water = typeof item.extra?.waterLeft === "number" ? ` (water ${String(item.extra.waterLeft)}/${String(item.extra.capacity)})` : "";
    return `${item.slot + 1}: ${item.name}${item.stack > 1 ? ` x${item.stack}` : ""}${water}`;
  }).join("; ");
}

function menuLine(menu: NonNullable<NonNullable<BodyState["body"]>["menu"]>): string {
  if (menu.items.length === 0) return "Nothing for sale.";
  return `For sale: ${menu.items.map((item) => `#${item.index} ${item.name} ${item.price}g${item.stock === null ? "" : ` (${item.stock} left)`}${item.tradeItem ? ` + ${item.tradeItem}` : ""}`).join("; ")}.`;
}

export function renderObservation(state: BodyState, radius: number): string {
  const t = state.time;
  const clock = `${Math.floor(t.timeOfDay / 100) % 24}:${String(t.timeOfDay % 100).padStart(2, "0")}`;
  const lines = [`Day ${t.day} (${t.season} ${t.dayOfMonth}, year ${t.year}), ${clock}, ${t.weather}${state.paused ? ", game paused" : ""}.`];
  const self = state.body;
  if (self === null) lines.push("Your body is not in the world right now.");
  else lines.push(`You: ${self.location} (${self.x},${self.y}) facing ${self.facing}, stamina ${Math.round(self.stamina)}, selected slot ${self.selectedSlot + 1}. Toolbar: ${itemsLine(self.items)}.`);
  if (self?.menu) lines.push(`Open menu: ${self.menu.shopId} shop, cursor on #${self.menu.cursor}, wallet ${self.menu.money}g. ${menuLine(self.menu)}`);
  const p = state.player;
  lines.push(`Player ${p.name}: ${p.location} (${p.x},${p.y}), gold ${p.money}, health ${Math.round(p.health)}, stamina ${Math.round(p.stamina)}. Inventory: ${itemsLine(p.items)}.`);
  const origin = self ?? p;
  const near = state.objects
    .map((o) => ({ o, d: Math.abs(o.x - origin.x) + Math.abs(o.y - origin.y) }))
    .filter(({ d }) => d <= radius)
    .sort((a, b) => a.d - b.d);
  const shown = near.slice(0, 45);
  lines.push(near.length === 0 ? `Nothing within ${radius} tiles.` : `Within ${radius} tiles (${near.length}, nearest ${shown.length} shown):`);
  for (const { o } of shown) lines.push(`- ${describeObject(o)}`);
  const kinds = new Map<string, number>();
  for (const o of state.objects) kinds.set(o.kind, (kinds.get(o.kind) ?? 0) + 1);
  lines.push(`Whole location: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ") || "nothing"}${state.truncated.objects ? ` (+${state.truncated.objects} not exported)` : ""}.`);
  if (state.characters.length > 0) lines.push(`Characters: ${state.characters.map((c) => `${c.name} (${c.kind}${c.health !== undefined ? ` hp ${Math.round(c.health)}` : ""}) at (${c.x},${c.y})`).join("; ")}.`);
  const exits = new Map<string, string>();
  for (const w of state.warps) if (!exits.has(w.to)) exits.set(w.to, `${w.to} via ${w.kind === "walk" ? "walking to" : "the door at"} (${w.x},${w.y})`);
  lines.push(`Exits: ${[...exits.values()].join("; ") || "none"}.`);
  lines.push(`Map ${state.map.location} is ${state.map.width}x${state.map.height}; world_map shows the tiles.`);
  return lines.join("\n");
}

function renderMap(state: BodyState, cx: number | undefined, cy: number | undefined, radius: number): string {
  const x0 = Math.max(0, (cx ?? state.body?.x ?? state.player.x) - radius);
  const y0 = Math.max(0, (cy ?? state.body?.y ?? state.player.y) - radius);
  const x1 = Math.min(state.map.width - 1, x0 + 2 * radius);
  const y1 = Math.min(state.map.height - 1, y0 + 2 * radius);
  const overlay = new Map<string, string>();
  for (const o of state.objects) if (o.extra?.passable === false) overlay.set(`${o.x},${o.y}`, "o");
  if (state.body && state.body.location === state.map.location) overlay.set(`${state.body.x},${state.body.y}`, "@");
  if (state.player.location === state.map.location) overlay.set(`${state.player.x},${state.player.y}`, "P");
  const lines = [`${state.map.location} x ${x0}..${x1}, y ${y0}..${y1}. '@' you, 'P' player, 'o' blocking object.`];
  for (let y = y0; y <= y1; y++) {
    let row = "";
    for (let x = x0; x <= x1; x++) row += overlay.get(`${x},${y}`) ?? state.map.rows[y]?.[x] ?? " ";
    lines.push(`${String(y).padStart(3)} ${row}`);
  }
  return lines.join("\n");
}
