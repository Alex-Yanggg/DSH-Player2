import { defineTool } from "@deepseek-ai/dsh-tools";
import type { BodyInputStep, BodyItem, BodyState, BodyUntil, BodyWorld } from "@dsh-player2/contracts";
import type { BodyPort, BodyRun } from "./port.js";
import { controlsOf, type Controls } from "./navigation.js";
import { walkTo } from "./walk.js";
import type { Gate } from "./plan.js";
import type { StuckWatch } from "./stuck.js";

/**
 * The companion's hands as DSH tools: raw perception, raw input on the body's
 * own controller, and the navigation helper built on them. Every call runs
 * under the caller's own cancellation, so a cancelled turn stops the body too.
 * The adapter itself refuses cheat inputs while no cheat switch is on.
 * Acting tools report to the stuck watch (P2-0020 T2): the same action on an
 * unchanged world is a wall, and the third one stops the body. They queue on
 * the plan gate, so the plan executor (T3) and the mind never pull at once.
 */
export interface BodyContext {
  readonly body: BodyPort;
  readonly watch?: StuckWatch;
  readonly gate?: Gate;
}

export const BODY_TOOL_NAMES = {
  observe: "world_observe",
  find: "world_find",
  map: "world_map",
  locations: "world_locations",
  walk: "body_walk_to",
  controls: "body_controls",
  input: "body_input",
} as const;

/** The output shape every body tool returns. */
export const textOutput = { schema: { type: "string" }, render: (_args: unknown, value: unknown) => [{ type: "text" as const, text: String(value) }] } as const;

export function createBodyTools(hands: BodyContext) {
  let controls: Controls | undefined;
  let world: BodyWorld | undefined;
  const controlsNow = async () => (controls ??= controlsOf(await hands.body.declaration()));
  const loadWorld = async () => (world ??= await hands.body.world());
  /** The acting tools queue on the plan gate, so the executor and the mind never pull at once. */
  const throughGate = <T>(work: () => Promise<T>): Promise<T> => hands.gate === undefined ? work() : hands.gate.run(work);
  return [
    defineTool({
      name: BODY_TOOL_NAMES.observe,
      description: "Look at the game right now: clock, your body (location, tile, toolbar, stamina), the player, things near you nearest first, characters and exits. Raw game state, no interpretation.",
      parameters: { radius: { type: "integer", description: "How many tiles around you to list things (default 10, max 40)." } },
      output: textOutput,
      execute: async (args) => renderObservation(await hands.body.state(), Math.min(40, Math.max(1, args.radius ?? 10))),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.find,
      description: "Search everything exported in your current location by kind and/or name (case-insensitive substring), nearest to you first. Kinds include object, forage, dirt, tree, grass, clump, bush, item, machine.",
      parameters: {
        kind: { type: "string", description: "Exact kind, optional." },
        name: { type: "string", description: "Substring of the name or id, optional." },
        readyOnly: { type: "boolean", description: "Only crops/machines marked ready." },
        limit: { type: "integer", description: "Maximum results (default 20, max 80)." },
      },
      output: textOutput,
      execute: async (args) => findObjects(await hands.body.state(), args),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.map,
      description: "Read the raw tile grid around a point of your current location, using the adapter's legend ('.' walkable, '#' blocked, '~' water, 'W' walk warp, 'D' door). Row labels are y, column header is x.",
      parameters: {
        x: { type: "integer", description: "Centre x (default: your tile)." },
        y: { type: "integer", description: "Centre y (default: your tile)." },
        radius: { type: "integer", description: "Half-size of the window (default 8, max 20)." },
      },
      output: textOutput,
      execute: async (args) => renderMapAround(await hands.body.state(), { ...args, radius: Math.min(20, Math.max(2, args.radius ?? 8)) }),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.locations,
      description: "List the game's locations and how they connect (exits), from the exported world graph.",
      parameters: { near: { type: "string", description: "Only this location and its neighbours." } },
      output: textOutput,
      execute: async (args) => locationsLine(await loadWorld(), args.near),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.walk,
      description: "Navigation helper: walk your body to a tile, across locations if needed. It plans a route on the exported map and plays it as held direction buttons, looking again after each leg. mode stand = stand on the tile; adjacent = stop next to it and face it (use before a tool or the action button on that tile). Reports honestly where you ended up.",
      parameters: {
        x: { type: "integer", required: true, description: "Target tile x." },
        y: { type: "integer", required: true, description: "Target tile y." },
        location: { type: "string", description: "Target location name (default: where you are)." },
        mode: { type: "string", enum: ["stand", "adjacent"], description: "Default stand." },
      },
      output: textOutput,
      execute: (args, exec) => throughGate(async () => {
        const before = await hands.body.state();
        const result = await walkTo(hands.body, await controlsNow(), loadWorld, { x: args.x, y: args.y, mode: args.mode === "adjacent" ? "adjacent" : "stand", ...(args.location ? { location: args.location } : {}) }, exec.signal);
        hands.watch?.record(BODY_TOOL_NAMES.walk, `${args.x},${args.y}@${args.location ?? ""}:${args.mode ?? "stand"}`, result.ok ? "ok" : `not reached (${result.reason})`, before, result.x === null ? undefined : await hands.body.state());
        return `${result.ok ? "OK" : "NOT REACHED"}: ${result.reason}. Now at ${result.location ?? "?"} (${result.x ?? "?"},${result.y ?? "?"}) after ${result.legs} leg(s), ${Math.round(result.ms / 100) / 10} s.${eventsLine(result.events)}`;
      }),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.controls,
      description: "Your controller: every button id, whether it is held or pressed, and what this game binds it to.",
      parameters: {},
      output: textOutput,
      execute: async () => (await hands.body.declaration()).inputs.map((i) => `- ${i.id} (${i.kind}${i.cheat ? ", cheat" : ""}): ${i.description}`).join("\n"),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.input,
      description: `Raw input on your own controller: play a sequence of steps. Each step holds buttons (hold) for ms milliseconds and fires press buttons once at its start. The game does what the buttons do for any farmer, menus included. until can stop early: blockedMs, monsterWithin (tiles), warped, arrive {location,x,y,radius}. Button ids: see ${BODY_TOOL_NAMES.controls}.`,
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
      execute: (args, exec) => throughGate(async () => {
        const before = await hands.body.state();
        const run = await hands.body.run(args.steps as BodyInputStep[], { ...(args.until ? { until: args.until as BodyUntil } : {}), signal: exec.signal });
        hands.watch?.record(BODY_TOOL_NAMES.input, stepsDigest(args.steps as BodyInputStep[]), run.status === "done" ? "ok" : `${run.status}${run.reason ? ` (${run.reason})` : ""}`, before, run.state);
        return describeRun(run, before);
      }),
    }),
  ] as const;
}

/** A stable short signature of one raw input sequence, so a resubmission matches. */
export function stepsDigest(steps: readonly BodyInputStep[]): string {
  const text = steps.map((s) => `${(s.hold ?? []).join("+")}|${(s.press ?? []).join("+")}|${s.ms}`).join(";").slice(0, 120);
  return `${steps.length} step(s): ${text}`;
}

/** The `world_find` search shared by the tools and the skill hands. */
export function findObjects(state: BodyState, args: { kind?: string; name?: string; readyOnly?: boolean; limit?: number }): string {
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
}

/** The `world_locations` rendering shared by the tools and the skill hands. */
export function locationsLine(graph: BodyWorld, near: string | undefined): string {
  const rows = graph.locations
    .filter((l) => near === undefined || l.name === near || l.warps.some((w) => w.to === near))
    .map((l) => `- ${l.name}${l.displayName !== l.name ? ` (${l.displayName})` : ""}${l.outdoors ? ", outdoors" : ""}: exits to ${[...new Set(l.warps.map((w) => w.to))].join(", ") || "none"}`);
  return rows.length === 0 ? "No such location in the world graph." : rows.join("\n");
}

/** What one submitted input sequence did, in plain facts; `before` adds the inventory/stamina diff. */
export function describeRun(run: BodyRun, before?: BodyState): string {
  const after = run.state;
  const lines = [`Input ${run.status}${run.reason ? ` (${run.reason})` : ""}.${eventsLine(run.events)}`];
  if (after?.body && before?.body) {
    const diff = inventoryDiff(before.body.items, after.body.items);
    if (diff !== "") lines.push(`Your toolbar changed: ${diff}.`);
    lines.push(`Stamina ${Math.round(after.body.stamina)}. Now at ${after.body.location} (${after.body.x},${after.body.y}) facing ${after.body.facing}.`);
  }
  if (after && before) {
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
  const stock = menu.stock === undefined ? "" : ` For sale: ${menu.stock.map((item) => `#${item.index} ${item.name} ${item.price}g${item.stock === null ? "" : ` (${item.stock} left)`}`).join("; ") || "nothing"}.`;
  return `Open menu: ${menu.kind}, cursor on ${menu.focus ?? "nothing"}, your gold ${menu.money}g. Buttons: ${menu.options.join(", ") || "none"}.${stock}`;
}

export function renderObservation(state: BodyState, radius: number): string {
  const t = state.time;
  const clock = `${Math.floor(t.timeOfDay / 100) % 24}:${String(t.timeOfDay % 100).padStart(2, "0")}`;
  const lines = [`Day ${t.day} (${t.season} ${t.dayOfMonth}, year ${t.year}), ${clock}, ${t.weather}${state.paused ? ", game paused" : ""}.`];
  const self = state.body;
  if (self === null) lines.push("Your body is not in the world right now.");
  else lines.push(`You: ${self.location} (${self.x},${self.y}) facing ${self.facing}, stamina ${Math.round(self.stamina)}, gold ${self.money}, selected slot ${self.selectedSlot + 1}. Toolbar: ${itemsLine(self.items)}.`);
  if (self?.menu) lines.push(menuLine(self.menu));
  const p = state.player;
  // Cabin ids look like "FarmHouse<guid>"; without this the model reads the host's FarmHouse as its own room.
  const apart = self !== null && self.location !== p.location ? ", a different place from you" : "";
  lines.push(`Player ${p.name}: ${p.location}${apart} (${p.x},${p.y}), gold ${p.money}, health ${Math.round(p.health)}, stamina ${Math.round(p.stamina)}. Inventory: ${itemsLine(p.items)}.`);
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

/** The `world_map` window shared by the tools and the skill hands; `radius` arrives clamped (2..20). */
export function renderMapAround(state: BodyState, args: { x?: number; y?: number; radius: number }): string {
  const x0 = Math.max(0, (args.x ?? state.body?.x ?? state.player.x) - args.radius);
  const y0 = Math.max(0, (args.y ?? state.body?.y ?? state.player.y) - args.radius);
  const x1 = Math.min(state.map.width - 1, x0 + 2 * args.radius);
  const y1 = Math.min(state.map.height - 1, y0 + 2 * args.radius);
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
