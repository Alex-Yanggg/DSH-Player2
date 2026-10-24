import { SimAdapter, type SimTaskState } from "../../../../packages/dsh-companion-plugin/src/body/sim-adapter.ts";
import type { BodyItem, BodyObject, BodyState } from "@dsh-player2/contracts";
import type { BenchState } from "./port.ts";

/**
 * The locked-area scenario: the delegated goal stands behind a pass that is
 * closed until morning of day 5 — a condition the goal text does not state,
 * mirroring the P2-0019 mine failure (spring-5 landslide). The fact is
 * discoverable only by exploring (a readable notice board by the start) or via
 * the scenario's simulated web-search corpus. Until day 5, every walk into the
 * pass ends "blocked"; retries are the repeated-failure metric's target.
 *
 * Sim time: the day clock is compressed to 350 sim ticks per day (1 tick = 4
 * game minutes of the 1400-minute day) so a day passes in seconds of real
 * time; timeOfDay is kept consistent in the subclass's snapshot. Day N begins
 * at tick (N-1)*350 — day 5 at tick 1400. Built as a wrapper + subclass,
 * exactly like lib/mine.ts; sim-adapter.ts is untouched. The Rockslide is an
 * ordinary unpassable object the wrapper removes when day 5 begins.
 */

const WIDTH = 13;
const HEIGHT = 10;

function rows(): string[] {
  const grid: string[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    if (y === 0 || y === HEIGHT - 1) grid.push("#".repeat(WIDTH));
    else if (y === 3) grid.push("###########.#");
    else grid.push(`#${".".repeat(WIDTH - 2)}#`);
  }
  return grid;
}

const GOAL = { x: 11, y: 1 } as const;
const PASS = { x: 11, y: 4 } as const;
const NOTICE = { x: 3, y: 7 } as const;
const STARTS: ReadonlyArray<{ x: number; y: number }> = [{ x: 2, y: 7 }, { x: 5, y: 8 }, { x: 7, y: 6 }];

export const TICKS_PER_DAY = 350;
export const PASS_OPENS_ON_DAY = 5;

export const NOTICE_TEXT =
  "NOTICE: The north pass to the Old Shrine is closed by a rockslide. The repair crew clears it on the morning of day 5. Until then the shrine cannot be reached; do not waste days pushing the rocks.";

export const LOCKED_KIT: BodyItem[] = [
  { slot: 0, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" },
  { slot: 1, id: "(T)WateringCan", name: "Watering Can", stack: 1, category: "Tool" },
  { slot: 2, id: "(O)474", name: "Parsnip Seeds", stack: 6, category: "Seed" },
];

export const LOCKED_GOAL_TEXT = [
  "Delegated task: reach the Old Shrine chest and stand on its tile (north-east, x 11, y 1); the player wants the memento inside.",
  "You start in the south meadow. Toolbar: slot 1 Hoe, slot 2 Watering Can, slot 3 Parsnip Seeds x6.",
].join("\n");

/** A sim whose notice boards are readable and whose day clock stays consistent. */
class LockedSim extends SimAdapter {
  public override snapshot(): BodyState {
    const state = super.snapshot();
    return { ...state, time: { ...state.time, timeOfDay: 600 + (state.tick % TICKS_PER_DAY) * (1400 / TICKS_PER_DAY) } };
  }

  protected override press(id: string, task: SimTaskState): void {
    if (id === "ControllerA") {
      const t = this.faced();
      const at = this.location().objects.find((o) => o.x === t.x && o.y === t.y);
      if (at?.kind === "notice" && typeof at.extra?.text === "string") {
        this.note(task, "read", at.extra.text);
        return;
      }
    }
    super.press(id, task);
  }
}

/** The day clock: advances sim.day from ticks and opens the pass on schedule. */
export class LockedEngine {
  public health = 100;
  public readonly events: { tick: number; kind: string; detail: string }[] = [];
  private timer: NodeJS.Timeout | undefined;
  private day = 1;

  public constructor(private readonly sim: LockedSim) {}

  public start(): void {
    this.timer = setInterval(() => this.pump(), 10);
  }

  public stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private pump(): void {
    const tick = this.sim.snapshot().tick;
    const now = 1 + Math.floor(tick / TICKS_PER_DAY);
    if (now === this.day) return;
    this.day = now;
    this.sim.day = now;
    if (now === PASS_OPENS_ON_DAY) {
      const location = this.sim.locations.get("Meadow")!;
      const rocks = location.objects.find((o) => o.kind === "rock" && o.x === PASS.x && o.y === PASS.y);
      if (rocks !== undefined) location.objects.splice(location.objects.indexOf(rocks), 1);
      this.events.push({ tick, kind: "pass-opened", detail: `day ${now}: the repair crew cleared the Rockslide` });
    }
  }
}

export interface LockedWorld {
  readonly adapter: SimAdapter;
  readonly engine: LockedEngine;
  readonly goalText: string;
  readonly start: { x: number; y: number };
  readonly saveId: string;
  isSuccess(state: BenchState): boolean;
}

export function buildLocked(seed: number): LockedWorld {
  const start = STARTS[seed % STARTS.length];
  const objects: BodyObject[] = [
    { x: GOAL.x, y: GOAL.y, kind: "chest", name: "Old Shrine Chest", extra: { passable: true } },
    { x: PASS.x, y: PASS.y, kind: "rock", name: "Rockslide", extra: { passable: false } },
    { x: NOTICE.x, y: NOTICE.y, kind: "notice", name: "Notice Board", extra: { passable: false, text: NOTICE_TEXT } },
  ];
  const location = {
    name: "Meadow",
    rows: rows(),
    warps: [],
    objects,
    characters: [],
  };
  const sim = new LockedSim({ locations: [location], body: { location: "Meadow", x: start.x, y: start.y, items: LOCKED_KIT.map((item) => ({ ...item })) } });
  const engine = new LockedEngine(sim);
  return {
    adapter: sim,
    engine,
    goalText: LOCKED_GOAL_TEXT,
    start,
    saveId: "valley-meadow-1",
    isSuccess(state: BenchState): boolean {
      const body = state.body;
      return body !== null && body.x === GOAL.x && body.y === GOAL.y;
    },
  };
}
