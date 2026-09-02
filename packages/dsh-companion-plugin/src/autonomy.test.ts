import { describe, expect, it } from "vitest";
import { resolveAutonomy } from "./autonomy.js";

describe("resolveAutonomy", () => {
  it("defaults to consult when no scope carries a value", () => {
    expect(resolveAutonomy({})).toBe("consult");
    expect(resolveAutonomy({ agent: "", preset: "", global: "" })).toBe("consult");
  });

  it("shadows nearest: agent over preset over global", () => {
    expect(resolveAutonomy({ agent: "consult", preset: "full" })).toBe("consult");
    expect(resolveAutonomy({ agent: "full", preset: "consult", global: "consult" })).toBe("full");
    expect(resolveAutonomy({ preset: "full" })).toBe("full");
    expect(resolveAutonomy({ preset: "consult", global: "full" })).toBe("consult");
    expect(resolveAutonomy({ global: "full" })).toBe("full");
  });

  it("normalizes casing and surrounding whitespace", () => {
    expect(resolveAutonomy({ agent: " Full " })).toBe("full");
    expect(resolveAutonomy({ preset: "CONSULT" })).toBe("consult");
  });

  it("fails loudly on an invalid value in any scope instead of degrading", () => {
    expect(() => resolveAutonomy({ agent: "auto" })).toThrow(
      'companion.autonomy at the agent scope must be "consult" or "full"; got "auto"',
    );
    expect(() => resolveAutonomy({ preset: "unbounded" })).toThrow(
      'companion.autonomy at the preset scope must be "consult" or "full"; got "unbounded"',
    );
    expect(() => resolveAutonomy({ global: "cheat" })).toThrow(
      'companion.autonomy at the global scope must be "consult" or "full"; got "cheat"',
    );
    // An invalid lower scope must not be silently rescued by a valid higher one.
    expect(() => resolveAutonomy({ agent: "consult", preset: "sometimes" })).toThrow("preset scope");
  });
});
