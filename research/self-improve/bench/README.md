# The behavior-architecture bench

This is the round-1 bench (copied from `origin/behavior-research:
research/behavior-debate/bench`, unmodified) **extended for the round-2
self-improvement options**. The round-1 farm/mine/toy2 numbers are cited from
`origin/behavior-research:research/behavior-debate/results/` and are NOT rerun
here; the round-2 runner covers the new scenarios only.

## Round 2: the self-improvement matrix

One command reruns everything (from `research/self-improve/bench/`):

```
npx -y tsx run.ts all
```

Flags: `--seeds N` (default 10), `--concurrency N` (default 3), `--approaches
a,b` (subset of `llm,reflect,library,library-cold,curriculum,actionrate,combo`),
`--scenarios a,b` (subset of `locked,wall,toy2-locked,toy2-wall`),
`--skip-prime` (keep the warm library on disk). The warm `library` always runs
sequentially in seed order — its seeds ARE successive sessions on one save, and
the store is reset first (seed 1 discovers, seeds 2..N start with what earlier
sessions learned). `library-cold` keys its store per seed as the control.
Outputs: `../results/runs.json`, `../results/summary.json`,
`../results/metrics.csv`, `../results/loc.json`.

Scenario mechanics validation (no LLM): `npx -y tsx check-scenarios.ts`.
Plumbing smoke tests (not recorded results): `npx tsx smoke.ts
lockedreflect|walllibrary|toy2-lockedcurriculum|... [seed]` — fast mode runs
the sim ~17x faster than the recorded real-time pace. Typecheck:
`npx tsc -p tsconfig.json`.

### Round-2 scenarios

Both mirror the P2-0019 mine failure: a delegated goal the companion cannot
reach, where the missing fact is knowable only from the world or the wiki.

- **locked / toy2-locked (locked area).** The goal stands behind a pass that is
  closed until the morning of day 5 (day 3 for the toy2 vendor). The condition
  is stated nowhere in the goal text. Discoverable by exploring (a readable
  notice board near the start) or via the scenario's simulated wiki. Until the
  day arrives, walks into the closure end "blocked" — retries are exactly the
  repeated-failure behavior the metric targets. The closure lifts by itself;
  a `wait_minutes` tool lets an informed approach pass time deliberately.
- **wall / toy2-wall (repeated wall).** The direct route always fails: a Clay
  Golem holds the only bridge, is immune to the starter weapon (each swing is a
  failing task and drains health), and never moves. Success requires switching
  approach: pull the Shrine Lever in the west grove (toy2: give up the fused
  Silver Door and open the Loose Panel). The lever/panel is visible on the map
  and documented in the wiki.

Both scenarios run twice — on the plugin's sim (`lib/locked.ts`, `lib/wall.ts`:
subclass + wrapper around the UNMODIFIED `sim-adapter.ts`, exactly like the
round-1 mine wrapper) and on a second toy game (Keycraft variants,
`toy2/variants.ts`, same port shape as `toy2/game.ts`). Sim clocks: day = 1 +
floor(tick/350) with timeOfDay kept consistent (1 tick = 4 game minutes); day 5
begins at tick 1400. The wiki is a deterministic offline corpus
(`lib/corpus/<scenario>.json`, `lib/web-sim.ts`): `web_search` returns
keyword-ranked title/url/snippet hits, `web_fetch` returns page text. No
network is made; the corpus is scenario fixture data like the map rows.

### Round-2 approaches (`lib/approach-*.ts` over the shared loop `lib/driven.ts`)

- **llm** — the round-1 pure-LLM baseline (one added rule: the turn ends when
  the goal check holds), reference rows on the new scenarios.
- **reflect (option a)** — stuck detector (consecutive failing body tasks with
  the same first-press/first-hold signature) + reflect-and-search: lessons
  saved in-run, simulated wiki search/fetch, wait_minutes.
- **library (option b)** — persona-level lessons keyed by the scenario's save
  id, loaded transparently into the prompt each session, grown via
  library_learn; `library-cold` is the per-seed control.
- **curriculum (option c)** — exploration-first survey phase (guide_write +
  curriculum_done, bounded by a turn budget) before working the goal with the
  field guide injected.
- **actionrate (option d)** — plan_submit batching: one model call plans up to
  8 body-tool calls, a plugin-side executor runs them in order (stopping on the
  first failure) and returns a digest.
- **combo (option e)** — library + stuck-reflect-with-search + plan batching.

### Round-2 metrics (per approach x scenario, 10 seeds)

Beyond the round-1 columns: `repeated_failures_mean` — failing tasks whose
signature (first press, else first hold, plus arrive/warp target) repeats,
counted beyond each signature's first failure ("same failing action retried");
`recovery_ticks_mean` — game ticks from the first failure of the dominant
failing signature to the first success after its last failure, over runs that
recovered; `actions_per_game_minute` — done body tasks per game minute (4 game
minutes per sim tick). Round-1 columns (success rate, llm calls, wall clock,
idle/gap ratios, stuck events) are unchanged. loc.json adds the round-2
approaches; `lib/driven.ts` counts as shared infrastructure except its
`[plan-submit]` region, which is charged to actionrate and combo.

## Round 1 (unchanged, from origin/behavior-research)

One command reran everything (from `research/behavior-debate/bench/`):

```
npx -y tsx run.ts all
```

That primes the on-disk skill libraries (one authoring run each for `skills`
and `hybrid`), runs the full matrix — every approach x {farm, mine} x seeds
1..10 — plus the toy2 porting verification (3 seeds per port), and writes
`../results/runs.json`, `../results/runs-toy2.json`, `../results/summary.json`,
`../results/metrics.csv` and `../results/loc.json`.

Useful flags: `--seeds N`, `--concurrency N` (default 3), `--approaches a,b`
(subset of `llm,llm-bt,modes,skills,goap,hybrid,handcoded`), `--scenarios
farm,mine`, `--skip-prime` (reuse the libraries on disk), `--toy2-only`.
Plumbing smoke tests (not recorded results): `npx -y tsx smoke.ts farm|mine|llmfarm|llmmine|skillsfarm|btfarm|modesmine|goapmine|hybridfarm|toy2llm|...`.
Typecheck: `npx tsc -p tsconfig.json`.

## What is measured, and how

- **The model is real.** Every LLM call goes to the DeepSeek chat-completions
  API with the environment's `DEEPSEEK_API_KEY` (model `deepseek-chat`, served
  as `deepseek-flash`, temperature 0) — no GLM API key exists in this
  environment. Every request/response pair is cached under `cache/llm/`
  (keyed by the full request); a cache hit replays the recorded latency, so
  reruns are fast, cheap, and keep realistic timing. The cache is a bench
  artifact: delete `cache/` to re-bill. No other network requests are made.
- **Scenarios** (fixed seeds, 10 runs per approach x scenario):
  - *farm* — till, plant and water 6 parsnips on a 13x10 field (seeded pond
    and stones; the plot x 7..9, y 3..5 stays reachable). Success = 6 tiles
    hold a watered parsnip.
  - *mine* — reach the ladder at (11,1) from (1,8) with two chasing monsters
    (aggro 5 tiles Chebyshev, ~0.47s/tile, 10 damage per bite, 1s cooldown)
    and 40/100 health. Success latches the moment the body stands on the
    ladder alive.
  - Both scenarios run on the repo's unmodified
    `packages/dsh-companion-plugin/src/body/sim-adapter.ts`, imported from
    source. The mine wrapper (`lib/mine.ts`) adds monster movement, contact
    damage and the health pool around the adapter — the adapter itself is
    untouched; approaches see only the instrumented port.
  - *toy2* (`toy2/game.ts`) — "Keycraft": a second toy game with a different
    state and input vocabulary (keyboard keys, keys/doors/materials/crafting)
    behind the same port shape; used for the porting-cost metric and a 3-seed
    verification run per approach.
- **Approaches** (`lib/approach-*.ts`): the pure-LLM baseline drives the
  product's own tools (`createBodyTools` imported from the plugin); each other
  approach is a minimal prototype of one debate architecture. All approaches
  get the same DSH-style goal rounds: an approach that claims DONE while the
  delegated goal is unmet is re-prompted instead of ending the turn
  (`ctx.goalCheck`).
- **Metrics per approach x scenario** (`results/metrics.csv`):
  - success rate (ground truth checked by the scenario, latched at first
    satisfaction);
  - LLM calls per task (real API calls; cache hits count as calls — they are
    model turns; for `skills`/`hybrid` the first run pays authoring, later
    runs retrieve from the on-disk library — the amortization is the
    architecture's claim and is visible in the raw per-seed records);
  - wall-clock seconds (real-time sims: 17ms per game tick);
  - idle ratio = game ticks with no active body task while a model call was in
    flight / elapsed ticks ("body idle while waiting on the model"); gap ratio
    = idle ticks with no model call;
  - stuck/recovery events = body tasks that ended interrupted/failed plus
    recoveries the approach self-reported (replans, re-authors, revisions);
  - lines of code (`results/loc.json`): non-blank lines of the approach module
    (loc_core), shipped per-game data (loc_data: the goap domain JSONs), and
    the toy2 port cost (changed/added lines; `lib/loc.ts` documents each
    number's derivation, and the goap port regions are sentinel-marked in the
    source).
- **Determinism**: seeds fix the world layout and monster behavior; the model
  is non-deterministic in principle (temperature 0 still varies), and the
  recorded cache makes reruns replay the same replies with the same latencies.

## Metric definitions worth quoting in the report

- `idle_ratio_mean` is the headline latency metric: how much of the run the
  body stood with nothing to do while a model call was in flight.
- `stuck_events_mean` counts both world interruptions (blocked/monster
  interrupts from the port) and approach-internal recoveries; high values with
  high success mean a reactive-but-working architecture.
- The metric table in `../REPORT.md` marks which numbers come from real API
  calls (all of them, unless a run errored — errors are counted in the
  `errors` column and visible per-run in `runs.json`).
