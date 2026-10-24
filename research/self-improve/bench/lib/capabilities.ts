import type { BodyInputStep } from "@dsh-player2/contracts";
import type { BodyPort } from "../../../../packages/dsh-companion-plugin/src/body/port.ts";
import { controlsOf, directionTo, faceStep, type Controls, type Direction, type Tile } from "../../../../packages/dsh-companion-plugin/src/body/navigation.ts";
import { walkTo } from "../../../../packages/dsh-companion-plugin/src/body/walk.ts";

/**
 * Game-agnostic body mechanics every executor-style approach builds on:
 * go to a tile (the product's walkTo helper, reused verbatim), select a
 * toolbar slot, face a tile, press a button, walk with a monster interrupt.
 * These helpers know nothing about parsnips or ladders — that knowledge is
 * each approach's per-game layer and is what the toy2 port counts.
 */

export type { Controls, Direction, Tile };

export async function controls(port: BodyPort): Promise<Controls> {
  return controlsOf(await port.declaration());
}

export interface GotoOptions {
  mode?: "stand" | "adjacent";
  /** Stop the walk early if a monster comes within this many tiles. */
  monsterWithin?: number;
  signal?: AbortSignal;
}

/** Walk via the product helper. Returns ok and the reason. */
export async function goto(port: BodyPort, controlsRef: Controls, target: Tile, options: GotoOptions = {}): Promise<{ ok: boolean; reason: string; legs: number }> {
  const result = await walkTo(
    port,
    controlsRef,
    () => port.world(),
    { x: target.x, y: target.y, mode: options.mode ?? "stand" },
    options.signal,
  );
  return { ok: result.ok, reason: result.reason, legs: result.legs };
}

/** Play raw steps: slot selects and button presses. */
export async function pressSteps(port: BodyPort, steps: BodyInputStep[], signal?: AbortSignal): Promise<{ status: string; reason: string | null; events: { kind: string; detail: string }[] }> {
  const run = await port.run(steps, signal === undefined ? {} : { signal });
  return { status: run.status, reason: run.reason, events: run.events.filter((event) => !["done", "running"].includes(event.kind)) };
}

/** Select a toolbar slot (0-based) and press a button. */
export async function useTool(port: BodyPort, slot: number, button: string, signal?: AbortSignal) {
  return pressSteps(port, [{ press: [`Slot${slot + 1}`], ms: 0 }, { press: [button], ms: 0 }], signal);
}

/** Stand next to a tile (the walk helper ends facing it) and use a tool on it. */
export async function workTile(port: BodyPort, controlsRef: Controls, tile: Tile, slot: number, button: string, signal?: AbortSignal): Promise<{ ok: boolean; detail: string }> {
  const walk = await goto(port, controlsRef, tile, { mode: "adjacent", signal });
  if (!walk.ok) return { ok: false, detail: `walk failed: ${walk.reason}` };
  const result = await useTool(port, slot, button, signal);
  const events = result.events.map((event) => `${event.kind}: ${event.detail}`).join("; ");
  return { ok: result.status === "done", detail: events || result.reason || "no event" };
}

/** Face a tile (must be orthogonal-adjacent) and press a button at it. */
export async function faceAndPress(port: BodyPort, controlsRef: Controls, tile: Tile, button: string, slot: number | undefined, signal?: AbortSignal) {
  const state = await port.state();
  const body = state.body;
  if (body === null) return { ok: false, detail: "no body" };
  const direction = directionTo({ x: body.x, y: body.y }, tile);
  if (Math.abs(body.x - tile.x) + Math.abs(body.y - tile.y) !== 1) return { ok: false, detail: "tile not adjacent" };
  const steps: BodyInputStep[] = [];
  if (body.facing !== direction) steps.push(faceStep(controlsRef, direction));
  if (slot !== undefined) steps.push({ press: [`Slot${slot + 1}`], ms: 0 });
  steps.push({ press: [button], ms: 0 });
  const result = await pressSteps(port, steps, signal);
  return { ok: result.status === "done", detail: result.events.map((event) => `${event.kind}: ${event.detail}`).join("; ") || "quiet" };
}

/** Walk toward a tile but bail out the moment a monster comes near. */
export async function guardedWalk(port: BodyPort, controlsRef: Controls, target: Tile, monsterWithin: number, signal?: AbortSignal): Promise<{ status: "arrived" | "monster" | "failed"; reason: string }> {
  const state = await port.state();
  const body = state.body;
  if (body === null) return { status: "failed", reason: "no body" };
  if (body.x === target.x && body.y === target.y) return { status: "arrived", reason: "already there" };
  // A single planned leg with the interrupt condition; the caller re-plans on "monster".
  const leg = await planLegFrom(port, controlsRef, target);
  if (leg === undefined) return { status: "failed", reason: "no path" };
  const run = await port.run(leg, { until: { blockedMs: 600, monsterWithin }, ...(signal === undefined ? {} : { signal }) });
  if (run.status === "interrupted" && run.reason === "monster") return { status: "monster", reason: "monster near" };
  if (run.status === "interrupted" && run.reason === "blocked") return { status: "failed", reason: "blocked" };
  const after = run.state?.body;
  if (after != null && after.x === target.x && after.y === target.y) return { status: "arrived", reason: "done" };
  return { status: "failed", reason: `walk ended ${run.status} (${run.reason ?? "?"})` };
}

import { planLeg } from "../../../../packages/dsh-companion-plugin/src/body/navigation.ts";

async function planLegFrom(port: BodyPort, controlsRef: Controls, target: Tile): Promise<BodyInputStep[] | undefined> {
  const state = await port.state();
  const body = state.body;
  if (body === null) return undefined;
  const leg = planLeg(state, controlsRef, { tile: target, mode: "stand" });
  return leg?.steps.slice(0, 64);
}
