import type { BodyDeclaration, BodyInputStep, BodyState, BodyWarp, BodyWorld } from "@dsh-player2/contracts";

/**
 * Navigation helper library (P2-0021 T21.3). It lives on the plugin side, not
 * in the game mod: it reads the exported map and turns a route into a timed
 * sequence of held direction buttons. It is a helper the companion chooses to
 * use, not a semantic "walk to" the adapter understands.
 */

export interface Tile { readonly x: number; readonly y: number }
export type Direction = "up" | "right" | "down" | "left";

const DELTAS: Record<Direction, Tile> = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const BUTTONS: Record<Direction, string> = { up: "MoveUp", right: "MoveRight", down: "MoveDown", left: "MoveLeft" };
const FACE: Record<Direction, string> = { up: "FaceUp", right: "FaceRight", down: "FaceDown", left: "FaceLeft" };

export const moveButton = (direction: Direction) => BUTTONS[direction];
export const faceButton = (direction: Direction) => FACE[direction];

/** Characters of `map.rows` a body can stand on. */
const WALKABLE = new Set([".", "W"]);

/** Tiles blocked in this state: the grid plus every impassable object on top of it. */
export class Walkability {
  private readonly blocked = new Set<string>();
  public readonly width: number;
  public readonly height: number;

  public constructor(private readonly state: BodyState, extraBlocked: readonly Tile[] = []) {
    this.width = state.map.width;
    this.height = state.map.height;
    for (const object of state.objects) {
      if (object.extra?.passable === false) {
        const width = typeof object.extra.width === "number" ? object.extra.width : 1;
        const height = typeof object.extra.height === "number" ? object.extra.height : 1;
        for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) this.blocked.add(key(object.x + dx, object.y + dy));
      }
    }
    for (const character of state.characters) {
      if (character.kind !== "farmer") this.blocked.add(key(character.x, character.y));
    }
    for (const tile of extraBlocked) this.blocked.add(key(tile.x, tile.y));
  }

  public inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  public walkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const row = this.state.map.rows[y];
    return row !== undefined && WALKABLE.has(row[x] ?? "#") && !this.blocked.has(key(x, y));
  }

  /** The body's own tile always counts as walkable (it is standing there). */
  public walkableFrom(start: Tile, x: number, y: number): boolean {
    return (x === start.x && y === start.y) || this.walkable(x, y);
  }
}

/** A* over 4-neighbour tiles. Returns the tile path including start and goal, or undefined. */
export function findPath(walk: Walkability, start: Tile, goals: readonly Tile[], maxNodes = 40_000): Tile[] | undefined {
  const goalSet = new Set(goals.filter((goal) => walk.walkableFrom(start, goal.x, goal.y)).map((goal) => key(goal.x, goal.y)));
  if (goalSet.size === 0) return undefined;
  const goalList = [...goalSet].map(parse);
  const h = (x: number, y: number) => Math.min(...goalList.map((goal) => Math.abs(goal.x - x) + Math.abs(goal.y - y)));
  const open = new MinHeap();
  const came = new Map<string, string>();
  const cost = new Map<string, number>([[key(start.x, start.y), 0]]);
  open.push(h(start.x, start.y), key(start.x, start.y));
  let expanded = 0;
  while (open.size > 0 && expanded++ < maxNodes) {
    const current = open.pop()!;
    if (goalSet.has(current)) return rebuild(came, current);
    const { x, y } = parse(current);
    const base = cost.get(current)!;
    for (const delta of Object.values(DELTAS)) {
      const nx = x + delta.x;
      const ny = y + delta.y;
      if (!walk.walkableFrom(start, nx, ny)) continue;
      const next = key(nx, ny);
      const tentative = base + 1;
      if (tentative < (cost.get(next) ?? Infinity)) {
        cost.set(next, tentative);
        came.set(next, current);
        open.push(tentative + h(nx, ny), next);
      }
    }
  }
  return undefined;
}

/** Direction from one tile to an adjacent one. */
export function directionTo(from: Tile, to: Tile): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

/** The walkable tiles next to a target, nearest to `from` first. */
export function neighbours(target: Tile, from: Tile): Tile[] {
  return Object.values(DELTAS)
    .map((delta) => ({ x: target.x + delta.x, y: target.y + delta.y }))
    .sort((a, b) => (Math.abs(a.x - from.x) + Math.abs(a.y - from.y)) - (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)));
}

/**
 * Turns a tile path into held direction steps. Straight runs collapse into
 * one hold; a run's duration is exactly the ticks needed to cross its tiles
 * at the declared walking speed. Long runs split at the adapter's step limit.
 */
export function pathToSteps(path: readonly Tile[], limits: BodyDeclaration["limits"]): BodyInputStep[] {
  const steps: BodyInputStep[] = [];
  const ticksPerTile = Math.round(limits.tilePx / limits.walkPxPerTick);
  let index = 1;
  while (index < path.length) {
    const direction = directionTo(path[index - 1], path[index]);
    let run = 1;
    while (index + run < path.length && directionTo(path[index + run - 1], path[index + run]) === direction) run++;
    let remaining = run;
    const maxTiles = Math.max(1, Math.floor(limits.maxStepMs / (ticksPerTile * limits.tickMs)));
    while (remaining > 0) {
      const tiles = Math.min(remaining, maxTiles);
      steps.push({ hold: [BUTTONS[direction]], ms: Math.round(tiles * ticksPerTile * limits.tickMs) });
      remaining -= tiles;
    }
    index += run;
  }
  return steps;
}

/** Milliseconds a body needs to walk `tiles` tiles. */
export function walkMs(tiles: number, limits: BodyDeclaration["limits"]): number {
  return Math.round(tiles * Math.round(limits.tilePx / limits.walkPxPerTick) * limits.tickMs);
}

/** One hop of a cross-location route. */
export interface RouteHop { readonly from: string; readonly warp: BodyWarp }

/** Breadth-first location route over the exported warp graph. */
export function locationRoute(world: BodyWorld, from: string, to: string): RouteHop[] | undefined {
  if (from === to) return [];
  const graph = new Map(world.locations.map((location) => [location.name, location.warps]));
  const previous = new Map<string, RouteHop>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const warp of graph.get(current) ?? []) {
      if (seen.has(warp.to)) continue;
      seen.add(warp.to);
      previous.set(warp.to, { from: current, warp });
      if (warp.to === to) {
        const hops: RouteHop[] = [];
        let cursor = to;
        while (cursor !== from) {
          const hop = previous.get(cursor)!;
          hops.unshift(hop);
          cursor = hop.from;
        }
        return hops;
      }
      queue.push(warp.to);
    }
  }
  return undefined;
}

/**
 * Plans the input for one leg of a walk inside the body's current location.
 * A walk warp past the map edge is reached by walking to the edge tile and
 * holding the outward direction; an action warp (door) by walking next to it,
 * facing it and pressing Action. Returns undefined when no path exists.
 */
export function planLeg(state: BodyState, limits: BodyDeclaration["limits"], target: { tile: Tile; mode: "stand" | "adjacent" | "walk-warp" | "action-warp" }, extraBlocked: readonly Tile[] = []): { steps: BodyInputStep[]; path: Tile[] } | undefined {
  const body = state.body;
  if (body === null) return undefined;
  const start = { x: body.x, y: body.y };
  const walk = new Walkability(state, extraBlocked);
  const t = target.tile;
  if (target.mode === "stand") {
    const path = findPath(walk, start, [t]);
    return path === undefined ? undefined : { steps: pathToSteps(path, limits), path };
  }
  if (target.mode === "adjacent" || target.mode === "action-warp") {
    const path = findPath(walk, start, neighbours(t, start));
    if (path === undefined) return undefined;
    const end = path[path.length - 1];
    const steps = pathToSteps(path, limits);
    steps.push({ press: [FACE[directionTo(end, t)]], ms: 0 });
    if (target.mode === "action-warp") steps.push({ press: ["Action"], ms: 0 });
    return { steps, path };
  }
  // walk-warp: inside the map, stand on it; outside, walk to the edge and keep going.
  if (walk.inBounds(t.x, t.y)) {
    const path = findPath(walk, start, [t]);
    if (path === undefined) return undefined;
    const steps = pathToSteps(path, limits);
    // Stepping onto the tile may not intersect the warp yet; nudge on in the same direction.
    const last = path.length > 1 ? directionTo(path[path.length - 2], path[path.length - 1]) : "down";
    steps.push({ hold: [BUTTONS[last]], ms: walkMs(1, limits) });
    return { steps, path };
  }
  const edge = { x: Math.min(Math.max(t.x, 0), walk.width - 1), y: Math.min(Math.max(t.y, 0), walk.height - 1) };
  const outward: Direction = t.x < 0 ? "left" : t.x >= walk.width ? "right" : t.y < 0 ? "up" : "down";
  const candidates = [edge, ...alongEdge(edge, outward, 3)];
  const path = findPath(walk, start, candidates);
  if (path === undefined) return undefined;
  const steps = pathToSteps(path, limits);
  steps.push({ hold: [BUTTONS[outward]], ms: walkMs(2, limits) });
  return { steps, path };
}

function alongEdge(edge: Tile, outward: Direction, span: number): Tile[] {
  const tiles: Tile[] = [];
  for (let d = 1; d <= span; d++) {
    if (outward === "left" || outward === "right") tiles.push({ x: edge.x, y: edge.y - d }, { x: edge.x, y: edge.y + d });
    else tiles.push({ x: edge.x - d, y: edge.y }, { x: edge.x + d, y: edge.y });
  }
  return tiles;
}

const key = (x: number, y: number) => `${x},${y}`;
const parse = (value: string): Tile => {
  const [x, y] = value.split(",").map(Number);
  return { x, y };
};

function rebuild(came: Map<string, string>, end: string): Tile[] {
  const path = [parse(end)];
  let cursor = end;
  while (came.has(cursor)) {
    cursor = came.get(cursor)!;
    path.unshift(parse(cursor));
  }
  return path;
}

class MinHeap {
  private readonly items: Array<[number, string]> = [];
  public get size(): number { return this.items.length; }
  public push(priority: number, value: string): void {
    const items = this.items;
    items.push([priority, value]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  public pop(): string | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0][1];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l][0] < items[m][0]) m = l;
        if (r < items.length && items[r][0] < items[m][0]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
}
