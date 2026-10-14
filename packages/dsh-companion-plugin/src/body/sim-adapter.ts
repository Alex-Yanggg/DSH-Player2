import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bodyProtocolVersion,
  bodyTaskSchema,
  type BodyCharacter,
  type BodyDeclaration,
  type BodyEvent,
  type BodyItem,
  type BodyObject,
  type BodyState,
  type BodyTask,
  type BodyTaskStatus,
  type BodyWarp,
} from "@dsh-player2/contracts";

/**
 * A keyless stand-in for the Stardew body adapter, speaking the same file
 * protocol (P2-0021). Replays and tests use it to drive the plugin-side
 * client, navigation, goal tools and reflexes without a game. Its world is a
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
}

const DIRS: Record<string, [number, number]> = { MoveUp: [0, -1], MoveRight: [1, 0], MoveDown: [0, 1], MoveLeft: [-1, 0] };
const FACES: Record<string, BodyState["body"] extends infer B ? B extends { facing: infer F } ? F : never : never> = { FaceUp: "up", FaceRight: "right", FaceDown: "down", FaceLeft: "left" };
const TICK_MS = 1000 / 60;
const SPEED = 4;

export class SimAdapter {
  public readonly locations: Map<string, SimLocation>;
  public body: { location: string; px: number; py: number; facing: "up" | "right" | "down" | "left"; slot: number; items: (BodyItem | null)[]; stamina: number };
  public player: { location: string; x: number; y: number; items: BodyItem[]; money: number };
  public day = 1;
  public paused = false;
  public cheatSetting: boolean;
  public cheatGrant = false;
  private timer: NodeJS.Timeout | undefined;
  private tick = 0;
  private revision = 0;
  private lastSeq = 0;
  private task: { task: BodyTask; step: number; stepTick: number; ticks: number[]; events: BodyEvent[]; status: BodyTaskStatus["status"]; reason: string | null; update: number; startLocation: string; still: number } | undefined;
  private writing: Promise<void> = Promise.resolve();
  public readonly inputsSeen: BodyTask[] = [];
  private readonly shops: NonNullable<SimOptions["shops"]>;
  private menu: { shopId: string; cursor: number; at: { location: string; x: number; y: number } } | undefined;

  public constructor(private readonly session: string, options: SimOptions) {
    this.locations = new Map(options.locations.map((location) => [location.name, location]));
    const items: (BodyItem | null)[] = Array.from({ length: 12 }, () => null);
    for (const item of options.body.items) items[item.slot] = item;
    this.body = { location: options.body.location, px: options.body.x * 64, py: options.body.y * 64, facing: "down", slot: 0, items, stamina: 270 };
    this.player = options.player ?? { location: options.body.location, x: options.body.x + 2, y: options.body.y, items: [], money: 500 };
    this.cheatSetting = options.cheatSetting ?? false;
    this.shops = structuredClone(options.shops ?? {});
  }

  public get tile(): { x: number; y: number } {
    return { x: Math.floor((this.body.px + 32) / 64), y: Math.floor((this.body.py + 40) / 64) };
  }

  public static declaration(cheatSetting: boolean): BodyDeclaration {
    const press = (id: string) => ({ id, kind: "press" as const, description: id });
    return {
      version: bodyProtocolVersion, adapter: "sim", game: "sim", writtenAt: new Date().toISOString(),
      state: { file: "state.json", world: "world.json", description: "Simulated body.", fields: [{ name: "map", description: "rows" }], legend: { ".": "walkable", "#": "blocked", "~": "water", W: "walk warp", D: "door" } },
      inputs: [
        ...Object.keys(DIRS).map((id) => ({ id, kind: "hold" as const, description: id })),
        ...Object.keys(FACES).map(press), press("UseTool"), press("Action"), press("DropItem"),
        press("MenuUp"), press("MenuDown"), press("MenuConfirm"), press("MenuClose"),
        ...Array.from({ length: 12 }, (_, i) => press(`Slot${i + 1}`)),
        { id: "NoClip", kind: "modifier" as const, description: "cheat", cheat: true },
      ],
      limits: { maxSteps: 64, maxStepMs: 10_000, tickMs: TICK_MS, walkPxPerTick: SPEED, tilePx: 64 },
      cheats: { settingAllowed: cheatSetting },
    };
  }

  public async start(tickMs = 2): Promise<void> {
    await mkdir(join(this.session, "body", "input"), { recursive: true });
    await mkdir(join(this.session, "body", "status"), { recursive: true });
    await this.writeJson("declaration.json", SimAdapter.declaration(this.cheatSetting));
    await this.writeJson("world.json", {
      version: bodyProtocolVersion, writtenAt: new Date().toISOString(),
      locations: [...this.locations.values()].map((l) => ({ name: l.name, displayName: l.name, outdoors: true, warps: l.warps })),
    });
    await this.writeState();
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
    if (this.tick % 3 === 0) await this.pollInput();
    const task = this.task;
    if (task !== undefined && !["done", "interrupted", "failed", "cancelled"].includes(task.status) && !this.paused) this.playTick(task);
    if (this.tick % 3 === 0 || (task !== undefined && task.update !== this.writtenUpdate)) {
      await this.writeState();
      if (task !== undefined && task.update !== this.writtenUpdate) await this.writeStatus();
    }
  }

  private writtenUpdate = -1;

  private async pollInput(): Promise<void> {
    const input = join(this.session, "body", "input");
    const names = await readdir(input).catch(() => [] as string[]);
    const cancels = new Set(names.map((n) => /^cancel-(\d+)\.json$/.exec(n)?.[1]).filter(Boolean).map(Number));
    if (this.task && cancels.has(this.task.task.seq) && !["done", "interrupted", "failed", "cancelled"].includes(this.task.status)) this.finish(this.task, "cancelled", "cancelled");
    const seqs = names.map((n) => /^task-(\d+)\.json$/.exec(n)?.[1]).filter(Boolean).map(Number).filter((n) => n > this.lastSeq).sort((a, b) => a - b);
    if (seqs.length === 0) return;
    const seq = seqs[seqs.length - 1];
    this.lastSeq = seq;
    const task = bodyTaskSchema.parse(JSON.parse(await readFile(join(input, `task-${seq}.json`), "utf8")));
    this.inputsSeen.push(task);
    if (this.task && !["done", "interrupted", "failed", "cancelled"].includes(this.task.status)) {
      this.finish(this.task, "cancelled", "preempted");
      await this.writeStatus();
    }
    const declared = SimAdapter.declaration(this.cheatSetting).inputs;
    const ids = task.steps.flatMap((s) => [...(s.hold ?? []), ...(s.press ?? [])]);
    const unknown = ids.find((id) => !declared.some((d) => d.id === id));
    const cheat = ids.find((id) => declared.some((d) => d.id === id && d.cheat === true));
    this.task = { task, step: 0, stepTick: 0, ticks: task.steps.map((s) => s.ms <= 0 ? 1 : Math.max(1, Math.round(s.ms / TICK_MS))), events: [], status: "running", reason: null, update: 1, startLocation: this.body.location, still: 0 };
    if (unknown !== undefined) this.finish(this.task, "failed", `unknown-input: ${unknown}`);
    else if (cheat !== undefined && !this.cheatSetting && !this.cheatGrant) this.finish(this.task, "failed", `cheat-off: ${cheat}`);
  }

  private playTick(task: NonNullable<SimAdapter["task"]>): void {
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
      task.update++;
      if (task.step >= task.ticks.length) return this.finish(task, "done", "completed");
    }
    const step = task.task.steps[task.step];
    if (task.stepTick === 0) for (const press of step.press ?? []) this.press(press, task);
    task.stepTick++;
    const held = step.hold ?? [];
    const noClip = held.includes("NoClip");
    let moved = false;
    for (const id of held) {
      const d = DIRS[id];
      if (d === undefined) continue;
      this.body.facing = id === "MoveUp" ? "up" : id === "MoveRight" ? "right" : id === "MoveDown" ? "down" : "left";
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
        task.update++;
        return;
      }
      if (noClip || this.walkable(tx, ty)) { this.body.px = nx; this.body.py = ny; moved = true; }
    }
    if (held.some((id) => id in DIRS)) {
      task.still = moved ? 0 : task.still + 1;
      if (until?.blockedMs !== undefined && task.still >= Math.round(until.blockedMs / TICK_MS)) this.finish(task, "interrupted", "blocked");
    }
  }

  private press(id: string, task: NonNullable<SimAdapter["task"]>): void {
    const note = (kind: string, detail: string) => { task.events.push({ tick: this.tick, kind, detail }); task.update++; };
    if (id in FACES) { this.body.facing = FACES[id]; return; }
    if (id.startsWith("Menu")) return this.pressMenu(id, note);
    const slot = /^Slot(\d+)$/.exec(id);
    if (slot) { this.body.slot = Number(slot[1]) - 1; return; }
    const t = this.faced();
    const location = this.location();
    const at = location.objects.find((o) => o.x === t.x && o.y === t.y);
    const item = this.body.items[this.body.slot];
    if (id === "UseTool") {
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
    if (id === "Action") {
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
    if (id === "DropItem") {
      if (item === null || item === undefined) return note("nothing-to-drop", "empty");
      this.body.items[this.body.slot] = null;
      const p = this.player;
      const target = p.items.find((i) => i.id === item.id);
      if (target) target.stack += item.stack; else p.items.push({ ...item, slot: p.items.length });
      return note("dropped", `${item.stack} x ${item.name}`);
    }
  }

  private pressMenu(id: string, note: (kind: string, detail: string) => void): void {
    const menu = this.menu;
    const stock = menu === undefined ? undefined : this.shops[menu.shopId];
    if (menu === undefined || stock === undefined) return note("no-menu", "no menu is open");
    if (id === "MenuClose") { this.menu = undefined; return note("menu-closed", menu.shopId); }
    if (id === "MenuUp" || id === "MenuDown") {
      menu.cursor = (menu.cursor + (id === "MenuUp" ? -1 : 1) + stock.length) % Math.max(1, stock.length);
      return note("cursor", `#${menu.cursor}`);
    }
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

  private faced(): { x: number; y: number } {
    const t = this.tile;
    return this.body.facing === "up" ? { x: t.x, y: t.y - 1 } : this.body.facing === "down" ? { x: t.x, y: t.y + 1 } : this.body.facing === "left" ? { x: t.x - 1, y: t.y } : { x: t.x + 1, y: t.y };
  }

  private location(): SimLocation { return this.locations.get(this.body.location)!; }

  private walkable(x: number, y: number): boolean {
    const location = this.location();
    const ch = location.rows[y]?.[x];
    if (ch !== "." && ch !== "W") return false;
    return !location.objects.some((o) => o.x === x && o.y === y && o.extra?.passable === false) && !location.characters.some((c) => c.x === x && c.y === y && c.kind !== "farmer");
  }

  private finish(task: NonNullable<SimAdapter["task"]>, status: BodyTaskStatus["status"], reason: string): void {
    task.status = status;
    task.reason = reason;
    task.events.push({ tick: this.tick, kind: status, detail: reason });
    task.update++;
  }

  private async writeStatus(): Promise<void> {
    const task = this.task;
    if (task === undefined) return;
    this.writtenUpdate = task.update;
    const status: BodyTaskStatus = {
      version: bodyProtocolVersion, taskId: task.task.taskId, seq: task.task.seq, status: task.status, update: task.update,
      step: task.step, events: task.events.slice(-32), reason: task.reason, stateRevision: this.revision, updatedAt: new Date().toISOString(),
    };
    await this.writeJson(join("status", `task-${task.task.seq}.json`), status);
  }

  public snapshot(): BodyState {
    const location = this.location();
    const t = this.tile;
    return {
      version: bodyProtocolVersion, revision: ++this.revision, writtenAt: new Date().toISOString(), tick: this.tick, paused: this.paused,
      time: { day: this.day, season: "spring", dayOfMonth: this.day, year: 1, timeOfDay: 600 + this.tick % 1400, weather: "clear" },
      player: { location: this.player.location, x: this.player.x, y: this.player.y, px: this.player.x * 64, py: this.player.y * 64, facing: "down", name: "Tester", money: this.player.money, health: 100, stamina: 270, items: this.player.items },
      body: { location: this.body.location, x: t.x, y: t.y, px: this.body.px, py: this.body.py, facing: this.body.facing, present: true, moving: false, selectedSlot: this.body.slot, stamina: this.body.stamina, items: this.body.items.filter((i): i is BodyItem => i !== null), activeTask: this.task && this.task.status === "running" ? this.task.task.seq : null, menu: this.menuState() },
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
      kind: "shop", shopId: menu.shopId, title: menu.shopId, cursor: menu.cursor, money: this.player.money,
      items: stock.map((item, index) => ({ index, id: item.id, name: item.name, category: item.category, price: item.price, stock: item.stock, tradeItem: null })),
    };
  }

  private async writeState(): Promise<void> {
    await this.writeJson("state.json", this.snapshot());
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    const path = join(this.session, "body", name);
    const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(temp, JSON.stringify(value), "utf8");
    await rename(temp, path);
  }
}
