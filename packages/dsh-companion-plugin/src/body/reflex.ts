import type { BodyCharacter, BodyDeclaration, BodyState } from "@dsh-player2/contracts";
import { sleep, type BodyPort } from "./client.js";
import { seededUniform } from "./knobs.js";
import { directionTo, faceButton, findPath, moveButton, neighbours, pathToSteps, walkMs, Walkability, type Direction } from "./navigation.js";

/**
 * Reflex scripts (P2-0021 T21.5, D17): closed loops that run at the game's
 * pace on the plugin side. The model sets the tactic and its parameters; the
 * script reads state, turns, swings and steps; events end it and come back as
 * a report. v0 covers one tactic: Stardew mine melee.
 */

export interface MeleeTactic {
  /** How long the loop may run, in seconds. */
  readonly seconds: number;
  /** Chase monsters up to this many tiles away. */
  readonly chaseTiles: number;
  /** Stop once this many monsters have gone (0 = until the time is up or none are left). */
  readonly targetKills: number;
}

export interface MeleeHands {
  readonly reactionMs: number;
  readonly aimError: number;
}

export interface ReflexReport {
  readonly endedBy: "time" | "clear" | "kills" | "aborted" | "no-weapon" | "no-body" | "error";
  readonly swings: number;
  readonly steps: number;
  readonly monstersGone: number;
  /** Age of the state each decision was made on (ms), median and p95. */
  readonly stateAgeMs: { readonly p50: number; readonly p95: number };
  /** Write-to-accept round trip of each input (ms), median and p95. */
  readonly acceptMs: { readonly p50: number; readonly p95: number };
  readonly detail: string;
}

export async function runMelee(body: BodyPort, limits: BodyDeclaration["limits"], tactic: MeleeTactic, hands: MeleeHands, seed: string, signal?: AbortSignal): Promise<ReflexReport> {
  const started = Date.now();
  const stateAges: number[] = [];
  const accepts: number[] = [];
  let swings = 0;
  let steps = 0;
  let decisions = 0;
  let gone = 0;
  let known: readonly BodyCharacter[] = [];
  const finish = (endedBy: ReflexReport["endedBy"], detail: string): ReflexReport => ({
    endedBy, swings, steps, monstersGone: gone,
    stateAgeMs: percentiles(stateAges), acceptMs: percentiles(accepts), detail,
  });
  let state = await body.state();
  if (state.body === null) return finish("no-body", "the companion is not in the world");
  const weapon = state.body.items.find((item) => item.id.startsWith("(W)") && item.id !== "(W)47");
  if (weapon === undefined) return finish("no-weapon", "no weapon on the body's toolbar");
  const select = await body.run([{ press: [`Slot${weapon.slot + 1}`], ms: 0 }], { fastState: true, ...(signal ? { signal } : {}) });
  if (select.acceptMs !== undefined) accepts.push(select.acceptMs);
  while (!signal?.aborted) {
    if (Date.now() - started > tactic.seconds * 1000) return finish("time", `ran ${tactic.seconds} s`);
    state = await body.state();
    const self = state.body;
    if (self === null) return finish("no-body", "the companion left the world");
    const monsters = state.characters.filter((c) => c.kind === "monster" && (c.health ?? 1) > 0);
    gone += countGone(known, monsters);
    known = monsters;
    if (tactic.targetKills > 0 && gone >= tactic.targetKills) return finish("kills", `${gone} monsters gone`);
    const target = nearest(self, monsters, tactic.chaseTiles);
    if (target === undefined) return finish("clear", `no monster within ${tactic.chaseTiles} tiles`);
    decisions++;
    stateAges.push(Math.max(0, Date.now() - Date.parse(state.writtenAt)));
    const distance = tileDistance(self, target);
    let direction: Direction = directionTo({ x: self.px / limits.tilePx, y: self.py / limits.tilePx }, { x: target.px / limits.tilePx, y: target.py / limits.tilePx });
    if (distance <= 1.4) {
      if (seededUniform(seed, decisions, "aim") < hands.aimError) direction = (["up", "right", "down", "left"] as const)[Math.floor(seededUniform(seed, decisions, "wrong") * 4)];
      const run = await body.run([{ press: [faceButton(direction), "UseTool"], ms: 250 }], { fastState: true, ...(signal ? { signal } : {}) });
      swings++;
      if (run.acceptMs !== undefined) accepts.push(run.acceptMs);
      if (run.status === "failed") return finish("error", run.reason ?? "the swing failed");
    } else {
      // Step in along the map when walls are in the way; straight at it otherwise.
      const from = { x: self.x, y: self.y };
      const path = findPath(new Walkability(state), from, neighbours({ x: target.x, y: target.y }, from), 4_000);
      const approach = path !== undefined && path.length > 1
        ? pathToSteps(path.slice(0, 3), limits)
        : [{ hold: [moveButton(direction)], ms: walkMs(Math.min(2, Math.max(1, Math.round(distance - 1))), limits) }];
      const run = await body.run(approach, { until: { monsterWithin: 1.2, blockedMs: 400 }, fastState: true, ...(signal ? { signal } : {}) });
      steps++;
      if (run.acceptMs !== undefined) accepts.push(run.acceptMs);
      if (run.status === "failed") return finish("error", run.reason ?? "the step failed");
    }
    await sleep(hands.reactionMs, signal);
  }
  return finish("aborted", "stopped by the goal lane");
}

function tileDistance(self: { px: number; py: number }, other: { px: number; py: number }): number {
  return Math.hypot(self.px - other.px, self.py - other.py) / 64;
}

function nearest(self: NonNullable<BodyState["body"]>, monsters: readonly BodyCharacter[], within: number): BodyCharacter | undefined {
  let best: BodyCharacter | undefined;
  let bestDistance = Infinity;
  for (const monster of monsters) {
    const d = tileDistance(self, monster);
    if (d <= within && d < bestDistance) { best = monster; bestDistance = d; }
  }
  return best;
}

/** Monsters that were tracked last tick and have no close match now. */
function countGone(previous: readonly BodyCharacter[], now: readonly BodyCharacter[]): number {
  let gone = 0;
  for (const old of previous) {
    const survived = now.some((m) => m.name === old.name && Math.hypot(m.px - old.px, m.py - old.py) < 160);
    if (!survived) gone++;
  }
  return gone;
}

function percentiles(values: readonly number[]): { p50: number; p95: number } {
  if (values.length === 0) return { p50: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { p50: at(0.5), p95: at(0.95) };
}
