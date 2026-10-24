import { buildLocked } from "./lib/locked.ts";
import { buildWall } from "./lib/wall.ts";
import { buildToy2Locked, buildToy2Wall } from "./toy2/variants.ts";
import { goto, faceAndPress, controls, type Controls } from "./lib/capabilities.ts";
import type { BodyPort } from "../../../packages/dsh-companion-plugin/src/body/port.ts";

/** Scenario mechanics validation (not a recorded run). npx tsx check-scenarios.ts */

const fail = (message: string): never => { console.error(`FAIL: ${message}`); process.exit(1); };

type Tile = { x: number; y: number };
const NEIGHBORS: Tile[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

/** Stand on any tile adjacent to `tile`, then face it and press. */
async function approachAndPress(port: BodyPort, ctrl: Controls, tile: Tile, button: string, slot?: number): Promise<{ ok: boolean; detail: string }> {
  const body = (await port.state()).body;
  if (body === null) return { ok: false, detail: "no body" };
  if (Math.abs(body.x - tile.x) + Math.abs(body.y - tile.y) === 1) return faceAndPress(port, ctrl, tile, button, slot);
  for (const delta of NEIGHBORS) {
    const spot = { x: tile.x + delta.x, y: tile.y + delta.y };
    const walk = await goto(port, ctrl, spot, { mode: "stand" });
    if (walk.ok) return faceAndPress(port, ctrl, tile, button, slot);
  }
  return { ok: false, detail: `no adjacent spot reachable for ${tile.x},${tile.y}` };
}

// --- locked: blocked before day 5, the notice reads, the pass opens on day 5.
{
  const world = buildLocked(1);
  await world.adapter.start(1);
  world.engine.start();
  const ctrl = await controls(world.adapter);
  const before = await goto(world.adapter, ctrl, { x: 11, y: 2 }, { mode: "stand" });
  if (before.ok) fail(`locked: walked to the north corridor before day 5 (${before.reason})`);
  console.log(`locked: blocked before day 5 as expected (${before.reason}, legs ${before.legs})`);
  const read = await approachAndPress(world.adapter, ctrl, { x: 3, y: 7 }, "ControllerA");
  if (!read.detail.includes("repair crew clears it on the morning of day 5")) fail(`locked: notice not readable (${read.detail})`);
  console.log("locked: notice reads OK");
  for (let i = 0; i < 700 && world.adapter.day < 5; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  if (world.adapter.day < 5) fail(`locked: day never reached 5 (day ${world.adapter.day})`);
  const after = await goto(world.adapter, ctrl, { x: 11, y: 1 }, { mode: "stand" });
  if (!after.ok) fail(`locked: could not reach the shrine after day 5 (${after.reason})`);
  console.log(`locked: pass open on day 5, shrine reached (${after.reason})`);
  await world.engine.stop();
  await world.adapter.stop();
}

// --- wall: golem blocks the bridge, weapon does nothing, lever opens the gate.
{
  const world = buildWall(1);
  await world.adapter.start(1);
  world.engine.start();
  const ctrl = await controls(world.adapter);
  const bridge = await goto(world.adapter, ctrl, { x: 7, y: 4 }, { mode: "stand" });
  if (bridge.ok) fail("wall: walked across the guarded bridge");
  console.log(`wall: bridge blocked by the golem as expected (${bridge.reason})`);
  const swing = await approachAndPress(world.adapter, ctrl, { x: 5, y: 4 }, "ControllerX", 0);
  if (!swing.detail.includes("shrugs it off")) fail(`wall: golem not immune (${swing.detail})`);
  if (world.engine.health >= 100) fail("wall: counterattack did not cost health");
  console.log(`wall: golem immune, counterattack costs health (health ${world.engine.health})`);
  const lever = await approachAndPress(world.adapter, ctrl, { x: 1, y: 1 }, "ControllerA");
  if (!lever.detail.includes("grinds open")) fail(`wall: lever did not work (${lever.detail})`);
  const gate = await goto(world.adapter, ctrl, { x: 11, y: 1 }, { mode: "stand" });
  if (!gate.ok) fail(`wall: could not reach the bell after the lever (${gate.reason})`);
  console.log(`wall: lever opens the gate, bell reached (${gate.reason})`);
  await world.engine.stop();
  await world.adapter.stop();
}

// --- toy2-locked: gold door locked before day 3, notice readable, key spawns, crown craftable.
{
  const world = buildToy2Locked(1);
  await world.adapter.start(1);
  const ctrl = await controls(world.adapter);
  const read = await approachAndPress(world.adapter, ctrl, { x: 2, y: 7 }, "KeyE");
  if (!read.detail.includes("day 3")) fail(`toy2-locked: notice not readable (${read.detail})`);
  const door = await approachAndPress(world.adapter, ctrl, { x: 7, y: 6 }, "KeyE");
  if (!door.detail.includes("gold key")) fail(`toy2-locked: door not locked (${door.detail})`);
  console.log("toy2-locked: notice readable, gold door locked before day 3");
  for (let i = 0; i < 700 && world.adapter.day < 3; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  if (world.adapter.day < 3) fail(`toy2-locked: day never reached 3 (day ${world.adapter.day})`);
  if (!world.adapter.objects.some((o) => o.name === "Gold Key")) fail("toy2-locked: gold key never spawned");
  const key = await approachAndPress(world.adapter, ctrl, { x: 5, y: 1 }, "KeyE");
  if (!key.detail.includes("picked-up")) fail(`toy2-locked: key not pickable (${key.detail})`);
  const open = await approachAndPress(world.adapter, ctrl, { x: 7, y: 6 }, "KeyE");
  if (!open.detail.includes("opened")) fail(`toy2-locked: door did not open with the key (${open.detail})`);
  for (const tile of [{ x: 9, y: 1 }, { x: 10, y: 1 }, { x: 9, y: 8 }, { x: 2, y: 2 }, { x: 4, y: 6 }] as const) {
    const pick = await approachAndPress(world.adapter, ctrl, tile, "KeyE");
    if (!pick.detail.includes("picked-up")) fail(`toy2-locked: material at ${tile.x},${tile.y} not pickable (${pick.detail})`);
  }
  const craft = await approachAndPress(world.adapter, ctrl, { x: 10, y: 5 }, "KeyC");
  if (!craft.detail.includes("Crown")) fail(`toy2-locked: craft failed (${craft.detail})`);
  console.log("toy2-locked: key spawned on day 3, door opened, Crown crafted");
  await world.adapter.stop();
}

// --- toy2-wall: silver door never opens; the panel does.
{
  const world = buildToy2Wall(1);
  await world.adapter.start(1);
  const ctrl = await controls(world.adapter);
  for (let i = 0; i < 3; i++) {
    const door = await approachAndPress(world.adapter, ctrl, { x: 7, y: 6 }, "KeyE");
    if (door.detail.includes("opened")) fail("toy2-wall: fused door opened");
  }
  const panel = await approachAndPress(world.adapter, ctrl, { x: 7, y: 3 }, "KeyE");
  if (!panel.detail.includes("panel swings aside")) fail(`toy2-wall: panel did not open (${panel.detail})`);
  for (const tile of [{ x: 9, y: 1 }, { x: 10, y: 3 }, { x: 9, y: 8 }, { x: 10, y: 1 }, { x: 11, y: 8 }] as const) {
    const pick = await approachAndPress(world.adapter, ctrl, tile, "KeyE");
    if (!pick.detail.includes("picked-up")) fail(`toy2-wall: material at ${tile.x},${tile.y} not pickable (${pick.detail})`);
  }
  const craft = await approachAndPress(world.adapter, ctrl, { x: 10, y: 5 }, "KeyC");
  if (!craft.detail.includes("Crown")) fail(`toy2-wall: craft failed (${craft.detail})`);
  console.log("toy2-wall: fused door stays shut, panel opens, Crown crafted");
  await world.adapter.stop();
}

console.log("ALL SCENARIO CHECKS PASS");
