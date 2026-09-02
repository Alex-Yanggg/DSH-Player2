import { describe, expect, it } from "vitest";
import {
  COMPANION_PACKAGE_NAME,
  createCompanionInvariantInstaller,
  validateReflectArguments,
  validateRequestActionArguments,
} from "./invariants.js";

function failing(): never {
  throw new Error("invariant violated");
}

function expectViolation(run: (fail: (message: string) => never) => void): string {
  let message: string | undefined;
  try {
    run((violation) => {
      message = violation;
      throw new Error(violation);
    });
  } catch {
    // The package-attributed failure throws; the message below is the evidence.
  }
  expect(message, "expected an invariant violation").toBeDefined();
  return message!;
}

describe("companion composition invariants", () => {
  it("accepts well-formed reflect and action-order calls", () => {
    expect(() => validateReflectArguments({
      sequence: 7,
      insights: [{ text: "Granted markers were near the crops.", basedOnReceiptSequences: [6, 5] }],
      focus: "Learn which plans the player grants.",
    }, failing)).not.toThrow();
    expect(() => validateReflectArguments({
      sequence: 7,
      insights: [{ text: "A grounded insight.", basedOnReceiptSequences: [4] }],
      focus: null,
    }, failing)).not.toThrow();
    expect(() => validateRequestActionArguments({
      sequence: 7,
      proposalId: "turn-7:proposal",
    }, failing)).not.toThrow();
  });

  it("fails malformed reflect calls", () => {
    expect(() => validateReflectArguments(null, failing)).toThrow();
    expect(() => validateReflectArguments({ insights: [] }, failing)).toThrow();
    expect(() => validateReflectArguments({
      insights: [{ text: "x".repeat(241), basedOnReceiptSequences: [4] }],
    }, failing)).toThrow();
    expect(() => validateReflectArguments({
      insights: [{ text: "Grounded.", basedOnReceiptSequences: [1, 1] }],
    }, failing)).toThrow();
    expect(() => validateReflectArguments({
      insights: [{ text: "Grounded.", basedOnReceiptSequences: [0] }],
    }, failing)).toThrow();
    expect(() => validateReflectArguments({
      insights: [{ text: "Grounded.", basedOnReceiptSequences: [4] }],
      focus: "f".repeat(161),
    }, failing)).toThrow();

    const message = expectViolation((fail) => validateReflectArguments({
      insights: [{ text: "Invented.", basedOnReceiptSequences: [4.5] }],
    }, fail));
    expect(message).toContain("distinct positive receipt sequences");
  });

  it("fails malformed action orders", () => {
    expect(() => validateRequestActionArguments({ sequence: 7, proposalId: "invented" }, failing)).toThrow();
    expect(() => validateRequestActionArguments({ sequence: -1, proposalId: "turn--1:proposal" }, failing)).toThrow();

    const message = expectViolation((fail) => validateRequestActionArguments({
      sequence: 7,
      proposalId: "turn-8:proposal",
    }, fail));
    expect(message).toContain("turn-7:proposal");
  });

  it("builds an installer that validates the session event stream", () => {
    const installer = createCompanionInvariantInstaller();
    expect(typeof installer).toBe("function");
    expect(COMPANION_PACKAGE_NAME).toBe("@dsh-player2/dsh-companion-plugin");
  });
});
