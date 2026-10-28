import { defineTool } from "@deepseek-ai/dsh-tools";
import type { BodyInputStep, BodyItem, BodyState, BodyWorld } from "@dsh-player2/contracts";
import type { BodyPort } from "./port.js";

/**
 * The companion's perception as DSH tools: raw reads of the game state, the
 * controller's own vocabulary, and the exported world graph. The body is never
 * driven from here (P2-0019c): all body work goes through `plan_set`, so these
 * tools cannot act, only look.
 */

export const BODY_TOOL_NAMES = {
  observe: "world_observe",
  find: "world_find",
  map: "world_map",
  locations: "world_locations",
  controls: "body_controls",
} as const;

/** The output shape every body tool returns. */
export const textOutput = { schema: { type: "string" }, render: (_args: unknown, value: unknown) => [{ type: "text" as const, text: String(value) }] } as const;

export function createBodyTools(body: BodyPort) {
  return [
    defineTool({
      name: BODY_TOOL_NAMES.observe,
      description: "Look at the game right now: clock, your body (location, tile, toolbar, stamina), the player, things near you nearest first, characters and exits. Raw game state, no interpretation.",
      parameters: { radius: { type: "integer", description: "How many tiles around you to list things (default 10, max 40)." } },
      output: textOutput,
      execute: async (args) => renderObservation(await body.state(), Math.min(40, Math.max(1, args.radius ?? 10))),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.find,
      description: "Search everything exported in your current location by kind and/or name (case-insensitive substring), nearest to you first. Kinds include object, forage, dirt, tree, grass, clump, bush, item, machine, blocker (story blockers like the landslide before the mines, with a note).",
      parameters: {
        kind: { type: "string", description: "Exact kind, optional." },
        name: { type: "string", description: "Substring of the name or id, optional." },
        readyOnly: { type: "boolean", description: "Only crops/machines marked ready." },
        limit: { type: "integer", description: "Maximum results (default 20, max 80)." },
      },
      output: textOutput,
      execute: async (args) => findObjects(await body.state(), args),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.map,
      description: "Read the tile grid around a point of your current location. The answer starts with a legend of every character it uses: ground ('.' walkable, ',' ground a hoe can till, '#' blocked, '~' water, 'W' walk warp, 'D' door) with what stands on it drawn over it (crops, tilled soil, grass, trees, debris, story blockers, you and the player). Row labels are y.",
      parameters: {
        x: { type: "integer", description: "Centre x (default: your tile)." },
        y: { type: "integer", description: "Centre y (default: your tile)." },
        radius: { type: "integer", description: "Half-size of the window (default 8, max 20)." },
      },
      output: textOutput,
      execute: async (args) => renderMapAround(await body.state(), { ...args, radius: Math.min(20, Math.max(2, args.radius ?? 8)) }, (await body.declaration()).state.legend),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.locations,
      description: "List the game's locations and how they connect (exits), from the exported world graph.",
      parameters: { near: { type: "string", description: "Only this location and its neighbours." } },
      output: textOutput,
      execute: async (args) => locationsLine(await body.world(), args.near),
    }),
    defineTool({
      name: BODY_TOOL_NAMES.controls,
      description: "Your controller: every button id your plan steps can hold or press, and what this game binds it to.",
      parameters: {},
      output: textOutput,
      execute: async () => (await body.declaration()).inputs.map((i) => `- ${i.id} (${i.kind}${i.cheat ? ", cheat" : ""}): ${i.description}`).join("\n"),
    }),
  ] as const;
}

/** A stable short signature of one raw input sequence, so a resubmission matches. */
export function stepsDigest(steps: readonly BodyInputStep[]): string {
  const text = steps.map((s) => `${(s.hold ?? []).join("+")}|${(s.press ?? []).join("+")}|${s.ms}`).join(";").slice(0, 120);
  return `${steps.length} step(s): ${text}`;
}

/** The `world_find` search shared by the tools and the plan's reports. */
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

/** The `world_locations` rendering shared by the tools and the world graph. */
export function locationsLine(graph: BodyWorld, near: string | undefined): string {
  const rows = graph.locations
    .filter((l) => near === undefined || l.name === near || l.warps.some((w) => w.to === near))
    .map((l) => `- ${l.name}${l.displayName !== l.name ? ` (${l.displayName})` : ""}${l.outdoors ? ", outdoors" : ""}: exits to ${[...new Set(l.warps.map((w) => w.to))].join(", ") || "none"}`);
  return rows.length === 0 ? "No such location in the world graph." : rows.join("\n");
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
  if (typeof extra.width === "number" && typeof extra.height === "number" && extra.width * extra.height > 1) bits.push(`${extra.width}x${extra.height} tiles`);
  if (typeof extra.note === "string") bits.push(extra.note);
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
  if (state.actionTiles !== undefined && state.actionTiles.length > 0) {
    const tiles = [...state.actionTiles]
      .sort((a, b) => (Math.abs(a.x - origin.x) + Math.abs(a.y - origin.y)) - (Math.abs(b.x - origin.x) + Math.abs(b.y - origin.y)))
      .slice(0, 12)
      .map((tile) => `(${tile.x},${tile.y}) '${tile.action}'`);
    lines.push(`Tiles the game itself answers, raw${state.actionTiles.length > 12 ? ` (nearest 12 of ${state.actionTiles.length})` : ""}: ${tiles.join("; ")}.`);
  }
  lines.push(`Map ${state.map.location} is ${state.map.width}x${state.map.height}; world_map shows the tiles.`);
  return lines.join("\n");
}

/** Ground characters when the adapter declares no legend. */
const GROUND: Record<string, string> = {
  ".": "walkable",
  ",": "walkable ground a hoe can till",
  "#": "blocked (wall, building, cliff, or something listed in world_observe)",
  "~": "water",
  "W": "walk warp",
  "D": "door (face it and press the action button)",
};

/** What stands on a tile, drawn over the ground: the letter and its legend entry. */
function markOf(o: BodyState["objects"][number]): [string, string] | undefined {
  const extra = o.extra ?? {};
  switch (o.kind) {
    case "dirt":
      if (!extra.crop) return ["=", "tilled soil, empty"];
      return extra.ready ? ["$", "crop ready to harvest"] : ["*", "growing crop"];
    case "grass": return ['"', "grass (walkable; a hoe cannot till under it, cut it first)"];
    case "tree": return ["T", "tree"];
    case "clump": return ["C", "stump, log or boulder (several tiles)"];
    case "blocker": return ["X", "story blocker (world_find kind blocker says what it is)"];
    case "item": return ["i", "item lying on the ground"];
    default: return extra.passable === false ? ["o", "blocking object (stone, twig, weeds, machine...)"] : undefined;
  }
}

/** The `world_map` window shared by the tools; `radius` arrives clamped (2..20). */
export function renderMapAround(state: BodyState, args: { x?: number; y?: number; radius: number }, ground: Readonly<Record<string, string>> = GROUND): string {
  const x0 = Math.max(0, (args.x ?? state.body?.x ?? state.player.x) - args.radius);
  const y0 = Math.max(0, (args.y ?? state.body?.y ?? state.player.y) - args.radius);
  const x1 = Math.min(state.map.width - 1, x0 + 2 * args.radius);
  const y1 = Math.min(state.map.height - 1, y0 + 2 * args.radius);
  const overlay = new Map<string, string>();
  const marks = new Map<string, string>();
  for (const o of state.objects) {
    const mark = markOf(o);
    if (mark === undefined) continue;
    const w = typeof o.extra?.width === "number" ? o.extra.width : 1;
    const h = typeof o.extra?.height === "number" ? o.extra.height : 1;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const key = `${o.x + dx},${o.y + dy}`;
      // A blocking thing wins over grass or soil drawn on the same tile.
      if (!overlay.has(key) || o.extra?.passable === false) overlay.set(key, mark[0]);
    }
    marks.set(mark[0], mark[1]);
  }
  if (state.body && state.body.location === state.map.location) overlay.set(`${state.body.x},${state.body.y}`, "@");
  if (state.player.location === state.map.location) overlay.set(`${state.player.x},${state.player.y}`, "P");
  marks.set("@", "you").set("P", "player");
  const rows: string[] = [];
  const used = new Set<string>();
  for (let y = y0; y <= y1; y++) {
    let row = "";
    for (let x = x0; x <= x1; x++) row += overlay.get(`${x},${y}`) ?? state.map.rows[y]?.[x] ?? " ";
    for (const c of row) used.add(c);
    rows.push(`${String(y).padStart(3)} ${row}`);
  }
  const legend = [...used].filter((c) => c !== " ").map((c) => `'${c}' ${marks.get(c) ?? ground[c] ?? GROUND[c] ?? "?"}`);
  const named = state.objects
    .filter((o) => o.kind === "blocker" && o.x <= x1 && o.y <= y1 && o.x + (Number(o.extra?.width) || 1) > x0 && o.y + (Number(o.extra?.height) || 1) > y0)
    .map((o) => `${o.name} at (${o.x},${o.y})${o.extra?.note ? `: ${String(o.extra.note)}` : ""}`);
  return [
    `${state.map.location} x ${x0}..${x1}, y ${y0}..${y1}. Legend: ${legend.join(", ")}.`,
    ...(named.length > 0 ? [`Blockers here: ${named.join("; ")}.`] : []),
    `    ${columnHeader(x0, x1)}`,
    ...rows,
  ].join("\n");
}

/** The x of every fifth column, so a tile can be read off the window. */
function columnHeader(x0: number, x1: number): string {
  const header = Array.from({ length: x1 - x0 + 1 }, () => " ");
  for (let x = x0; x <= x1; x++) {
    if (x % 5 !== 0) continue;
    const label = String(x);
    if (x - x0 + label.length > header.length || header.slice(x - x0, x - x0 + label.length).some((c) => c !== " ")) continue;
    for (let i = 0; i < label.length; i++) header[x - x0 + i] = label[i]!;
  }
  return header.join("").trimEnd();
}
