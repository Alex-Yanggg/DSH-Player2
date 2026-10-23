# The behavior-architecture bench

One command reruns everything (from `research/behavior-debate/bench/`):

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
