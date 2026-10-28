import type { BodyState } from "@dsh-player2/contracts";

/**
 * The stuck detector (P2-0019b T2): a generic wall counter over body actions.
 * The same action signature (tool plus target) repeated with no change in the
 * observed state counts as one wall; on the third hit the body stops — the
 * plan executor holds — and the mind gets a stuck fact with the recent
 * attempts. The observed state is the world around the body, deliberately not
 * its vitals or the clock: a losing fight or a passing minute is not the
 * world answering differently.
 */

/** Consecutive same-signature, no-change hits that make a wall. */
export const STUCK_HITS = 3;

/** The one attempt record a stuck fact quotes. */
export interface StuckAttempt {
  readonly tool: string;
  readonly target: string;
  readonly outcome: string;
}

/** A cheap canonical digest of the world around the body: location, tile, toolbar, player, menu, objects, characters. */
export function stateDigest(state: BodyState): string {
  const body = state.body;
  const items = (list: readonly { name: string; stack: number }[]) => list.map((i) => `${i.name}x${i.stack}`).sort().join(",");
  const objects = state.objects.map((o) => `${o.name}@${o.x},${o.y}:${o.extra?.ready === true ? "r" : ""}${o.extra?.passable === false ? "b" : ""}`).sort().join(",");
  const characters = state.characters.map((c) => `${c.name}@${c.x},${c.y}`).sort().join(",");
  const menu = body?.menu === null || body?.menu === undefined ? "" : `${body.menu.kind}:${body.menu.focus ?? ""}`;
  return [
    body === null ? "nobody" : `${body.location}:${body.x},${body.y}:${body.facing}:${body.selectedSlot}:${items(body.items)}`,
    `player:${state.player.location}:${state.player.x},${state.player.y}:${state.player.money}:${items(state.player.items)}`,
    menu,
    objects,
    characters,
  ].join("|");
}

/** Guidance for the mind, not rules: look again, search, write it down, act differently. */
export function stuckFact(signature: string, attempts: readonly StuckAttempt[]): string {
  const recent = attempts.slice(-STUCK_HITS).map((a) => `${a.tool} ${a.target} -> ${a.outcome}`).join("; ");
  return [
    `STUCK: ${signature} has now been tried ${STUCK_HITS} times and the world around you did not change (recent: ${recent}).`,
    "Do not submit that same action again. Step back: look again at the wider map and your surroundings, read anything readable nearby, and search the web when the world does not explain itself.",
    "Once you know why, write it down with lesson_learn, then act differently — another route, another tool, another place — or wait if the world says the blocker clears on its own.",
  ].join(" ");
}

/**
 * The counter itself. Body actions report here; the plan executor (P2-0019b
 * T3) consults `holding` before each step, and the pre-step hook drains
 * `take()` so the mind sees the fact on its next turn.
 */
export class StuckWatch {
  private signature: string | null = null;
  private digest: string | null = null;
  private hits = 0;
  private attempts: StuckAttempt[] = [];
  private fact: string | null = null;
  private holding = false;

  /** One body action's outcome. `after` missing means the world could not be read. */
  public record(tool: string, target: string, outcome: string, before: BodyState, after: BodyState | undefined): void {
    const signature = `${tool} ${target}`;
    const answered = after !== undefined && stateDigest(after) !== stateDigest(before);
    if (answered && outcome === "ok") {
      // The world answered: no wall here, and a hold ends.
      this.reset();
      this.holding = false;
      return;
    }
    // A wall hit: this action changed nothing, the signature repeats, and the
    // world where it was tried is the one the earlier attempts met.
    if (!answered && signature === this.signature && this.digest !== null && stateDigest(before) === this.digest) {
      this.hits += 1;
    } else {
      this.signature = signature;
      this.digest = stateDigest(before);
      this.hits = 1;
    }
    this.attempts.push({ tool, target, outcome });
    if (this.attempts.length > 6) this.attempts.shift();
    if (this.hits >= STUCK_HITS) {
      this.fact = stuckFact(signature, this.attempts);
      this.holding = true;
      this.hits = 0;
    }
  }

  /** The queued stuck fact, once. */
  public take(): string | null {
    const fact = this.fact;
    this.fact = null;
    return fact;
  }

  /** True while an undelivered stuck fact waits. */
  public hasFact(): boolean {
    return this.fact !== null;
  }

  /** True while the wall stands: the plan executor holds its steps. */
  public isHolding(): boolean {
    return this.holding;
  }

  /** The mind acted and the world answered; the body may work the plan again. */
  public release(): void {
    this.reset();
    this.holding = false;
  }

  private reset(): void {
    this.signature = null;
    this.digest = null;
    this.hits = 0;
    this.attempts = [];
  }
}
