import type { BodyCharacter, BodyItem } from "@dsh-player2/contracts";
import { SimAdapter, type SimLocation } from "../../../../packages/dsh-companion-plugin/src/body/sim-adapter.ts";
import { rngOf } from "./rng.ts";
import type { BenchState } from "./port.ts";

/**
 * The mine scenario: reach the ladder tile with hostile monsters and low
 * health. This is the "extend via a wrapper, not by editing sim-adapter" part:
 * the SimAdapter is untouched; the wrapper owns three things the sim does not
 * have — monster movement, contact damage, and the body's health pool.
 *
 * Monsters chase the body when within AGGRO_TILES (Chebyshev), otherwise
 * patrol on a seeded random walk. The body outruns them (16 ticks/tile vs
 * MOVE_EVERY ticks/tile) and a weapon swing kills a monster standing on the
 * faced tile (the sim already implements that). Health starts low; monster
 * contact costs HIT_DAMAGE with a cooldown.
 */

const MINE_ROWS = [
  "#############",
  "#...........#",
  "#.....#.....#",
  "#.....#.....#",
  "#...........#",
  "#..#.....#..#",
  "#..#.....#..#",
  "#...........#",
  "#...........#",
  "#############",
];

const LADDER = { x: 11, y: 1 } as const;
const START = { x: 1, y: 8 } as const;

export const MONSTER_MOVE_EVERY_TICKS = 28;   // chase speed: ~1 tile / 0.47 s of game time
const MONSTER_PATROL_EVERY_TICKS = 40;
const AGGRO_TILES = 5;
const HIT_COOLDOWN_TICKS = 60;                // 1 s of game time between hits per monster
export const HIT_DAMAGE = 10;
export const START_HEALTH = 40;

const MONSTER_SPOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 9, y: 4 }, { x: 6, y: 2 }, { x: 9, y: 6 }, { x: 8, y: 2 }, { x: 6, y: 4 }, { x: 10, y: 3 }, { x: 5, y: 1 }, { x: 11, y: 6 },
];

export const MINE_KIT: BodyItem[] = [
  { slot: 0, id: "(W)0", name: "Rusty Sword", stack: 1, category: "Weapon" },
  { slot: 1, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" },
  { slot: 2, id: "(T)WateringCan", name: "Watering Can", stack: 1, category: "Tool" },
  { slot: 3, id: "(O)474", name: "Parsnip Seeds", stack: 6, category: "Seed" },
];

export const MINE_GOAL_TEXT = [
  "Delegated task: get to the ladder in the mine.",
  "The ladder is at x 11, y 1 (top right). You start at x 1, y 8.",
  "Hostile monsters chase you when close. Your health is low. Your Rusty Sword (slot 1) kills a monster that stands on the tile you face; you also outrun them.",
].join("\n");

interface TrackedMonster {
  name: string;
  nextMoveAt: number;
  lastHitAt: number;
  patrol: () => number;
}

/** The monster engine: advances monsters by sim ticks and owns the body's health. */
export class MineEngine {
  public health = START_HEALTH;
  public readonly events: { tick: number; kind: string; detail: string }[] = [];
  private monsters: TrackedMonster[] = [];
  private timer: NodeJS.Timeout | undefined;
  private lastTick = 0;

  public constructor(private readonly sim: SimAdapter, seed: number, count: number) {
    const rng = rngOf(seed * 104729 + 7);
    const spots = [...MONSTER_SPOTS]
      .filter((spot) => Math.abs(spot.x - START.x) + Math.abs(spot.y - START.y) >= 8)
      .sort(() => rng.next() - 0.5);
    const location = sim.locations.get("Mine")!;
    for (let i = 0; i < count; i++) {
      const spot = spots[i % spots.length];
      const name = `Slime ${i + 1}`;
      const monster: BodyCharacter = { x: spot.x, y: spot.y, px: spot.x * 64, py: spot.y * 64, name, kind: "monster", health: 1 };
      location.characters.push(monster);
      this.monsters.push({ name, nextMoveAt: 0, lastHitAt: -HIT_COOLDOWN_TICKS, patrol: rngOf(seed * 31 + i * 977).next });
    }
  }

  public start(): void {
    this.lastTick = this.sim.snapshot().tick;
    this.timer = setInterval(() => this.pump(), 10);
  }

  public stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private pump(): void {
    const state = this.sim.snapshot();
    const now = state.tick;
    const body = state.body;
    if (body === null) return;
    this.lastTick = now;
    const location = this.sim.locations.get("Mine")!;
    const rows = location.rows;

    for (const tracked of this.monsters) {
      const monster = location.characters.find((c) => c.name === tracked.name);
      if (monster === undefined) continue; // killed by a weapon swing
      const chasing = Math.max(Math.abs(monster.x - body.x), Math.abs(monster.y - body.y)) <= AGGRO_TILES;
      const every = chasing ? MONSTER_MOVE_EVERY_TICKS : MONSTER_PATROL_EVERY_TICKS;
      while (tracked.nextMoveAt <= now) {
        tracked.nextMoveAt += every;
        this.step(tracked, monster, chasing, body, rows, location);
      }
      // Contact damage: a monster on the body's tile bites, at most once per cooldown.
      if (monster.x === body.x && monster.y === body.y && now - tracked.lastHitAt >= HIT_COOLDOWN_TICKS) {
        tracked.lastHitAt = now;
        this.health -= HIT_DAMAGE;
        this.events.push({ tick: now, kind: "hit", detail: `${monster.name} bit the body; health ${this.health}` });
      }
    }
    this.monsters = this.monsters.filter((tracked) => location.characters.some((c) => c.name === tracked.name));
  }

  private step(tracked: TrackedMonster, monster: BodyCharacter, chasing: boolean, body: { x: number; y: number }, rows: string[], location: SimLocation): void {
    const occupied = (x: number, y: number) => location.characters.some((c) => c !== monster && c.x === x && c.y === y && c.kind === "monster");
    const open = (x: number, y: number) => rows[y]?.[x] === "." && !occupied(x, y);
    let target: { x: number; y: number } | undefined;
    if (chasing) {
      const dx = body.x - monster.x;
      const dy = body.y - monster.y;
      const first = Math.abs(dx) >= Math.abs(dy)
        ? { x: monster.x + Math.sign(dx), y: monster.y }
        : { x: monster.x, y: monster.y + Math.sign(dy) };
      const second = Math.abs(dx) >= Math.abs(dy)
        ? { x: monster.x, y: monster.y + Math.sign(dy) }
        : { x: monster.x + Math.sign(dx), y: monster.y };
      if (dx !== 0 || dy !== 0) target = open(first.x, first.y) ? first : open(second.x, second.y) ? second : undefined;
    } else {
      const roll = tracked.patrol();
      const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const [dx, dy] = dirs[Math.floor(roll * 4)];
      const next = { x: monster.x + dx, y: monster.y + dy };
      if (open(next.x, next.y)) target = next;
    }
    if (target === undefined) return;
    monster.x = target.x;
    monster.y = target.y;
    monster.px = target.x * 64;
    monster.py = target.y * 64;
  }
}

export interface MineWorld {
  readonly adapter: SimAdapter;
  readonly engine: MineEngine;
  readonly goalText: string;
  readonly start: { x: number; y: number };
  readonly ladder: { x: number; y: number };
  isSuccess(state: BenchState): boolean;
}

export function buildMine(seed: number): MineWorld {
  const location: SimLocation = {
    name: "Mine",
    rows: [...MINE_ROWS],
    warps: [],
    objects: [{ x: LADDER.x, y: LADDER.y, kind: "ladder", name: "Ladder", extra: { passable: true } }],
    characters: [],
  };
  const sim = new SimAdapter({ locations: [location], body: { location: "Mine", x: START.x, y: START.y, items: MINE_KIT.map((item) => ({ ...item })) } });
  const engine = new MineEngine(sim, seed, 2);
  return {
    adapter: sim,
    engine,
    goalText: MINE_GOAL_TEXT,
    start: START,
    ladder: LADDER,
    isSuccess(state: BenchState): boolean {
      const body = state.body;
      return body !== null && body.x === LADDER.x && body.y === LADDER.y && engine.health > 0;
    },
  };
}
