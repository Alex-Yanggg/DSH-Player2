# Real-game end-to-end tests

These tests drive the real Stardew Valley game the way a player does, with keyboard, mouse and screen. They judge the result only from what the game, the mod and DSH write themselves: the SMAPI log, the mod's development logs, bridge files, and the latency traces. They use no SMAPI API and no in-process hooks, and the mod is not changed for testing.

They run only on a local Windows machine with a display, the game, and a DSH runtime with a working model key. They are not part of CI.

## What is covered

| Category | Question |
| --- | --- |
| boot | The game starts through SMAPI, the mod loads, the test save loads, and the DSH bundle is ready. |
| consent | The daily proposal appears as native dialogue; decline, same-day F6 retry and agree are all honoured. |
| presence | The chosen companion is in the player's location and carried into each turn. |
| conversation | F2 chat reaches DSH and returns a validated reply; a failure carries a trace id and never shows local text. |
| movement | Explicit commands are issued at Enter (A1), negated phrases never move anyone, follow keeps up, and stay stops. |
| boundaries | Requests beyond the advertised capabilities (chop a tree, trade, water crops) are refused honestly. |
| feel | Enter to publish, DSH round trip, first token, and time to result. |
| w0 | P2-0015: the day's first line, the chat memory envelope, graded readiness, and the joined latency trace. |

The open chat is a game menu, so in single player the world pauses while it is open. This is intended: a movement command is issued at Enter, and the companion walks once the chat closes. The movement tests close the chat after Enter.

## Setup

1. Build and deploy the mod (`stardew-mod/README.md`) and mount the host plugin in the DSH `web` profile.
2. Install Python 3.14 and the test dependencies: `python -m pip install -r e2e/requirements.txt`.
3. Choose a template save: any untouched day-1 save folder under `%APPDATA%\StardewValley\Saves`. The template is only read, never modified.
4. Run the game at a 16:9 resolution. Close it before starting the tests.

## Run

```powershell
$env:E2E_SOURCE_SAVE = "<day-1 save folder name>"
cd e2e
python -m pytest
```

Each run creates a fresh test character: a copy of the template under a new unique id in the `99xxxxxxx` range. The farmer, bridge sessions and durable DSH sessions are therefore all new, and no run inherits an earlier run's conversation or receipts. The previous run's test save and bridge session are removed by their recorded id. Real saves are never touched, and the run aborts if SMAPI loads any save other than this run's.

Results go to `e2e/artifacts/<run>/`: `summary.md` (per-category pass/fail), `results.json` (measurements), the SMAPI console, and screenshots of every failure. For the batch latency baseline, run `node scripts/latency-report.mjs "$env:USERPROFILE\.dsh\player2\bridge" --since <run start>` from the repository root.

## Safety

The tests own the keyboard and mouse while they run.

- `Ctrl+Alt+Q` aborts at once.
- Input is never sent unless the game window is in the foreground.
- A run refuses to start while the game is already running.

## Options

| Variable | Effect |
| --- | --- |
| `E2E_SOURCE_SAVE` | Template save folder name (required). |
| `E2E_ATTACH=1` | Drive an already running game, reusing the last run's test save (faster iteration; no console fixture channel). |
| `E2E_SAVE_ID` | Pin the test save id instead of generating a fresh one. |
| `STARDEW_DIR` | Game directory when it is not the default Steam location. |

`budgets.py` holds the responsiveness budgets. Each value is measured, then rounded up. Raise one only with a recorded reason, because every raise loosens the product's feel.
