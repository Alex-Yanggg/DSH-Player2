# P2-0021 B line: goal-driven companion

The player gives the companion a goal ("给我弄 3 根胡萝卜", "去矿洞带 30 个骨头回来"); the companion plans, plays the game with its own body through generic state and raw input, and reports back. The player's request is the authorization. The persona decides how; nothing in this line constrains its choices beyond an anti-runaway loop budget.

## Layers

```text
Stardew mod (pure adapter)               Player2 plugin in dsh --profile acp
--------------------------               -----------------------------------
GameMcpServer (localhost, bearer token)  world_observe / world_find / world_map / world_locations
  body_declaration, world_state,   <---  body_walk_to (navigation helper), body_use / body_input (raw buttons)
  world_map, body_run, body_cancel,      reflex_melee (closed-loop script)
  cheat_grant                            DSH goals: create_goal / update_goal / get_goal
BodyAdapter + BodyTaskRunner             speech = the agent's own messages, shown by the mod
```

- **The mod has no semantics.** It declares which inputs it accepts (`MoveUp/Right/Down/Left` held; `Face*`, `UseTool`, `Action`, `DropItem`, `Slot1..12` pressed; `NoClip` as a cheat modifier) and exports the world as it is: a walkability grid, objects and terrain features with their raw names and fields, characters, warps, the clock, the body's toolbar. Nothing in [`BodyAdapter`](../stardew-mod/src/BodyAdapter.cs) knows "go to", "chop", or "farm".
- **Navigation and reflexes live in the plugin.** [`navigation.ts`](../packages/dsh-companion-plugin/src/body/navigation.ts) runs A* on the exported grid and turns a path into held-direction steps of exact tick length; [`walk.ts`](../packages/dsh-companion-plugin/src/body/walk.ts) plays one leg, looks again, and re-plans, crossing locations over the exported warp graph. [`reflex.ts`](../packages/dsh-companion-plugin/src/body/reflex.ts) is a melee loop the model parameterises (time, chase range, kill target); it measures its own loop latency.
- **Think and act are separate.** One model step per plan step; travel and fights run at game pace in helpers without a model call per tick.

## Body protocol v0.1

The mod serves the body as MCP `tools/call` over HTTP on localhost ([`GameMcpServer`](../player2-core/GameMcpServer.cs), [`BodyChannel`](../player2-core/BodyChannel.cs)); the plugin reaches it through [`port.ts`](../packages/dsh-companion-plugin/src/body/port.ts). Schemas: [`body.ts`](../packages/contracts/src/body.ts), mirrored in [`BodyBridgeContracts.cs`](../player2-core/BodyBridgeContracts.cs); golden frames in [`stardew-body-frames.json`](../fixtures/body/stardew-body-frames.json).

| Tool | Content |
| --- | --- |
| `body_declaration` | inputs the body accepts, state fields and grid legend, limits (max steps, max step ms, tick ms, walk speed, tile px), whether the cheat setting is on |
| `world_state` | revision, tick, paused, clock, player, body (tile, pixel, facing, toolbar, stamina, active task), map rows, objects (nearest first, capped), characters, warps; ≤512 KiB |
| `world_map` | every location and its warps (route planning across maps) |
| `body_run` | `{taskId, steps:[{hold?, press?, ms}], until?, fastState?}`; a new task preempts a running one; returns the final status: `done / interrupted / failed / cancelled`, step, events (warped, used, harvested, planted, picked-up, blocked, ...), reason |
| `body_cancel` | stops the running task |
| `cheat_grant` | records the player's words allowing or revoking cheat inputs for this save |

**Shop counters.** `Action` at a tile whose game action opens a shop opens that shop's stock for the body instead of a menu on the player's screen, if the shop's owner is at the counter. The stock appears raw in `state.body.menu` (shop id, cursor, wallet, items with index, name, category, price, stock left, trade item). `MenuUp` / `MenuDown` move the cursor, `MenuConfirm` buys one unit into the body's toolbar, paid from the player's wallet, and `MenuClose` (or walking away) closes it. Every outcome is a status event: `menu-opened`, `shop-refused`, `bought`, `cant-afford`, `sold-out`, `needs-trade`, `inventory-full`. What to buy and how much to spend is the companion's choice.

Durations count unpaused game ticks: the open chat pauses the world in single player, and a task pauses with it. `until` stops a task early on `arrive`, `warped`, `monsterWithin`, or `blockedMs`. Unknown inputs, a cheat input while cheats are off, too many steps or too long a step fail the task with the reason; nothing is silently dropped.

## Goals

Goals are DSH's own goal feature; Player2 keeps no goal lane.

- **Start.** The companion policy tells the model to create a goal right away when the player asks for real play. There is no consent dialogue: the request is the authorization. A new goal replaces the old one.
- **Loop.** DSH's goal driver runs rounds until the companion marks the goal done or failed; each round gets this turn's knob dice nudges from the plugin. What the companion says along the way is shown in the game.
- **Stop.** "stay" typed in chat takes the body back at once (the mod cancels the running task); a stop said in chat lets the companion end the goal itself.
- **Pause holds the goal.** A frozen world sends `session/cancel`, which pauses the DSH goal; `[resume]` resumes it through the host goal service without a model call.
- **Restart.** The save's DSH session is resumed by id after a restart, with its goal.

## Persona knobs

Five knobs per companion, each 0–1, configured per persona in the mod (`CompanionChoices[].Knobs`) and passed to the plugin: talkativeness, help-seeking, risk, obedience, skill. [`knobs.ts`](../packages/dsh-companion-plugin/src/body/knobs.ts):

- dice only decide "does this turn consider doing X" (speak up, use own judgment over the exact wording, take the bolder option, ask for help when stuck); what to say and do stays with the model;
- `p = 0.05 + 0.9 × knob`; rolls are `sha256(seed, turn, question)` with the session id as seed, so a run can be replayed;
- skill maps to reflex hands: reaction delay 450 → 60 ms and aim error 0.30 → 0.02;
- failure and blockage are always reported; no die is rolled for them.

## Authorization and cheats

Cheat-class inputs are refused unless the mod's **Allow cheat capabilities** setting is on or the player allowed it in chat for this save (`cheat_grant` with the player's words). This build's only cheat input is the `NoClip` modifier, which exists to prove the switch.

## Network requests (D4, D16)

Web search and fetch are DSH's own tools; every call is in the DSH session log, so Player2 keeps no separate request ledger (owner ruling, 2026-10-14). Results are hints to check against the state, never facts.

## Spikes S9–S12

| Spike | Question | Result |
| --- | --- | --- |
| S9 | Can SMAPI inject keyboard/mouse/gamepad input cleanly? | **No, fallback taken.** SMAPI has no input-injection API, and the companion is an NPC body, not a second local player, so OS-level input would drive the player's farmer. Following the plan's fallback, the input layer is in-game method calls behind a raw-button interface: held directions move the body with the engine's own collision; `UseTool` calls the selected tool's `DoFunction` (weapons `DoDamage`) through a stand-in farmer; `Action` acts on the faced tile (harvest, plant, pick up, door warp). Still no semantics: the model and plugin choose every button. Real-game check pending (see the mod README). |
| S10 | Can DSH register tools at runtime? | **Yes.** The spike (since removed) showed `ctx.tools.register` returns a disposer, the schema list follows adds and removes, and `tools/change` fires. |
| S11 | End-to-end reflex latency on the plugin side | Real game, 40 swings on the farm: state age at decision p50 73–90 ms / p95 144–156 ms (was 359/406 ms before the fast cadence was kept for 2 s between tasks), input accept p50 60 ms, one swing round trip ≈ 336 ms of which 250 ms is the swing itself. Not yet measured on real monsters (the mines open on day 5). |
| S12 | Can state be exported raw and cheaply? | Real game: export average 5.85 ms (was 32–40 ms); the full grid is built once per location change (≈104 ms) and one row is refreshed per tick (≈1.3 ms); the farm state is ≈167 KB. Still on the game's main thread, a suspect for animation stutter (owner bug list OB-2). |

## Verification

- Package tests: [`body.test.ts`](../packages/dsh-companion-plugin/src/body/body.test.ts) (navigation, walking across maps, till/plant/water/harvest, cheat refusal, melee, dice determinism and frequency) and [`index.test.ts`](../packages/dsh-companion-plugin/src/index.test.ts) (persona prompt, hands mounted only with a body, markers).
- `dotnet test` covers the ACP client, the MCP endpoint, the body channel and the task runner.
- Real game: the manual check in [`stardew-mod/README.md`](../stardew-mod/README.md#manual-check) and the e2e suite.

## Known gaps

- Shops: the body can buy but not sell; trade-item prices are refused and reported.
- Building interiors reached through doors are exported as action warps; doors that need an event or a key are refused by the game and reported.
- Harvest through the stand-in farmer is the least certain path of S9; the status events say where items went.

## Phase result (2026-10-14) and what comes next

Development on this line stops here; the slice is merged as it stands.

- **Verified in the real game (screenshots):**
  - The body walks out of the farm through doors and map edges.
  - It tills and waters, and buys at Pierre's counter.
  - It acts in other locations while the player is elsewhere.
  - Its toolbar survives a reload.
- **Fixed on the way:** NPC barrier, sprite offset, NPC-only warps, the farmhouse door, harvest spilling into the player's location, focus-loss freeze, a paused game ending a goal, and player-facing words.
- **Carrot acceptance:** "get N carrots" did not reach 4 of 5. Run 4 took the right route (seed spots, plant, water, harvest on day 4), but a since-fixed bug lost its harvest; the other runs varied in strategy or stopped on a pause.
- **Lesson:** most defects came from the S9 fallback, an NPC posing as a farmer. Game code assumes the local player, so every interaction needed hand wiring.

**Next, in order:**

1. **B-line close-out (small):** one clean carrot run on the current body, and the owner bug list items OB-1 (cursor flicker) and OB-2 (animation stutter: move state export and its disk write off the game's main thread).
2. **W2, P2-0022 independent body (pseudo co-op):** spike S13 compares a headless protocol client, a non-rendered second local player inside the same game process (Stardew's split-screen machinery), and a second instance. If one passes, the companion becomes a real farmhand with native input first and keyboard and mouse as the fallback; the NPC-disguise layer (`BodyAdapter` per-action code, `BodyShop`, the stand-in farmer, `CompanionInventoryStore`) is then deleted.
3. **Later:** harness-side memory across sessions and saves, once single-chat play is solid.
