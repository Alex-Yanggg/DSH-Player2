# P2-0021 B line: goal-driven companion

The player gives the companion a goal ("给我弄 3 根胡萝卜", "去矿洞带 30 个骨头回来"); the companion plans, plays the game with its own body through generic state and raw input, and reports back. The player's request is the authorization. The persona decides how; nothing in this line constrains its choices beyond an anti-runaway loop budget.

## Layers

```text
Stardew mod (pure adapter)         DSH host plugin                         DSH companion plugin (goal mode)
--------------------------         ---------------                         --------------------------------
BodyStateExporter  -> state.json   social lane reads goal/cheat extras --> world_* tools   (read raw state)
                      world.json   GoalLane: record, budget, dice, stop     body_walk_to    (navigation helper)
BodyAdapter <- input/task-<n>.json   per-goal agent, one turn at a time   body_use/input  (raw buttons)
            -> status/task-<n>.json                                        reflex_melee    (closed-loop script)
            <- speech/say-<n>.json                                          companion_say, goal_note, goal_finish
```

- **The mod has no semantics.** It declares which inputs it accepts (`MoveUp/Right/Down/Left` held; `Face*`, `UseTool`, `Action`, `DropItem`, `Slot1..12` pressed; `NoClip` as a cheat modifier) and exports the world as it is: a walkability grid, objects and terrain features with their raw names and fields, characters, warps, the clock, the body's toolbar. Nothing in [`BodyAdapter`](../stardew-mod/src/BodyAdapter.cs) knows "go to", "chop", or "farm".
- **Navigation and reflexes live in the plugin.** [`navigation.ts`](../packages/dsh-companion-plugin/src/body/navigation.ts) runs A* on the exported grid and turns a path into held-direction steps of exact tick length; [`walk.ts`](../packages/dsh-companion-plugin/src/body/walk.ts) plays one leg, looks again, and re-plans, crossing locations over the exported warp graph. [`reflex.ts`](../packages/dsh-companion-plugin/src/body/reflex.ts) is a melee loop the model parameterises (time, chase range, kill target); it measures its own loop latency.
- **Think and act are separate.** The goal agent spends one model turn per plan step; travel and fights run at game pace in helpers without a model call per tick.

## Body protocol v0.1

All files live under the save's session directory (`<bridge>/projects/<person>/sessions/<save>/body/`). Schemas: [`body.ts`](../packages/contracts/src/body.ts), mirrored in [`BodyBridgeContracts.cs`](../player2-core/BodyBridgeContracts.cs); golden frames in [`stardew-body-frames.json`](../fixtures/body/stardew-body-frames.json).

| File | Writer | Content |
| --- | --- | --- |
| `declaration.json` | mod | inputs it accepts, state fields and grid legend, limits (max steps, max step ms, tick ms, walk speed, tile px), whether the cheat setting is on |
| `state.json` | mod | revision, tick, paused, clock, player, body (tile, pixel, facing, toolbar, stamina, active task), map rows, objects (nearest first, capped), characters, warps; ≤512 KiB; every 30 ticks, every 6 while a task asks for `fastState` |
| `world.json` | mod | every location and its warps (route planning across maps) |
| `input/task-<seq>.json` | plugin | `{taskId, seq, steps:[{hold?, press?, ms}], until?, fastState?}`; written once by hard link; the newest sequence wins and preempts an older running task |
| `input/cancel-<seq>.json` | plugin | cancels that task |
| `status/task-<seq>.json` | mod | `accepted / running / done / interrupted / failed / cancelled`, step, events (warped, used, harvested, planted, picked-up, blocked, ...), reason |
| `../speech/say-<seq>.json` | plugin | one line the companion says in the world; the mod renames it `.shown` |

Durations count unpaused game ticks: the open chat pauses the world in single player, and a task pauses with it. `until` stops a task early on `arrive`, `warped`, `monsterWithin`, or `blockedMs`. Unknown inputs, a cheat input while cheats are off, too many steps or too long a step fail the task with the reason; nothing is silently dropped.

## Goal lane

[`GoalLane`](../packages/dsh-host-plugin/src/goal.ts) owns one goal per save in `<session>/goal/`:

- **Start.** The fast social lane may add `goal: {"op":"set","text":"…"}` to its reply when the player asks for real play, or `{"op":"stop"}`. The host applies it right after the chat reply is written; a new goal replaces the old one. There is no consent dialogue: the request is the authorization.
- **Loop.** Each turn the goal agent gets `GOAL_TURN n`: the goal in the player's words, game day and budget use, its own route notes, its five persona tendencies, and this turn's dice nudges. It observes, acts with the tools, and ends with `goal_finish done|failed` and a summary in its own words, which is said in the game. The loop waits, spending nothing, while the body is absent or the world is paused.
- **Stop.** "stay" typed in chat (the mod's game-local command) writes `goal/interrupt-<ms>.json`; the host stops the goal, cancels the agent's turn in flight and the body's active task. A stop said in chat arrives as `goal: stop`. Either way the goal ends at the next decision point and the record says why.
- **Budget (anti-runaway only).** Defaults: 40 turns, 600 tool calls, 7 game days. When spent, the companion gets one last turn to tell the player honestly where it got to; if it says nothing, the record ends as `budget-exceeded`. No local template text is ever spoken.
- **Status in chat.** While a goal is active or recently ended, every chat turn carries a `GOAL_STATUS` note (goal, status, turns, last notes, summary), so the companion talks about its work from facts.
- **Restart.** An active goal resumes after a DSH restart with its own durable agent session (session id derived from the goal id).

## Persona knobs

Five knobs per companion, each 0–1, configured per persona in the mod (`CompanionChoices[].Knobs`) and carried on every social turn: talkativeness, help-seeking, risk, obedience, skill. [`knobs.ts`](../packages/dsh-companion-plugin/src/body/knobs.ts):

- dice only decide "does this turn consider doing X" (speak up, use own judgment over the exact wording, take the bolder option, ask for help when stuck); what to say and do stays with the model;
- `p = 0.05 + 0.9 × knob`; rolls are `sha256(seed, turn, question)`, the seed is the goal id, and every roll is appended to `goal/dice.jsonl`;
- skill maps to reflex hands: reaction delay 450 → 60 ms and aim error 0.30 → 0.02;
- failure and blockage are always reported; no die is rolled for them.

## Authorization and cheats

- Autonomy now defaults to `full`; `consult` (proposal → consent → execute) stays as an explicit setting.
- Cheat-class inputs are refused unless the mod's **Allow cheat capabilities** setting is on or the player allowed it in chat for this save. The social lane writes `cheat: {"op":"grant"|"revoke","quote":"<the player's words>"}`; the host stores `goal/cheat.json` and traces `DSH_CHEAT_SWITCH` with the quote. This build's only cheat input is the `NoClip` modifier, which exists to prove the switch.

## Network requests (D4, D16)

The goal lane may call the DSH composition's web tools (host config `goalWebTools`, default `web_search`, `web_fetch`) for world knowledge; results are hints to check against the state, never facts. Every call is appended to `development-logs/network-requests.jsonl` (`at`, `lane`, `goalId`, `session`, `tool`, `args`). No other lane gains network access.

## Spikes S9–S12

| Spike | Question | Result |
| --- | --- | --- |
| S9 | Can SMAPI inject keyboard/mouse/gamepad input cleanly? | **No, fallback taken.** SMAPI has no input-injection API, and the companion is an NPC body, not a second local player, so OS-level input would drive the player's farmer. Following the plan's fallback, the input layer is in-game method calls behind a raw-button interface: held directions move the body with the engine's own collision; `UseTool` calls the selected tool's `DoFunction` (weapons `DoDamage`) through a stand-in farmer; `Action` acts on the faced tile (harvest, plant, pick up, door warp). Still no semantics: the model and plugin choose every button. Real-game check pending (see the mod README). |
| S10 | Can DSH register tools at runtime? | **Yes.** [`s10-runtime-tools.mjs`](../scripts/spikes/s10-runtime-tools.mjs): `ctx.tools.register` returns a disposer, the schema list follows adds and removes, and `tools/change` fires. |
| S11 | End-to-end reflex latency on the plugin side | Keyless: input accept p50 ≈ 8 ms / p95 ≈ 14 ms against the simulated adapter at a 40 ms poll. Real game: the adapter polls input every 6 ticks (100 ms) and `fastState` exports every 6 ticks, so the expected loop is ~100–250 ms; to be measured with `reflex_melee` in the mine. |
| S12 | Can state be exported raw and cheaply? | Keyless: yes (grid + capped objects). Real game: the exporter logs its build time and size every 600 builds; the grid is cached for 120 ticks. To be measured on a full farm. |

## Verification

- `npm run accept:0.2.0` = `accept:0.1.4` + `replay:goal` (5 carrot runs from different start tiles, an honest budget failure, knob statistics) + the S10 spike.
- Package tests: [`body.test.ts`](../packages/dsh-companion-plugin/src/body/body.test.ts) (navigation, walking across maps, till/plant/water/harvest, cheat refusal, melee, dice determinism and frequency) and [`goal.test.ts`](../packages/dsh-host-plugin/src/goal.test.ts) (done, stop, budget, replace, cheat grant, resume, pause).
- `dotnet test` covers the C# protocol files and the task runner.
- Real game: the manual steps in [`stardew-mod/README.md`](../stardew-mod/README.md#b-line-goal-driven-companion-p2-0021) and the e2e suite.

## Known gaps

- The body cannot buy from shops (menus are not part of the raw input set); a goal that needs a purchase must find another route or say so.
- Building interiors reached through doors are exported as action warps; doors that need an event or a key are refused by the game and reported.
- Harvest through the stand-in farmer is the least certain path of S9; the status events say where items went.
