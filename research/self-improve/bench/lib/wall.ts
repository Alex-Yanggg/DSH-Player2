import { SimAdapter, type SimTaskState } from "../../../../packages/dsh-companion-plugin/src/body/sim-adapter.ts";
import type { BodyCharacter, BodyItem, BodyObject } from "@dsh-player2/contracts";
import type { BenchState } from "./port.ts";

/**
 * The repeated-wall scenario: the direct route (the guarded bridge, straight
 * north from the start) always fails — the Clay Golem blocks it, is immune to
 * the starter weapon, and counterattacks. Success needs a different approach:
 * pull the Shrine Lever in the west grove, which opens the Great Gate on the
 * south wall of the east bank. Deterministic: the golem never moves, the
 * counterattack always costs ATTACK_DAMAGE, the lever always works.
 *
 * Retrying the bridge (blocked walks or weapon swings at the golem) is exactly
 * the repeated-failure behavior the metric targets; enough swings collapse the
 * body. Built as a subclass + wrapper, like lib/mine.ts and lib/locked.ts.
 */

const WIDTH = 13;
const HEIGHT = 10;

function rows(): string[] {
  const grid: string[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    if (y === 0 || y === HEIGHT - 1) grid.push("#".repeat(WIDTH));
    // The x5 wall is solid except two map gaps: the bridge (y 4, held by the golem
    // character) and the gate (y 7, held by the Great Gate object).
    else if (y === 4 || y === 7) grid.push("#............#");
    else grid.push("#....#......#");
  }
  return grid;
}

const GOAL = { x: 11, y: 1 } as const;
const BRIDGE = { x: 5, y: 4 } as const;
const GATE = { x: 5, y: 7 } as const;
const LEVER = { x: 1, y: 1 } as const;
const STARTS: ReadonlyArray<{ x: number; y: number }> = [{ x: 2, y: 7 }, { x: 3, y: 5 }, { x: 2, y: 2 }];

export const ATTACK_DAMAGE = 10;
export const START_HEALTH = 100;

export const WALL_KIT: BodyItem[] = [
  { slot: 0, id: "(W)0", name: "Rusty Sword", stack: 1, category: "Weapon" },
  { slot: 1, id: "(T)Hoe", name: "Hoe", stack: 1, category: "Tool" },
];

export const WALL_GOAL_TEXT = [
  "Delegated task: reach the shrine bell — stand on its tile at the sanctuary (x 11, y 1), east of the river.",
  "You start on the west bank of the river. Toolbar: slot 1 Rusty Sword, slot 2 Hoe.",
  "ControllerX swings the selected tool at the faced tile; ControllerA is the action button.",
].join("\n");

/** A sim whose golem is immune and whose lever opens the gate. */
class WallSim extends SimAdapter {
  public bridgeAttempts = 0;
  public leverPulled = false;

  public constructor(options: ConstructorParameters<typeof SimAdapter>[0], private readonly onAttack: () => void) {
    super(options);
  }

  protected override press(id: string, task: SimTaskState): void {
    if (id === "ControllerX" || id === "ControllerA") {
      const t = this.faced();
      const location = this.location();
      const golem = location.characters.find((c) => c.name === "Clay Golem" && c.x === t.x && c.y === t.y);
      if (golem !== undefined) {
        this.bridgeAttempts++;
        // The attempt fails the task, so the runner's repeat-failure metric
        // (failing tasks with a repeated signature) sees golem retries.
        task.status = "interrupted";
        task.reason = id === "ControllerX" ? "golem-counterattack" : "blocked-by-golem";
        if (id === "ControllerX") {
          this.onAttack();
          this.note(task, "used", "Rusty Sword swing — the Clay Golem shrugs it off (immune to starter weapons) and its counterattack hurts");
        } else {
          this.note(task, "blocked-by", "The Clay Golem holds the bridge. It does not move and cannot be harmed with your weapon.");
        }
        this.note(task, "interrupted", task.reason);
        return;
      }
      const lever = location.objects.find((o) => o.kind === "lever" && o.x === t.x && o.y === t.y);
      if (id === "ControllerA" && lever !== undefined && !this.leverPulled) {
        this.leverPulled = true;
        location.objects.splice(location.objects.indexOf(lever), 1);
        const gate = location.objects.find((o) => o.kind === "gate" && o.x === GATE.x && o.y === GATE.y);
        if (gate !== undefined) location.objects.splice(location.objects.indexOf(gate), 1);
        this.note(task, "pulled", "You pull the Shrine Lever. To the south-east, the Great Gate grinds open.");
        return;
      }
    }
    super.press(id, task);
  }
}

/** The golem's counterattack pool: every weapon swing at the golem costs health. */
export class WallEngine {
  public health = START_HEALTH;
  public readonly events: { tick: number; kind: string; detail: string }[] = [];

  public onAttack(): void {
    this.health -= ATTACK_DAMAGE;
    this.events.push({ tick: 0, kind: "counterattack", detail: `golem counterattack; health ${this.health}` });
  }

  public start(): void {}
  public stop(): void {}
}

export interface WallWorld {
  readonly adapter: SimAdapter;
  readonly engine: WallEngine;
  readonly goalText: string;
  readonly start: { x: number; y: number };
  readonly saveId: string;
  isSuccess(state: BenchState): boolean;
}

export function buildWall(seed: number): WallWorld {
  const start = STARTS[seed % STARTS.length];
  const golem: BodyCharacter = { x: BRIDGE.x, y: BRIDGE.y, px: BRIDGE.x * 64, py: BRIDGE.y * 64, name: "Clay Golem", kind: "monster", health: 999 };
  const location = {
    name: "Riverbank",
    rows: rows(),
    warps: [],
    objects: [
      { x: GOAL.x, y: GOAL.y, kind: "bell", name: "Shrine Bell", extra: { passable: true } },
      { x: GATE.x, y: GATE.y, kind: "gate", name: "Great Gate", extra: { passable: false } },
      { x: LEVER.x, y: LEVER.y, kind: "lever", name: "Shrine Lever", extra: { passable: false } },
    ],
    characters: [golem],
  };
  const engine = new WallEngine();
  const sim = new WallSim({ locations: [location], body: { location: "Riverbank", x: start.x, y: start.y, items: WALL_KIT.map((item) => ({ ...item })) } }, () => engine.onAttack());
  return {
    adapter: sim,
    engine,
    goalText: WALL_GOAL_TEXT,
    start,
    saveId: "valley-riverbank-1",
    isSuccess(state: BenchState): boolean {
      const body = state.body;
      return body !== null && body.x === GOAL.x && body.y === GOAL.y;
    },
  };
}
