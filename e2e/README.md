# Real-game end-to-end tests

These tests drive the real Stardew Valley game the way a player does, with keyboard, mouse and screen. They judge the result from the mod's own `Player2 ...` lines in the SMAPI log, from the mod's game endpoint, and from screenshots. They use no SMAPI API and no in-process hooks, and the mod is not changed for testing. A log line alone never proves in-game behaviour, so the behaviour tests also save screenshots of what the player saw.

They run only on a local Windows machine with a display, the game, and a DSH runtime with a working model key. They are not part of CI.

## Oracles

The mod starts `dsh --profile acp` as its own child process, with one DSH session per save in `%USERPROFILE%\.dsh\player2\bridge\projects\<person>\sessions\<saveId>\`. The process exits with the game. DSH keeps its own session logs; the tests never read them while playing, and only the after-run observer below reads them. The tests read these SMAPI lines:

| Line | Meaning |
| --- | --- |
| `Player2 started DSH (acp profile) for companion <name>.` | The companion's DSH process is running. |
| `Player2 sent: <prompt>` | A prompt went to DSH: `[day-start day=N]`, `[chat day=N] <text>`, `[day-end day=N]` or `[resume]`. |
| `Player2 companion said: <text>` | A line the companion spoke, in the game's chat box and the chat transcript. |
| `Player2 turn ended: <stopReason>` | The prompt's turn ended. A chat turn runs from its `sent:` line to the next `turn ended:` line. |
| `Player2 <CODE>: <detail>` | An error: `DSH_START_FAILED`, `DSH_NOT_RUNNING`, `DSH_TURN_FAILED` or `DSH_EXITED`. |

The mod's game endpoint is the second oracle. The tests read its URL and bearer token from `player2.patch.yml` in the bridge directory, the file the mod hands DSH, and call only `world_state`: the host, the companion's farmer (location, tile, inventory, open menu, active input) and the clock. They never call the body's input tools.

## What is covered

| Category | Question |
| --- | --- |
| boot | The game starts through SMAPI, the mod loads, the test save loads, and the mod starts DSH and sends the day-start prompt. |
| presence | The companion joins the save as a hidden co-op farmer. |
| conversation | F2 chat reaches DSH and the turn ends with a spoken line, or with an error code. |
| boundaries | Requests the companion's body cannot do (trading from the player's inventory) are not faked. |
| feel | Time from Enter to the sent prompt, the first spoken line, and the end of the turn. |
| bline | A goal asked in chat makes the companion work, and a stop said in chat ends it. Goals are DSH's own, so the judgement is the spoken reply, the SMAPI lines, the companion's tile and screenshots. |
| mine | P2-0019: asked for 10 copper ore (any season), the companion mines it itself: down the mountain mine with its own pickaxe, reflexes keeping it alive, home to sleep. Needs a template whose farmhand is a chosen companion and `E2E_DAY=6` (the native re-date that opens the mine); world_state is the oracle, and `GoalMetrics` records idle, skill-gap and stuck numbers for every goal run. |
| coop | S13: the companion speaks before it moves and walks to the player, keeps playing with another window in front, buys parsnip seeds at Pierre's, sleeps with the host, and rejoins after the game is quit and the save reloaded. |
| persona | P2-0017: the chosen persona answers its pack's probe questions in character, with no coordinates or internal words. Run once per persona (`$env:E2E_PERSONA = "0"` 大肥鱼, `"1"` 军师) with `-m persona`, then `python e2e/blind_sheet.py` writes `artifacts/blind/sheet.md` without names and `key.md` for the H2 blind test. |

With the companion seated the game is co-op, so the world keeps running while the chat is open.

## Setup

1. Build and deploy the mod ([stardew-mod/README.md](../stardew-mod/README.md)) and make sure `dsh` is installed with a working model key.
2. Install Python 3.14 and the test dependencies: `python -m pip install -r e2e/requirements.txt`.
3. Choose a template save: an untouched day-1 save folder under `%APPDATA%\StardewValley\Saves` whose farm has a cabin, so the companion has a seat. The template is only read, never modified. Spring 1 is a Monday, so Pierre's opens at 9:00; `make_save.py` moves a copy to another date.
4. Run the game at a 16:9 resolution. Close it before starting the tests.

## Run

```powershell
$env:E2E_SOURCE_SAVE = "<day-1 save folder name>"
cd e2e
python -m pytest
```

Each run creates a fresh test character: a copy of the template under a new unique id in the `99xxxxxxx` range. The farmer and its DSH session are therefore new, and no run inherits an earlier run's conversation. The previous run's test save and bridge session are removed by their recorded id. Real saves are never touched, and the run aborts if SMAPI loads any save other than this run's.

Run each live test at most twice per task, including one rerun after a fix. Report the second result instead of retrying further; live runs take hours.

Results go to `e2e/artifacts/<run>/`: `summary.md` (per-category pass/fail), `results.json` (measurements), the SMAPI console, and screenshots of every failure.

## Observe the companion

At the end of a live run, `gamepilot/observe.py` writes `observe.md` and `observe.json` next to the summary. It only reads records that already exist: the body samples (`metrics-samples.json`), DSH's own session log for the run's save (`~/.dsh/sessions/*-sessions-<saveId>--/*/session.v4.jsonl.zstd`) and the companion's facts in the ledger. Player2 adds no log of its own.

| Angle | What it shows |
| --- | --- |
| body | G1-G3, and the idle time split into *mind thinking* (a model call is running) and *nobody working* (no task, no call: the companion just stands) |
| mind cost | model calls, fresh, cached and output tokens, context size per call, compactions |
| mind speed | time per model step, p50 and p95 |
| decisions | tool error rate, repeated-call reminders, `world_observe` calls per plan, plan length (share of one-step plans), plan outcomes (OK, NOT REACHED, input done), goal blocks |
| speech | lines spoken, stage directions such as `（慢慢往家走）`, leaked internals (coordinates, tool words, contracts), repeated lines |
| beliefs | facts kept, how many worked, the negative ones that may go stale |
| timeline | all of the above per game day, with the day's output from `results.json` |

For an older run, name its save (`990000000 + run start epoch % 10000000`, or the `sessions-<saveId>` folder) and optionally an earlier run to compare against:

```powershell
python e2e/gamepilot/observe.py e2e/artifacts/<run> --save-id <saveId> --vs e2e/artifacts/<earlier run>
```

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
| `E2E_DAY`, `E2E_SEASON`, `E2E_YEAR` | Re-date the copied save natively in its XML (and `daysPlayed`), so a scenario starts past date gates such as the mine-blocking landslide before spring 5. |
| `E2E_STRIP_FARM_STONES` | Remove every Stone object from the copy's Farm (a Hill-Top template ships and regrows quarry stones); the mine scenario also strips and reloads at each night boundary, so the mine stays the only ore source for the whole run. |
| `STARDEW_DIR` | Game directory when it is not the default Steam location. |

`budgets.py` holds the responsiveness budgets. Each value is measured, then rounded up. Raise one only with a recorded reason, because every raise loosens the product's feel.
