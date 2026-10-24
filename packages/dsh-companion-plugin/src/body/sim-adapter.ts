import { randomUUID } from "node:crypto";
import {
  bodyProtocolVersion,
  type BodyCharacter,
  type BodyDeclaration,
  type BodyEvent,
  type BodyItem,
  type BodyObject,
  type BodyState,
  type BodyTask,
  type BodyTaskStatus,
  type BodyWarp,
  type BodyWorld,
  type BodyInputStep,
} from "@dsh-player2/contracts";
import { sleep, type BodyPort, type BodyRun, type RunOptions } from "./port.js";

/**
 * A keyless stand-in for the Stardew body, behind the same body port
 * (P2-0021). Replays and tests use it to drive navigation, the body tools and
 * reflexes without a game. Its world is a
 * toy: tile collision, a hoe, a watering can, seeds that grow when told to,
 * and monsters that vanish when hit.
 */

export interface SimLocation {
  readonly name: string;
  readonly rows: string[];
  readonly warps: BodyWarp[];
  objects: BodyObject[];
  characters: BodyCharacter[];
}

export interface SimOptions {
  readonly locations: SimLocation[];
  readonly body: { location: string; x: number; y: number; items: BodyItem[] };
  readonly player?: { location: string; x: number; y: number; items: BodyItem[]; money: number };
  readonly tickMs?: number;
  readonly cheatSetting?: boolean;
  /** Shop stock by shop id; a `counter` object with `extra.shopId` opens it. */
  readonly shops?: Record<string, { id: string; name: string; category: string; price: number; stock: number | null }[]>;
  /** Movement buttons for a game whose controller is not a D-pad (a port brings its own vocabulary). */
  readonly directions?: Record<string, [number, number, NonNullable<BodyState["body"]>["facing"]]>;
}

type Facing = NonNullable<BodyState["body"]>["facing"];

/** One running input task's live record: a port with its own buttons writes events and outcomes into it. */
export interface SimTaskState {
  task: BodyTask;
  step: number;
  stepTick: number;
  ticks: number[];
  events: BodyEvent[];
  status: BodyTaskStatus["status"];
  reason: string | null;
  startLocation: string;
  still: number;
}
const DIRS: Record<string, [number, number, Facing]> = { DPadUp: [0, -1, "up"], DPadRight: [1, 0, "right"], DPadDown: [0, 1, "down"], DPadLeft: [-1, 0, "left"] };
const TICK_MS = 1000 / 60;
const SPEED = 4;

export class SimAdapter implements BodyPort {
  public readonly locations: Map<string, SimLocation>;
  public body: { location: string; px: number; py: number; facing: "up" | "right" | "down" | "left"; slot: number; items: (BodyItem | null)[]; stamina: number };
  /** The body's own health, as a raw field reflex rows read. */
  public health = 100;
  public player: { location: string; x: number; y: number; items: BodyItem[]; money: number };
  public day = 1;
  public paused = false;
  public cheatSetting: boolean;
  public cheatGrant = false;
  private timer: NodeJS.Timeout | undefined;
  private tick = 0;
  private revision = 0;
  private lastSeq = 0;
  protected task: SimTaskState | undefined;
  private writing: Promise<void> = Promise.resolve();
  private submitted: BodyTask | undefined;
  private cancelSeq = 0;
  public readonly inputsSeen: BodyTask[] = [];
  private readonly shops: NonNullable<SimOptions["shops"]>;
  protected readonly dirs: Record<string, [number, number, NonNullable<BodyState["body"]>["facing"]]>;
  private menu: { shopId: string; cursor: number; at: { location: string; x: number; y: number } } | undefined;
  private lastPx = NaN;
  private lastPy = NaN;
  private movedLastTick = false;
  private readonly finished = new Map<number, { status: BodyTaskStatus["status"]; reason: string | null; events: BodyEvent[] }>();

  public constructor(options: SimOptions) {
    this.locations = new Map(options.locations.map((location) => [location.name, location]));
    const items: (BodyItem | null)[] = Array.from({ length: 12 }, () => null);
    for (const item of options.body.items) items[item.slot] = item;
    this.body = { location: options.body.location, px: options.body.x * 64, py: options.body.y * 64, facing: "down", slot: 0, items, stamina: 270 };
    this.player = options.player ?? { location: options.body.location, x: options.body.x + 2, y: options.body.y, items: [], money: 500 };
    this.cheatSetting = options.cheatSetting ?? false;
    this.shops = structuredClone(options.shops ?? {});
    this.dirs = options.directions ?? DIRS;
  }

  public get tile(): { x: number; y: number } {
    return { x: Math.floor((this.body.px + 32) / 64), y: Math.floor((this.body.py + 40) / 64) };
  }

  public static declaration(cheatSetting: boolean): BodyDeclaration {
    const press = (id: string) => ({ id, kind: "press" as const, description: id });
    return {
      version: bodyProtocolVersion, adapter: "sim", game: "sim", writtenAt: new Date().toISOString(),
      state: { file: "world_state", world: "world_map", description: "Simulated body.", fields: [{ name: "map", description: "rows" }], legend: { ".": "walkable", "#": "blocked", "~": "water", W: "walk warp", D: "door" } },
      inputs: [
        ...Object.entries(DIRS).map(([id, [, , role]]) => ({ id, kind: "hold" as const, description: id, role })),
        { ...press("ControllerA"), role: "action" as const }, press("ControllerX"), press("ControllerB"), ...Array.from({ length: 12 }, (_, i) => press(`Slot${i + 1}`)),
        { id: "NoClip", kind: "modifier" as const, description: "cheat", cheat: true },
      ],
      limits: { maxSteps: 64, maxStepMs: 10_000, tickMs: TICK_MS, walkPxPerTick: SPEED, tilePx: 64 },
      cheats: { settingAllowed: cheatSetting },
    };
  }

  public async start(tickMs = 2): Promise<void> {
    // A sim tick runs faster than wall time so tests stay quick; durations still count ticks.
    this.timer = setInterval(() => { this.writing = this.writing.then(() => this.step()).catch(() => undefined); }, tickMs);
  }

  public async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await this.writing;
  }

  private async step(): Promise<void> {
    this.tick++;
    if (this.tick % 3 === 0) this.pollInput();
    const task = this.task;
    if (task !== undefined && !["done", "interrupted", "failed", "cancelled"].includes(task.status) && !this.paused) this.playTick(task);
    this.movedLastTick = this.body.px !== this.lastPx || this.body.py !== this.lastPy;
    this.lastPx = this.body.px;
    this.lastPy = this.body.py;
  }

  private pollInput(): void {
    if (this.task && this.cancelSeq === this.task.task.seq && !["done", "interrupted", "failed", "cancelled"].includes(this.task.status)) this.finish(this.task, "cancelled", "cancelled");
    const task = this.submitted;
    if (task === undefined || task.seq <= this.lastSeq) return;
    this.lastSeq = task.seq;
    this.inputsSeen.push(task);
    if (this.task && !["done", "interrupted", "failed", "cancelled"].includes(this.task.status)) {
      this.finish(this.task, "cancelled", "preempted");
    }
    const declared = this.declaredInputs();
    const ids = task.steps.flatMap((s) => [...(s.hold ?? []), ...(s.press ?? [])]);
    const unknown = ids.find((id) => !declared.some((d) => d.id === id));
    const cheat = ids.find((id) => declared.some((d) => d.id === id && d.cheat === true));
    this.task = { task, step: 0, stepTick: 0, ticks: task.steps.map((s) => s.ms <= 0 ? 1 : Math.max(1, Math.round(s.ms / TICK_MS))), events: [], status: "running", reason: null, startLocation: this.body.location, still: 0 };
    if (unknown !== undefined) this.finish(this.task, "failed", `unknown-input: ${unknown}`);
    else if (cheat !== undefined && !this.cheatSetting && !this.cheatGrant) this.finish(this.task, "failed", `cheat-off: ${cheat}`);
  }

  private playTick(task: SimTaskState): void {
    const until = task.task.until;
    const here = this.tile;
    if (until?.warped && this.body.location !== task.startLocation) return this.finish(task, "done", "warped");
    if (until?.arrive && until.arrive.location === this.body.location && Math.abs(until.arrive.x - here.x) <= until.arrive.radius && Math.abs(until.arrive.y - here.y) <= until.arrive.radius) return this.finish(task, "done", "arrived");
    if (until?.monsterWithin !== undefined) {
      const near = this.location().characters.filter((c) => c.kind === "monster").some((m) => Math.hypot(m.px - this.body.px, m.py - this.body.py) / 64 <= until.monsterWithin!);
      if (near) return this.finish(task, "interrupted", "monster");
    }
    if (task.stepTick >= task.ticks[task.step]) {
      task.step++;
      task.stepTick = 0;
      if (task.step >= task.ticks.length) return this.finish(task, "done", "completed");
    }
    const step = task.task.steps[task.step];
    const held = step.hold ?? [];
    if (task.stepTick === 0) for (const press of step.press ?? []) this.press(press, task);
    if (this.menu !== undefined && held.some((id) => id in this.dirs)) {
      // In a menu the pad moves the cursor once per push instead of walking.
      if (task.stepTick === 0) this.moveCursor(held.includes("DPadUp") ? -1 : 1);
      task.stepTick++;
      return;
    }
    task.stepTick++;
    const noClip = held.includes("NoClip");
    let moved = false;
    for (const id of held) {
      const d = this.dirs[id];
      if (d === undefined) continue;
      this.body.facing = d[2];
      const nx = this.body.px + d[0] * SPEED;
      const ny = this.body.py + d[1] * SPEED;
      const tx = Math.floor((nx + 32 + d[0] * 24) / 64);
      const ty = Math.floor((ny + 40 + d[1] * 16) / 64);
      const warp = this.location().warps.find((w) => w.kind === "walk" && w.x === tx && w.y === ty);
      if (warp) {
        const from = this.body.location;
        this.body.location = warp.to;
        this.body.px = warp.toX * 64;
        this.body.py = warp.toY * 64;
        task.events.push({ tick: this.tick, kind: "warped", detail: `${from} -> ${warp.to}` });
          return;
      }
      if (noClip || this.walkable(tx, ty)) { this.body.px = nx; this.body.py = ny; moved = true; }
    }
    if (held.some((id) => id in this.dirs)) {
      task.still = moved ? 0 : task.still + 1;
      if (until?.blockedMs !== undefined && task.still >= Math.round(until.blockedMs / TICK_MS)) this.finish(task, "interrupted", "blocked");
    }
  }

  protected press(id: string, task: SimTaskState): void {
    const note = (kind: string, detail: string) => { task.events.push({ tick: this.tick, kind, detail }); };
    if (this.menu !== undefined && (id === "ControllerA" || id === "ControllerB")) return this.pressMenu(id, note);
    if (id.startsWith("Slot")) { this.body.slot = Number(id.slice(4)) - 1; return; }
    const t = this.faced();
    const location = this.location();
    const at = location.objects.find((o) => o.x === t.x && o.y === t.y);
    const item = this.body.items[this.body.slot];
    if (id === "ControllerX") {
      if (item?.id === "(T)Hoe" && at === undefined && this.walkable(t.x, t.y)) {
        location.objects.push({ x: t.x, y: t.y, kind: "dirt", name: "Tilled Soil", extra: { passable: true, watered: false } });
        this.body.stamina -= 2;
        return note("used", `Hoe at ${t.x},${t.y}`);
      }
      if (item?.id === "(T)WateringCan" && at?.kind === "dirt") {
        at.extra = { ...at.extra, watered: true };
        return note("used", `Watering Can at ${t.x},${t.y}`);
      }
      if (item?.id?.startsWith("(W)")) {
        const hit = location.characters.findIndex((c) => c.kind === "monster" && Math.abs(c.x - t.x) + Math.abs(c.y - t.y) <= 0);
        if (hit >= 0) location.characters.splice(hit, 1);
        return note("used", `${item.name} swing${hit >= 0 ? " hit" : ""}`);
      }
      return note("used", `${item?.name ?? "nothing"} at ${t.x},${t.y}`);
    }
    if (id === "ControllerA") {
      if (at?.kind === "dirt" && at.extra?.ready === true) {
        const crop = String(at.extra.crop);
        at.extra = { passable: true, watered: false };
        at.name = "Tilled Soil";
        this.addItem({ id: `(O)${crop}`, name: crop, category: "Vegetable" });
        return note("harvested", `${crop} at ${t.x},${t.y}`);
      }
      if (at?.kind === "dirt" && at.extra?.crop === undefined && item?.category === "Seed") {
        at.extra = { ...at.extra, crop: item.name.replace(/ Seeds$/, ""), phase: 0, phases: 2, ready: false };
        at.name = "Crop";
        item.stack -= 1;
        if (item.stack <= 0) this.body.items[this.body.slot] = null;
        return note("planted", `${item.name} at ${t.x},${t.y}`);
      }
      if (at?.kind === "counter" && typeof at.extra?.shopId === "string") {
        this.menu = { shopId: at.extra.shopId, cursor: 0, at: { location: this.body.location, ...t } };
        return note("menu-opened", at.extra.shopId);
      }
      if (at?.kind === "forage") {
        location.objects.splice(location.objects.indexOf(at), 1);
        this.addItem({ id: at.id ?? at.name, name: at.name, category: "Forage" });
        return note("picked-up", `${at.name}`);
      }
      return note("nothing-there", `no action at ${t.x},${t.y}`);
    }
  }

  private moveCursor(delta: number): void {
    const menu = this.menu;
    const stock = menu === undefined ? [] : this.shops[menu.shopId] ?? [];
    if (menu !== undefined) menu.cursor = (menu.cursor + delta + stock.length) % Math.max(1, stock.length);
  }

  private pressMenu(id: string, note: (kind: string, detail: string) => void): void {
    const menu = this.menu!;
    const stock = this.shops[menu.shopId] ?? [];
    if (id === "ControllerB") { this.menu = undefined; return note("menu-closed", menu.shopId); }
    const entry = stock[menu.cursor];
    if (entry === undefined) return note("nothing-for-sale", menu.shopId);
    if (entry.stock === 0) return note("sold-out", entry.name);
    if (this.player.money < entry.price) return note("cant-afford", entry.name);
    this.player.money -= entry.price;
    if (entry.stock !== null) entry.stock--;
    this.addItem(entry);
    return note("bought", `1 x ${entry.name} for ${entry.price}g`);
  }

  /** Test hook: make every planted crop ready (a sim "night"). */
  public growAll(): void {
    this.day++;
    for (const location of this.locations.values()) for (const o of location.objects) {
      if (o.kind === "dirt" && o.extra?.crop !== undefined && o.extra.watered === true) o.extra = { ...o.extra, phase: 1, ready: true, watered: false };
    }
  }

  private addItem(item: { id: string; name: string; category: string }): void {
    const existing = this.body.items.find((i) => i?.id === item.id);
    if (existing) { existing.stack++; return; }
    const free = this.body.items.findIndex((i) => i === null);
    if (free >= 0) this.body.items[free] = { slot: free, id: item.id, name: item.name, stack: 1, category: item.category };
  }

  /** Gives the body an item; a port's own interactions use this. */
  protected gain(item: { id: string; name: string; category: string }): void { this.addItem(item); }

  /** The item count held, by name; a port's crafting reads this. */
  protected held(name: string): number { return this.body.items.find((i) => i?.name === name)?.stack ?? 0; }

  /** Takes n of one item away (tools and weapons are never taken); returns false when short. */
  protected spend(name: string, n: number): boolean {
    const item = this.body.items.find((i) => i?.name === name);
    if (item == null || item.stack < n) return false;
    item.stack -= n;
    if (item.stack <= 0) this.body.items[item.slot] = null;
    return true;
  }

  protected faced(): { x: number; y: number } {
    const t = this.tile;
    return this.body.facing === "up" ? { x: t.x, y: t.y - 1 } : this.body.facing === "down" ? { x: t.x, y: t.y + 1 } : this.body.facing === "left" ? { x: t.x - 1, y: t.y } : { x: t.x + 1, y: t.y };
  }

  protected location(): SimLocation { return this.locations.get(this.body.location)!; }

  private walkable(x: number, y: number): boolean {
    const location = this.location();
    const ch = location.rows[y]?.[x];
    if (ch !== "." && ch !== "W") return false;
    return !location.objects.some((o) => o.x === x && o.y === y && o.extra?.passable === false) && !location.characters.some((c) => c.x === x && c.y === y && c.kind !== "farmer");
  }

  private finish(task: SimTaskState, status: BodyTaskStatus["status"], reason: string): void {
    task.status = status;
    task.reason = reason;
    task.events.push({ tick: this.tick, kind: status, detail: reason });
    // A preempted task is no longer `this.task`, but its waiter still needs the outcome.
    this.finished.set(task.task.seq, { status, reason, events: task.events.slice(-32) });
    while (this.finished.size > 8) this.finished.delete(this.finished.keys().next().value!);
  }

  /** Records one event on the running task; a port's own button semantics use this. */
  protected note(task: SimTaskState, kind: string, detail: string): void {
    task.events.push({ tick: this.tick, kind, detail });
  }

  public snapshot(): BodyState {
    const location = this.location();
    const t = this.tile;
    return {
      version: bodyProtocolVersion, revision: ++this.revision, writtenAt: new Date().toISOString(), tick: this.tick, paused: this.paused,
      time: { day: this.day, season: "spring", dayOfMonth: this.day, year: 1, timeOfDay: 600 + this.tick % 1400, weather: "clear" },
      player: { location: this.player.location, x: this.player.x, y: this.player.y, px: this.player.x * 64, py: this.player.y * 64, facing: "down", name: "Tester", money: this.player.money, health: 100, stamina: 270, items: this.player.items },
      body: { location: this.body.location, x: t.x, y: t.y, px: this.body.px, py: this.body.py, facing: this.body.facing, present: true, moving: this.movedLastTick, health: this.health, selectedSlot: this.body.slot, stamina: this.body.stamina, money: this.player.money, items: this.body.items.filter((i): i is BodyItem => i !== null), activeTask: this.task && this.task.status === "running" ? this.task.task.seq : null, menu: this.menuState() },
      map: { location: location.name, width: location.rows[0].length, height: location.rows.length, rows: location.rows },
      objects: location.objects, characters: location.characters, warps: location.warps, truncated: { objects: 0 },
    };
  }

  private menuState(): NonNullable<BodyState["body"]>["menu"] {
    const menu = this.menu;
    if (menu === undefined) return null;
    const t = this.tile;
    if (menu.at.location !== this.body.location || Math.abs(menu.at.x - t.x) + Math.abs(menu.at.y - t.y) > 2) { this.menu = undefined; return null; }
    const stock = this.shops[menu.shopId] ?? [];
    return {
      kind: "ShopMenu", focus: stock[menu.cursor] === undefined ? null : `#${menu.cursor} ${stock[menu.cursor].name}`, options: stock.map((item) => item.name), money: this.player.money,
      stock: stock.map((item, index) => ({ index, id: item.id, name: item.name, price: item.price, stock: item.stock })),
    };
  }

  /** The inputs this sim accepts; a port with its own controller overrides this and `declaration`. */
  protected declaredInputs(): ReturnType<typeof SimAdapter.declaration>["inputs"] { return SimAdapter.declaration(this.cheatSetting).inputs; }

  // The body port, in memory.
  public declaration(): Promise<BodyDeclaration> { return Promise.resolve(SimAdapter.declaration(this.cheatSetting)); }
  public state(): Promise<BodyState> { return Promise.resolve(this.snapshot()); }

  public world(): Promise<BodyWorld> {
    return Promise.resolve({
      version: bodyProtocolVersion, writtenAt: new Date().toISOString(),
      locations: [...this.locations.values()].map((l) => ({ name: l.name, displayName: l.name, outdoors: true, warps: l.warps })),
    });
  }

  public async run(steps: readonly BodyInputStep[], options: RunOptions = {}): Promise<BodyRun> {
    const started = Date.now();
    const task: BodyTask = {
      version: bodyProtocolVersion, taskId: randomUUID(), seq: (this.submitted?.seq ?? 0) + 1, createdAt: new Date().toISOString(), steps: [...steps],
      ...(options.until === undefined ? {} : { until: options.until }), ...(options.fastState === true ? { fastState: true } : {}),
    };
    this.submitted = task;
    // Like the game's channel, only unpaused time counts against the budget.
    let budget = options.timeoutMs ?? steps.reduce((sum, step) => sum + Math.max(step.ms, 17), 0) + 15_000;
    let last = started;
    for (;;) {
      const now = Date.now();
      if (!this.paused) budget -= now - last;
      last = now;
      const current = this.task?.task.seq === task.seq ? this.task : undefined;
      const ended = current !== undefined && ["done", "interrupted", "failed", "cancelled"].includes(current.status)
        ? { status: current.status, reason: current.reason, events: current.events.slice(-32) }
        : this.finished.get(task.seq);
      if (ended !== undefined) {
        return { seq: task.seq, status: ended.status, reason: ended.reason, events: ended.events, state: this.snapshot(), acceptMs: undefined, totalMs: Date.now() - started };
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


  public grantCheats(granted: boolean): Promise<string> {
    this.cheatGrant = granted;
    return Promise.resolve(granted ? "cheats granted for this save" : "cheats withdrawn for this save");
  }
}
