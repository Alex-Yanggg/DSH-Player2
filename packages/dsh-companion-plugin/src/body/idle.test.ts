import { describe, expect, it } from "vitest";
import { IdleWatch, IDLE_MINUTES, clockMinutes, idleFact } from "./idle.js";

const at = (timeOfDay: number, day = 1) => ({ day, timeOfDay });
/** Game clock `minutes` after 6:00. */
const after = (minutes: number) => { const m = 360 + minutes; return Math.floor(m / 60) * 100 + (m % 60); };

describe("empty hands", () => {
  it("reads the game clock in minutes", () => {
    expect(clockMinutes(600)).toBe(360);
    expect(clockMinutes(1430)).toBe(870);
    expect(after(90)).toBe(730);
  });

  it("asks once the body stood an hour with nothing to do, then waits longer each time it is not taken up", () => {
    const watch = new IdleWatch();
    expect(watch.observe(at(after(0)), false, null)).toBe(false);
    expect(watch.observe(at(after(IDLE_MINUTES - 10)), false, null)).toBe(false);
    expect(watch.observe(at(after(IDLE_MINUTES)), false, null)).toBe(true);
    // The mind thought about it (a turn) and chose to rest: the next ask waits twice as long.
    expect(watch.observe(at(after(IDLE_MINUTES + 5)), false, "turn")).toBe(false);
    expect(watch.observe(at(after(IDLE_MINUTES + 10)), false, null)).toBe(false);
    expect(watch.observe(at(after(IDLE_MINUTES + 10 + IDLE_MINUTES)), false, null)).toBe(false);
    expect(watch.observe(at(after(IDLE_MINUTES + 10 + 2 * IDLE_MINUTES)), false, null)).toBe(true);
  });

  it("starts over when the body works, on a new day, and never asks while paused or after ten at night", () => {
    const watch = new IdleWatch();
    watch.observe(at(after(0)), false, null);
    expect(watch.observe(at(after(30)), false, "work")).toBe(false);
    expect(watch.observe(at(after(40)), false, null)).toBe(false);
    expect(watch.observe(at(after(40 + IDLE_MINUTES - 1)), false, null)).toBe(false);
    expect(watch.observe(at(after(40 + IDLE_MINUTES)), true, null)).toBe(false);
    expect(watch.observe(at(after(40 + IDLE_MINUTES)), false, null)).toBe(true);

    const late = new IdleWatch();
    late.observe(at(2100), false, null);
    expect(late.observe(at(2230), false, null)).toBe(false);
    expect(late.observe(at(after(0), 2), false, null)).toBe(false);
    expect(late.observe(at(after(IDLE_MINUTES), 2), false, null)).toBe(true);
  });

  it("tells the mind the time and the goal it set aside", () => {
    const fact = idleFact({ timeOfDay: 905 }, "差 300 金");
    expect(fact).toContain("9:05");
    expect(fact).toContain("差 300 金");
    expect(fact).toContain("one long plan");
    expect(idleFact({ timeOfDay: 1300 }, null)).not.toContain("set aside");
  });
});
