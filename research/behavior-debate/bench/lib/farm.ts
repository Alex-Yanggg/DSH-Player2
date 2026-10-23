import type { BodyItem } from "@dsh-player2/contracts";
import { SimAdapter, type SimLocation } from "../../../../packages/dsh-companion-plugin/src/body/sim-adapter.ts";
import { findPath, Walkability } from "../../../../packages/dsh-companion-plugin/src/body/navigation.ts";
import { rngOf } from "./rng.ts";
import type { BenchState } from "./port.ts";

/**
 * The farm scenario: till, plant and water 6 parsnips on a small plot.
 *
 * A 13x10 walled field. The plot is the clear 3x3 area at x 7..9, y 3..5.
 * The seed places a 2x1 pond and two stones anywhere that keeps the plot
 * reachable from the body's start tile; every approach gets the same seed and
 * therefore the same world. The goal text is the only task description the
 * model-driven approaches receive; fixed-code approaches encode their
 * understanding as code (counted as their lines).
 */

const WIDTH = 13;
const HEIGHT = 10;
const PLOT = { x0: 7, y0: 3, x1: 9, y1: 5 } as const;
const PARSNIPS = 6;

export const FARM_GOAL_TEXT = [
  "Delegated task: plant and water 6 parsnips on the farm.",
  "The open plot is the clear area x 7..9, y 3..5 (map columns 7-9, rows 3-5).",
  "Your toolbar: slot 1 Hoe, slot 2 Watering Can, slot 3 Parsnip Seeds x6.",
  "Work tiles one at a time: till with the Hoe, plant a seed, then water with the can. A tile counts when it holds a planted parsnip that is watered.",
].join("\n");

export const FARM_KIT: BodyItem[] = [
  { slot: 0, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" },
  { slot: 1, id: "(T)WateringCan", name: "Watering Can", stack: 1, category: "Tool" },
  { slot: 2, id: "(O)474", name: "Parsnip Seeds", stack: PARSNIPS, category: "Seed" },
  { slot: 3, id: "(W)0", name: "Rusty Sword", stack: 1, category: "Weapon" },
];

function baseRows(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    if (y === 0 || y === HEIGHT - 1) rows.push("#".repeat(WIDTH));
    else rows.push(`#${".".repeat(WIDTH - 2)}#`);
  }
  return rows;
}

const POND_SPOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 3, y: 2 }, { x: 4, y: 6 }, { x: 2, y: 7 }, { x: 9, y: 7 }, { x: 5, y: 2 },
];
const STONE_SPOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 4, y: 4 }, { x: 6, y: 6 }, { x: 2, y: 5 }, { x: 10, y: 5 }, { x: 6, y: 2 }, { x: 10, y: 2 },
];

export interface FarmWorld {
  readonly adapter: SimAdapter;
  readonly goalText: string;
  readonly start: { x: number; y: number };
  isSuccess(state: BenchState): boolean;
}

function finish(sim: SimAdapter, start: { x: number; y: number }): FarmWorld {
  return {
    adapter: sim,
    goalText: FARM_GOAL_TEXT,
    start,
    isSuccess(state: BenchState): boolean {
      let done = 0;
      for (const object of state.objects) {
        if (object.kind === "dirt" && object.extra?.crop === "Parsnip" && object.extra?.watered === true) done++;
      }
      return done >= PARSNIPS;
    },
  };
}

export function buildFarm(seed: number): FarmWorld {
  const rng = rngOf(seed * 7919 + 1);
  const start = { x: 2, y: 2 + (seed % 3) };
  const rows = baseRows();
  const set = (x: number, y: number, ch: string) => { rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1); };

  // Keep the plot ring and the start ring clear so every seeded world stays solvable.
  const blockedFor = (x: number, y: number) =>
    (x >= PLOT.x0 - 1 && x <= PLOT.x1 + 1 && y >= PLOT.y0 - 1 && y <= PLOT.y1 + 1) ||
    (Math.abs(x - start.x) <= 1 && Math.abs(y - start.y) <= 1);

  const pondCandidates = POND_SPOTS.filter((spot) => !blockedFor(spot.x, spot.y) && !blockedFor(spot.x + 1, spot.y));
  if (pondCandidates.length > 0) {
    const pond = rng.pick(pondCandidates);
    set(pond.x, pond.y, "~");
    set(pond.x + 1, pond.y, "~");
  }
  const stoneCandidates = STONE_SPOTS.filter((spot) => !blockedFor(spot.x, spot.y) && rows[spot.y][spot.x] === ".");
  for (let i = 0; i < 2 && stoneCandidates.length > 0; i++) {
    const stone = rng.pick(stoneCandidates);
    set(stone.x, stone.y, "#");
    stoneCandidates.splice(stoneCandidates.indexOf(stone), 1);
  }

  const make = (mapRows: string[]) => {
    const location: SimLocation = { name: "Farm", rows: mapRows, warps: [], objects: [], characters: [] };
    return new SimAdapter({ locations: [location], body: { location: "Farm", x: start.x, y: start.y, items: FARM_KIT.map((item) => ({ ...item })) } });
  };

  const sim = make(rows);
  // Determinism guard: the plot must stay reachable, else fall back to the plain field.
  const probe = sim.snapshot();
  if (probe.body !== null && findPath(new Walkability(probe), start, [{ x: PLOT.x0, y: PLOT.y0 }]) === undefined) {
    return finish(make(baseRows()), start);
  }
  return finish(sim, start);
}
