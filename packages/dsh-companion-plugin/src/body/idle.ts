/**
 * Empty hands: when nothing works the body — no plan, no goal round, no
 * turn — the mind is never woken, and the companion stands where it is until
 * the player speaks or the night comes. This watch counts unpaused game
 * minutes of that and says when to ask the mind what it wants to do with its
 * day. Each ask that the mind answers without a plan doubles the next wait,
 * so a companion that chose to rest is not nagged.
 */

/** Game minutes of empty hands before the first ask. */
export const IDLE_MINUTES = 60;
/** The longest wait between asks. */
const MAX_IDLE_MINUTES = 240;
/** No asks from this hour on: bedtime is the world's own wake. */
const LAST_ASK = 2200;

/** Game clock `1430` → minutes since midnight. */
export function clockMinutes(timeOfDay: number): number {
  return Math.floor(timeOfDay / 100) * 60 + (timeOfDay % 100);
}

export class IdleWatch {
  private day: number | null = null;
  private since: number | null = null;
  private wait = IDLE_MINUTES;

  /**
   * One look at the world. `busy` says what works the body: a plan or an
   * armed goal (`work`), a turn of the mind (`turn`), or nothing (null).
   * Returns true when the mind should be asked now.
   */
  public observe(time: { day: number; timeOfDay: number }, paused: boolean, busy: "work" | "turn" | null): boolean {
    const now = clockMinutes(time.timeOfDay);
    if (this.day !== time.day) {
      this.day = time.day;
      this.wait = IDLE_MINUTES;
      this.since = null;
    }
    // Work the mind chose resets the backoff; a turn only holds the count.
    if (busy === "work") this.wait = IDLE_MINUTES;
    if (busy !== null) { this.since = null; return false; }
    if (paused) return false;
    if (this.since === null) { this.since = now; return false; }
    if (time.timeOfDay >= LAST_ASK || now - this.since < this.wait) return false;
    this.wait = Math.min(MAX_IDLE_MINUTES, this.wait * 2);
    this.since = now;
    return true;
  }
}

/** What the mind is told when its hands have been empty a while. */
export function idleFact(time: { timeOfDay: number }, blocked: string | null): string {
  const hhmm = `${Math.floor(time.timeOfDay / 100)}:${String(time.timeOfDay % 100).padStart(2, "0")}`;
  return [
    `Your hands are empty: it is ${hhmm}, nothing is working your body, and the player has not asked you for anything new.`,
    ...(blocked === null ? [] : [`The goal you set aside waits for the player or a new day (${blocked}); that is not a reason to stand still.`]),
    "Spend the time as yourself, the way a co-op friend would on a free stretch of the day: something useful nearby or something you enjoy. Hand it to your body as one long plan. If resting is really what you want, say so in one short line.",
  ].join(" ");
}
