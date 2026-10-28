import { readFileSync } from "node:fs";
import { parseReflexTable, type BodyDeclaration, type BodyInputStep, type BodyState, type BodyWorld, type ReflexBurst, type ReflexCondition, type ReflexRow, type ReflexTable } from "@dsh-player2/contracts";
import { sleep, type BodyPort, type BodyRun, type RunOptions } from "./port.js";

/**
 * The reflex tier (P2-0019 T1): a per-game data table of sub-second
 * interrupts, evaluated in the plugin against the raw state between and
 * during body calls. When a row's facts hold, the engine takes the controller
 * for one raw input burst through the same body port the mind uses, then
 * always tells the mind what fired. Everything semantic stays out: the state
 * is read as exported, bursts are the game's own buttons, and no row knows a
 * goal or a route.
 */

/** Buttons for the four movement roles, from the adapter's own declaration. */
export type RoleButtons = Record<"up" | "right" | "down" | "left", string>;

export interface ReflexEngineOptions {
  readonly table: ReflexTable;
  /** The persona's appetite for risk (0..1): bold ones eat later and back off closer. */
  readonly risk?: number;
  /** Stamp for cooldowns; tests replace it. */
  readonly now?: () => number;
}

/** How far the risk knob moves a threshold: 1.3x for the timid, 0.7x for the bold, 1x at 0.5. */
export function riskScale(risk: number | undefined): number {
  return 1.3 - 0.6 * (risk ?? 0.5);
}

/** Pure evaluation and burst building, separated from the loop so tests drive it directly. */
export class ReflexEngine {
  private readonly fired = new Map<string, number>();
  /** Position history for the stuck condition; updated by the owner before each evaluation. */
  private stillSince: number | null = null;
  /** Whether the running input holds a movement button; set by the owner. Standing still to swing or wait is not stuck. */
  public walking = false;
  private lastPx = NaN;
  private lastPy = NaN;
  /** The rows in play: the shipped table, or what the save grew on top of it. */
  public rows: readonly ReflexRow[];

  public constructor(private readonly options: ReflexEngineOptions) {
    this.rows = options.table.rows;
  }

  private get now(): number { return this.options.now?.() ?? Date.now(); }

  /** The first row whose `when` holds and whose cooldown has passed, with its burst ready to play. */
  public match(state: BodyState, roles: RoleButtons): { row: ReflexRow; monster: MonsterFact | null; item: string | null; steps: BodyInputStep[] } | null {
    if (state.paused || state.body === null || !state.body.present) return null;
    const monster = nearestMonster(state);
    for (const row of this.rows) {
      const since = this.fired.get(row.id);
      if (since !== undefined && this.now - since < (row.cooldownMs ?? 0)) continue;
      const scale = riskScale(this.options.risk);
      if (!holds(row.when.all, state, monster, this, scale) || (row.when.none?.some((one: ReflexCondition) => holds([one], state, monster, this, scale)) ?? false)) continue;
      const burst = this.build(row.do, state, monster, roles);
      if (burst === null) continue;
      return { row, monster, item: burst.item, steps: burst.steps };
    }
    return null;
  }

  /** The burst steps for one row, or null when the raw state cannot serve it (nothing to eat, nobody to face). */
  public build(burst: ReflexBurst, state: BodyState, monster: MonsterFact | null, roles: RoleButtons): { steps: BodyInputStep[]; item: string | null } | null {
    const body = state.body;
    if (body === null) return null;
    switch (burst.kind) {
      case "steps":
        return { steps: burst.steps, item: null };
      case "useItem": {
        const slot = matchingSlot(body, burst.match);
        return slot === null ? null : { steps: [{ press: [`Slot${slot + 1}`], ms: 0 }, ...burst.steps], item: body.items[slot]?.name ?? null };
      }
      case "swingAtMonster": {
        if (monster === null) return null;
        const face = faceStep(monster, body, roles);
        const slot = burst.match === undefined ? null : matchingSlot(body, burst.match);
        const select = slot === null ? [] : [{ press: [`Slot${slot + 1}`], ms: 0 } as BodyInputStep];
        const item = slot === null ? null : body.items[slot]?.name ?? null;
        return { steps: [face, ...select, ...burst.steps], item };
      }
      case "stepAway": {
        if (monster === null) return null;
        const away = awayStep(monster, body, roles);
        return away === null ? null : { steps: [{ hold: [away], ms: burst.ms }], item: null };
      }
    }
  }

  /** Cooldown bookkeeping after a row fired. */
  public didFire(id: string): void {
    this.fired.set(id, this.now);
  }

  /** Feeds displacement for the stuck condition; call with every evaluated state. */
  public observe(state: BodyState): void {
    const body = state.body;
    if (body === null || !this.walking || body.px !== this.lastPx || body.py !== this.lastPy) {
      this.lastPx = body?.px ?? NaN;
      this.lastPy = body?.py ?? NaN;
      this.stillSince = null;
      return;
    }
    this.stillSince ??= this.now;
  }

  /** How long the body has not moved, for the `stuckFor` condition. */
  public stuckMs(): number {
    if (this.stillSince === null) return 0;
    return this.now - this.stillSince;
  }
}

/** The nearest monster of the body's location, as the exported state holds it. */
export interface MonsterFact { readonly name: string; readonly px: number; readonly py: number; readonly tiles: number }

export function nearestMonster(state: BodyState): MonsterFact | null {
  const body = state.body ?? state.player;
  let best: MonsterFact | null = null;
  for (const character of state.characters) {
    if (character.kind !== "monster") continue;
    const tiles = Math.hypot(character.px - body.px, character.py - body.py) / 64;
    if (best === null || tiles < best.tiles) best = { name: character.name, px: character.px, py: character.py, tiles };
  }
  return best;
}

function holds(conditions: readonly ReflexCondition[], state: BodyState, monster: MonsterFact | null, engine: ReflexEngine, scale = 1): boolean {
  const body = state.body;
  if (body === null) return false;
  return conditions.every((condition) => {
    switch (condition.kind) {
      case "healthBelow": return body.health !== undefined && body.health < condition.value * scale;
      case "staminaBelow": return body.stamina < condition.value * scale;
      case "monsterWithin": return monster !== null && monster.tiles <= condition.tiles * scale;
      case "hasItem": return matchingSlot(body, condition) !== null;
      case "stuckFor": return body.activeTask !== null && engine.walking && engine.stuckMs() >= condition.ms;
    }
  });
}

function matchingSlot(body: NonNullable<BodyState["body"]>, match: { category?: string; name?: string }): number | null {
  const hit = body.items.find((item) => (match.category === undefined || item.category === match.category) && (match.name === undefined || item.name.includes(match.name)));
  return hit === undefined ? null : hit.slot;
}

function faceStep(monster: MonsterFact, body: NonNullable<BodyState["body"]>, roles: RoleButtons): BodyInputStep {
  const dx = monster.px - body.px;
  const dy = monster.py - body.py;
  const button = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? roles.right : roles.left) : (dy >= 0 ? roles.down : roles.up);
  return { hold: [button], ms: 150 };
}

function awayStep(monster: MonsterFact, body: NonNullable<BodyState["body"]>, roles: RoleButtons): string | null {
  const dx = monster.px - body.px;
  const dy = monster.py - body.py;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? roles.left : roles.right) : (dy >= 0 ? roles.up : roles.down);
}

/**
 * Whether a fired row helped, read from raw state a few seconds later: every
 * measurable trigger fact eased (health or stamina up, the monster gone or out
 * of range, the stuck body moved). Null when no trigger fact is measurable.
 */
export function judgeReflex(row: ReflexRow, before: BodyState, after: BodyState): boolean | null {
  const was = before.body;
  const now = after.body;
  if (was === null || now === null) return null;
  const verdicts: boolean[] = [];
  for (const condition of row.when.all) {
    switch (condition.kind) {
      case "healthBelow":
        if (was.health !== undefined && now.health !== undefined) verdicts.push(now.health > was.health);
        break;
      case "staminaBelow": verdicts.push(now.stamina > was.stamina); break;
      case "monsterWithin": {
        const monster = nearestMonster(after);
        verdicts.push(monster === null || monster.tiles > condition.tiles);
        break;
      }
      case "stuckFor": verdicts.push(Math.hypot(now.px - was.px, now.py - was.py) >= 32); break;
      case "hasItem": break;
    }
  }
  return verdicts.length === 0 ? null : verdicts.every(Boolean);
}

/** The fact line the mind receives, with the row's placeholders filled from raw state. */
export function renderFact(row: ReflexRow, state: BodyState, monster: MonsterFact | null, item: string | null): string {
  const body = state.body;
  return row.fact
    .replaceAll("{health}", body?.health === undefined ? "?" : String(Math.round(body.health)))
    .replaceAll("{stamina}", body === null ? "?" : String(Math.round(body.stamina)))
    .replaceAll("{item}", item ?? "nothing")
    .replaceAll("{monster}", monster?.name ?? "monster")
    .replaceAll("{distance}", monster === null ? "?" : monster.tiles.toFixed(1));
}

export interface ReflexBodyOptions {
  readonly table: ReflexTable;
  /** Fast state poll cadence; also the reflex latency budget (default 200 ms). */
  readonly intervalMs?: number;
  /** The persona's risk knob; see `riskScale`. */
  readonly risk?: number;
  readonly onFact: (fact: string) => void;
  /** Each fired row's verdict, `outcomeMs` after its burst (reflex growth). */
  readonly onOutcome?: (id: string, good: boolean) => void;
  readonly outcomeMs?: number;
  readonly onError?: (error: unknown) => void;
}

/**
 * The body port with reflexes: every `run` asks the adapter for fast state,
 * and a poll loop between and during calls evaluates the table. A fired row
 * cancels the running task, plays its burst, and reports the fact. `stop`
 * ends the loop; the wrapped port is untouched.
 */
export class ReflexBody implements BodyPort {
  private readonly engine: ReflexEngine;
  private readonly intervalMs: number;
  private roles: RoleButtons | undefined;
  private stopped = false;
  private firing = false;
  private failures = 0;

  public constructor(private readonly inner: BodyPort, private readonly options: ReflexBodyOptions) {
    this.engine = new ReflexEngine({ table: options.table, risk: options.risk });
    this.intervalMs = options.intervalMs ?? 200;
  }

  /** Starts the between-calls poll loop. */
  public start(): void {
    void this.loop();
  }

  public stop(): void {
    this.stopped = true;
  }

  /** Swaps the rows in play (a save's grown rows over the shipped table). */
  public setRows(rows: readonly ReflexRow[]): void {
    this.engine.rows = rows;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      await sleep(this.intervalMs * (this.failures > 0 ? 5 : 1));
      if (this.stopped || this.firing) continue;
      try {
        const state = await this.inner.state();
        this.failures = 0;
        this.roles ??= roleButtons(await this.inner.declaration());
        this.engine.observe(state);
        const hit = this.engine.match(state, this.roles);
        if (hit !== null) await this.fire(hit.row, state, hit.monster, hit.item, hit.steps);
      } catch (error) {
        if (this.failures === 0) this.options.onError?.(error);
        this.failures++;
      }
    }
  }

  /** One row's burst: take the controller, play it, tell the mind. */
  private async fire(row: ReflexRow, state: BodyState, monster: MonsterFact | null, item: string | null, steps: readonly BodyInputStep[]): Promise<void> {
    this.firing = true;
    try {
      if (state.body?.activeTask != null) await this.inner.cancelActive().catch(() => undefined);
      const run = await this.inner.run(steps, this.burstOptions(steps));
      this.engine.didFire(row.id);
      this.options.onFact(`${renderFact(row, state, monster, item)} (${run.status})`);
      if (this.options.onOutcome !== undefined) void this.judgeLater(row, state);
    } finally {
      this.firing = false;
    }
  }

  /** Reads the state again after the outcome window and reports whether the row helped. */
  private async judgeLater(row: ReflexRow, before: BodyState): Promise<void> {
    await sleep(this.options.outcomeMs ?? 4_000);
    if (this.stopped) return;
    try {
      const verdict = judgeReflex(row, before, await this.inner.state());
      if (verdict !== null) this.options.onOutcome!(row.id, verdict);
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  /** A burst never waits longer than its own steps plus a short margin. */
  private burstOptions(steps: readonly BodyInputStep[]): RunOptions {
    return { fastState: true, timeoutMs: steps.reduce((sum, step) => sum + Math.max(step.ms, 17), 0) + 3_000 };
  }

  public declaration(): Promise<BodyDeclaration> { return this.inner.declaration(); }
  public state(): Promise<BodyState> { return this.inner.state(); }
  public world(): Promise<BodyWorld> { return this.inner.world(); }
  public grantCheats(granted: boolean, quote: string): Promise<string> { return this.inner.grantCheats(granted, quote); }
  public cancelActive(): Promise<void> { return this.inner.cancelActive(); }

  public async run(steps: readonly BodyInputStep[], options: RunOptions = {}): Promise<BodyRun> {
    this.roles ??= roleButtons(await this.inner.declaration());
    const move = Object.values(this.roles);
    this.engine.walking = steps.some((step) => step.hold?.some((button) => move.includes(button)) ?? false);
    try {
      return await this.inner.run(steps, { ...options, fastState: true });
    } finally {
      this.engine.walking = false;
    }
  }
}

const DEFAULT_ROLE_BUTTONS: RoleButtons = { up: "DPadUp", right: "DPadRight", down: "DPadDown", left: "DPadLeft" };

/** Movement buttons from the adapter's declaration, which tags each input with its role. */
export function roleButtons(declaration: BodyDeclaration): RoleButtons {
  const roles: RoleButtons = { ...DEFAULT_ROLE_BUTTONS };
  for (const input of declaration.inputs) {
    if (input.role === "up" || input.role === "right" || input.role === "down" || input.role === "left") roles[input.role] = input.id;
  }
  return roles;
}

/**
 * One game's shipped table from `reflexes/<game>.json` beside the built code
 * (two levels up from this module, both in `src/body` and `dist/body`). A
 * missing table means the mind alone; an invalid one is an error, never a
 * silent empty table.
 */
export function loadReflexTable(game: string): ReflexTable | null {
  let text: string;
  try {
    text = readFileSync(new URL(`../../reflexes/${game}.json`, import.meta.url), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return parseReflexTable(JSON.parse(text));
  } catch (error) {
    throw new Error(`reflexes/${game}.json is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}
