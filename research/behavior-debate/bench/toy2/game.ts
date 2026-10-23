import { randomUUID } from "node:crypto";
import { bodyProtocolVersion, type BodyDeclaration, type BodyInputStep, type BodyItem, type BodyState, type BodyTask, type BodyTaskStatus, type BodyWorld } from "@dsh-player2/contracts";
import { sleep, type BodyPort, type BodyRun, type RunOptions } from "../../../../packages/dsh-companion-plugin/src/body/port.ts";

/**
 * toy2: "Keycraft" — a top-down grid crafting game with a different state and
 * input vocabulary from the farm sim: keyboard keys instead of controller
 * buttons, keys/doors/materials/bench instead of tiles/tools/crops, crafting
 * instead of tilling. It implements the same BodyPort shape (movement by
 * declared input roles, raw task files with until conditions) so the shared
 * capability layer and instrumentation work unchanged; everything semantic is
 * different, which is exactly what the porting-cost metric measures.
 *
 * Goal: craft the Crown at the workbench (3 wood + 2 stone). The red key opens
 * the red door to the wood room; the blue key (inside the wood room) opens the
 * blue door to the stone room.
 */

const TICK_MS = 1000 / 60;
const SPEED = 4;

const ROWS = [
  "#############",
  "#.......#...#",
  "#.......#...#",
  "#...........#",
  "#.......#...#",
  "#.......#####",
  "#...........#",
  "#.......#...#",
  "#.......#...#",
  "#############",
];

const START = { x: 2, y: 7 };

export const TOY2_GOAL_TEXT = [
  "Delegated task: craft the Crown at the workbench.",
  "You need 3 Wood and 2 Stone, then stand next to the workbench and craft.",
  "A red key opens the red door (top corridor); the blue key lies in the wood room and opens the blue door (bottom corridor) to the stone room.",
  "Controls: KeyW/KeyA/KeyS/KeyD move, KeyE interacts (picks up keys and materials, unlocks doors), KeyC crafts at the bench.",
].join("\n");

interface Toy2Object {
  x: number;
  y: number;
  kind: "key" | "door" | "material" | "bench";
  name: string;
  extra: Record<string, string | number | boolean>;
}

const BASE_OBJECTS: Toy2Object[] = [
  { x: 2, y: 2, kind: "key", name: "Red Key", extra: { color: "red" } },
  { x: 6, y: 7, kind: "material", name: "Wood", extra: { material: "wood" } },
  { x: 10, y: 1, kind: "material", name: "Wood", extra: { material: "wood" } },
  { x: 10, y: 3, kind: "material", name: "Wood", extra: { material: "wood" } },
  { x: 11, y: 1, kind: "key", name: "Blue Key", extra: { color: "blue" } },
  { x: 8, y: 3, kind: "door", name: "Red Door", extra: { color: "red", passable: false } },
  { x: 8, y: 6, kind: "door", name: "Blue Door", extra: { color: "blue", passable: false } },
  { x: 10, y: 7, kind: "material", name: "Stone", extra: { material: "stone" } },
  { x: 11, y: 8, kind: "material", name: "Stone", extra: { material: "stone" } },
  { x: 6, y: 2, kind: "bench", name: "Workbench", extra: { passable: false } },
];

const DIRS: Record<string, [number, number, "up" | "right" | "down" | "left"]> = {
  KeyW: [0, -1, "up"], KeyD: [1, 0, "right"], KeyS: [0, 1, "down"], KeyA: [-1, 0, "left"],
};

type Facing = "up" | "right" | "down" | "left";

export class Toy2Adapter implements BodyPort {
  public readonly items: (BodyItem | null)[] = Array.from({ length: 12 }, () => null);
  public body = { px: START.x * 64, py: START.y * 64, facing: "down" as Facing };
  public player = { location: "Workshop", x: 3, y: 7, items: [] as BodyItem[], money: 0 };
  public objects: Toy2Object[] = structuredClone(BASE_OBJECTS);
  private timer: NodeJS.Timeout | undefined;
  private tick = 0;
  private revision = 0;
  private lastSeq = 0;
  private task: { task: BodyTask; step: number; stepTick: number; ticks: number[]; events: { tick: number; kind: string; detail: string }[]; status: BodyTaskStatus["status"]; reason: string | null; still: number } | undefined;
  private submitted: BodyTask | undefined;
  private cancelSeq = 0;

  public static declaration(): BodyDeclaration {
    return {
      version: bodyProtocolVersion, adapter: "toy2", game: "Keycraft", writtenAt: new Date().toISOString(),
      state: { file: "world_state", world: "world_map", description: "Keycraft workshop.", fields: [{ name: "map", description: "rows" }], legend: { ".": "floor", "#": "wall" } },
      inputs: [
        ...Object.entries(DIRS).map(([id, [, , role]]) => ({ id, kind: "hold" as const, description: `move ${role}`, role })),
        { id: "KeyE", kind: "press" as const, description: "interact: pick up a key or material, unlock a door", role: "action" as const },
        { id: "KeyC", kind: "press" as const, description: "craft at the workbench" },
      ],
      limits: { maxSteps: 64, maxStepMs: 10_000, tickMs: TICK_MS, walkPxPerTick: SPEED, tilePx: 64 },
      cheats: { settingAllowed: false },
    };
  }

  public get tile(): { x: number; y: number } {
    return { x: Math.floor((this.body.px + 32) / 64), y: Math.floor((this.body.py + 40) / 64) };
  }

  public async start(tickMs = 2): Promise<void> {
    this.timer = setInterval(() => this.step(), tickMs);
  }

  public async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private step(): void {
    this.tick++;
    if (this.tick % 3 === 0) this.pollInput();
    const task = this.task;
    if (task !== undefined && !["done", "interrupted", "failed", "cancelled"].includes(task.status)) this.playTick(task);
  }

  private pollInput(): void {
    if (this.task && this.cancelSeq === this.task.task.seq && !["done", "interrupted", "failed", "cancelled"].includes(this.task.status)) this.finish(this.task, "cancelled", "cancelled");
    const task = this.submitted;
    if (task === undefined || task.seq <= this.lastSeq) return;
    this.lastSeq = task.seq;
    if (this.task && !["done", "interrupted", "failed", "cancelled"].includes(this.task.status)) this.finish(this.task, "cancelled", "preempted");
    const declared = Toy2Adapter.declaration().inputs;
    const ids = task.steps.flatMap((s) => [...(s.hold ?? []), ...(s.press ?? [])]);
    const unknown = ids.find((id) => !declared.some((d) => d.id === id));
    this.task = { task, step: 0, stepTick: 0, ticks: task.steps.map((s) => s.ms <= 0 ? 1 : Math.max(1, Math.round(s.ms / TICK_MS))), events: [], status: "running", reason: null, still: 0 };
    if (unknown !== undefined) this.finish(this.task, "failed", `unknown-input: ${unknown}`);
  }

  private playTick(task: NonNullable<Toy2Adapter["task"]>): void {
    const until = task.task.until;
    const here = this.tile;
    if (until?.arrive && Math.abs(until.arrive.x - here.x) <= until.arrive.radius && Math.abs(until.arrive.y - here.y) <= until.arrive.radius) return this.finish(task, "done", "arrived");
    if (task.stepTick >= task.ticks[task.step]) {
      task.step++;
      task.stepTick = 0;
      if (task.step >= task.ticks.length) return this.finish(task, "done", "completed");
    }
    const step = task.task.steps[task.step];
    if (task.stepTick === 0) for (const press of step.press ?? []) this.press(press, task);
    task.stepTick++;
    let moved = false;
    for (const id of step.hold ?? []) {
      const d = DIRS[id];
      if (d === undefined) continue;
      this.body.facing = d[2];
      const nx = this.body.px + d[0] * SPEED;
      const ny = this.body.py + d[1] * SPEED;
      const tx = Math.floor((nx + 32 + d[0] * 24) / 64);
      const ty = Math.floor((ny + 40 + d[1] * 16) / 64);
      if (this.walkable(tx, ty)) { this.body.px = nx; this.body.py = ny; moved = true; }
    }
    if ((step.hold ?? []).some((id) => id in DIRS)) {
      task.still = moved ? 0 : task.still + 1;
      if (until?.blockedMs !== undefined && task.still >= Math.round(until.blockedMs / TICK_MS)) this.finish(task, "interrupted", "blocked");
    }
  }

  private walkable(x: number, y: number): boolean {
    return ROWS[y]?.[x] === "." && !this.objects.some((o) => o.x === x && o.y === y && o.extra.passable === false);
  }

  private faced(): { x: number; y: number } {
    const t = this.tile;
    return this.body.facing === "up" ? { x: t.x, y: t.y - 1 } : this.body.facing === "down" ? { x: t.x, y: t.y + 1 } : this.body.facing === "left" ? { x: t.x - 1, y: t.y } : { x: t.x + 1, y: t.y };
  }

  private press(id: string, task: NonNullable<Toy2Adapter["task"]>): void {
    const note = (kind: string, detail: string) => { task.events.push({ tick: this.tick, kind, detail }); };
    const t = this.faced();
    const at = this.objects.find((o) => o.x === t.x && o.y === t.y);
    if (id === "KeyE") {
      if (at === undefined) return note("nothing-there", `nothing at ${t.x},${t.y}`);
      if (at.kind === "key") {
        this.objects.splice(this.objects.indexOf(at), 1);
        this.addItem({ id: `key-${at.extra.color}`, name: at.name, category: "Key" });
        return note("picked-up", at.name);
      }
      if (at.kind === "material") {
        this.objects.splice(this.objects.indexOf(at), 1);
        this.addItem({ id: `mat-${at.extra.material}`, name: at.name, category: "Material" });
        return note("picked-up", at.name);
      }
      if (at.kind === "door") {
        const color = String(at.extra.color);
        const hasKey = this.items.some((item) => item?.category === "Key" && item.name.startsWith(color.charAt(0).toUpperCase() + color.slice(1)));
        if (!hasKey) return note("locked", `${at.name} needs the ${color} key`);
        this.objects.splice(this.objects.indexOf(at), 1);
        return note("opened", at.name);
      }
      if (at.kind === "bench") return note("bench", `the ${at.name} is here; craft with KeyC`);
      return note("nothing-there", `nothing at ${t.x},${t.y}`);
    }
    if (id === "KeyC") {
      const count = (name: string) => this.items.filter((item) => item?.name === name).reduce((sum, item) => sum + (item?.stack ?? 0), 0);
      const nearBench = this.objects.some((o) => o.kind === "bench" && Math.abs(o.x - t.x) + Math.abs(o.y - t.y) <= 1);
      if (!nearBench) return note("no-bench", "crafting needs the workbench in front of you");
      const wood = count("Wood");
      const stone = count("Stone");
      if (wood < 3 || stone < 2) return note("missing-materials", `have ${wood}/3 wood, ${stone}/2 stone`);
      for (const [name, need] of [["Wood", 3], ["Stone", 2]] as const) {
        let left = need;
        for (const item of this.items) {
          if (item?.name !== name || left <= 0) continue;
          const take = Math.min(left, item.stack);
          item.stack -= take;
          left -= take;
          if (item.stack <= 0) this.items[this.items.indexOf(item)] = null;
        }
      }
      this.addItem({ id: "artifact-crown", name: "Crown", category: "Artifact" });
      return note("crafted", "Crown");
    }
    return note("ignored", id);
  }

  private addItem(item: { id: string; name: string; category: string }): void {
    const existing = this.items.find((i) => i?.id === item.id);
    if (existing) { existing.stack++; return; }
    const free = this.items.findIndex((i) => i === null);
    if (free >= 0) this.items[free] = { slot: free, id: item.id, name: item.name, stack: 1, category: item.category };
  }

  private finish(task: NonNullable<Toy2Adapter["task"]>, status: BodyTaskStatus["status"], reason: string): void {
    task.status = status;
    task.reason = reason;
    task.events.push({ tick: this.tick, kind: status, detail: reason });
  }

  public snapshot(): BodyState {
    const t = this.tile;
    return {
      version: bodyProtocolVersion, revision: ++this.revision, writtenAt: new Date().toISOString(), tick: this.tick, paused: false,
      time: { day: 1, season: "workshop", dayOfMonth: 1, year: 1, timeOfDay: 600 + this.tick % 1400, weather: "clear" },
      player: { location: this.player.location, x: this.player.x, y: this.player.y, px: this.player.x * 64, py: this.player.y * 64, facing: "down", name: "Tester", money: 0, health: 100, stamina: 100, items: this.player.items },
      body: { location: "Workshop", x: t.x, y: t.y, px: this.body.px, py: this.body.py, facing: this.body.facing, present: true, moving: false, selectedSlot: 0, stamina: 100, money: 0, items: this.items.filter((i): i is BodyItem => i !== null), activeTask: this.task?.status === "running" ? this.task.task.seq : null, menu: null },
      map: { location: "Workshop", width: ROWS[0].length, height: ROWS.length, rows: [...ROWS] },
      objects: this.objects.map((o) => ({ x: o.x, y: o.y, kind: o.kind, name: o.name, extra: o.extra })),
      characters: [], warps: [], truncated: { objects: 0 },
    };
  }

  public declaration(): Promise<BodyDeclaration> { return Promise.resolve(Toy2Adapter.declaration()); }
  public state(): Promise<BodyState> { return Promise.resolve(this.snapshot()); }
  public world(): Promise<BodyWorld> {
    return Promise.resolve({ version: bodyProtocolVersion, writtenAt: new Date().toISOString(), locations: [{ name: "Workshop", displayName: "Workshop", outdoors: true, warps: [] }] });
  }

  public async run(steps: readonly BodyInputStep[], options: RunOptions = {}): Promise<BodyRun> {
    const started = Date.now();
    const task: BodyTask = {
      version: bodyProtocolVersion, taskId: randomUUID(), seq: (this.submitted?.seq ?? 0) + 1, createdAt: new Date().toISOString(), steps: [...steps],
      ...(options.until === undefined ? {} : { until: options.until }),
    };
    this.submitted = task;
    let budget = options.timeoutMs ?? steps.reduce((sum, step) => sum + Math.max(step.ms, 17), 0) + 15_000;
    let last = started;
    for (;;) {
      const now = Date.now();
      budget -= now - last;
      last = now;
      const current = this.task?.task.seq === task.seq ? this.task : undefined;
      if (current !== undefined && ["done", "interrupted", "failed", "cancelled"].includes(current.status)) {
        return { seq: task.seq, status: current.status, reason: current.reason, events: current.events.slice(-32), state: this.snapshot(), acceptMs: undefined, totalMs: Date.now() - started };
      }
      if (options.signal?.aborted) await this.cancelActive();
      if (budget <= 0) {
        this.cancelSeq = task.seq;
        return { seq: task.seq, status: "timeout", reason: "not finished in time", events: current?.events ?? [], state: this.snapshot(), acceptMs: undefined, totalMs: Date.now() - started };
      }
      await sleep(2);
    }
  }

  public cancelActive(): Promise<void> {
    if (this.task !== undefined) this.cancelSeq = this.task.task.seq;
    return Promise.resolve();
  }

  public grantCheats(): Promise<string> { return Promise.resolve("no cheats in Keycraft"); }
}

export function toy2Success(state: BodyState): boolean {
  return state.body?.items.some((item) => item.name === "Crown") === true;
}
