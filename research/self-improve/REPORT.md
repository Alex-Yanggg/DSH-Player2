# Report: a companion that grows on its own (research round 2)

Branch `self-improve-research`, 2026-10-24. Task contract: [TASK.md](TASK.md); shared brief:
[BRIEF.md](BRIEF.md); process log: [PROGRESS.md](PROGRESS.md); platform facts: [dsh-facts.md](dsh-facts.md);
bench: [bench/README.md](bench/README.md). Debate record: `transcripts/` (5 openings, `round-1/2/3.md`,
per-advocate sources); all fetched URLs merged into [sources.json](sources.json) (48 unique).
Per the task, **no winner is picked** — the judge decides. Per the owner's mid-research amendment:
option (b) is the owner-agreed three-layer memory and option (e) is the owner-added
big-brain/small-brain async design; the original "(e) combinations" survives as the `combo` reference row.

## 1. What the platform gives a self-improving plugin (DSH 0.2.0-rc.2)

Full findings with file paths: [dsh-facts.md](dsh-facts.md). Condensed:

| Facility | Ships? | Shape |
|---|---|---|
| Web search | **Yes** | `ctx.web` service (`@deepseek-ai/dsh-web`) + model-facing `web_search`/`web_fetch` (`dsh-tool-web`); both mounted in the `acp` profile; DeepSeek provider reads `DEEPSEEK_API_KEY`. Cost caveat from the shipped provider's own README: **one search = one full model turn** (no dedicated search endpoint). |
| Cross-session memory | **No service** | Closest: `ctx.sessionQuery` (SQLite FTS5 over all past sessions — mounted in `acp` but with `openAt: never`, i.e. FTS disabled by default), session resume (same session id, log restored), compaction (within-session), `ctx.spillStore` (write-once blobs), AGENTS.md-style injection, render-time persona variables. |
| Goals | Yes | `dsh-goal` persists one objective across turns/resume/restarts; 256-round cap; blocked-policy codes. |
| Skills | Yes | `dsh-skill` + `dsh-skill-filesystem` + `dsh-tool-skill`: on-demand catalog. |
| Batching | Yes | `dsh-ptc-runtime`: one model-written program, many host tool calls, one round-trip. |
| Subagents | Yes | `dsh-subagent-*` (in-process spawn/fork); ACP profile default model is the flash tier. |

Consequence: a self-improving companion must build its growth loop entirely from plugin files,
tools, prompt sections, `ctx.web`, goals/skills/PTC and turn listeners. DSH will not remember,
reflect, search on a schedule, or notice stuck-ness on its own.

## 2. The observed problem, made testable

P2-0019's mine e2e failed because the companion (a) did not know the mine is closed until spring
day 5 and lost days to it, (b) retried the same wall without stepping back, (c) did little per
game day, (d) acted sparsely. The bench turns each into a measurable scenario (both run on the
plugin's unmodified sim **and** on a second toy game, Keycraft):

- **locked / toy2-locked**: the goal stands behind a closure that lifts on day 5 (toy2: a vendor
  arrives day 3). The fact is stated nowhere in the goal text; it is discoverable in-world (a
  readable notice board) or via a simulated deterministic offline wiki (`lib/web-sim.ts` +
  per-scenario corpora). Waits are possible (`wait_minutes`).
- **wall / toy2-wall**: the direct route always fails (an immune golem holds the bridge; a fused
  door never opens); success requires switching approach (a lever opens a gate; a loose panel
  opens a passage).

Metrics per option × scenario (10 seeds each, 40 option-scenario cells + 40 async cells):
success rate, repeated-failure count (failing tasks whose first-press/first-hold signature repeats,
beyond each signature's first failure), time to recover (ticks from the dominant signature's first
failure to the first success after its last failure), actions per game minute (1 sim tick = 4 game
minutes), LLM calls, LOC, plus the round-1 columns (idle ratio, wall clock, stuck events).
**Every number below is a real DeepSeek API call** (`deepseek-chat` served as `deepseek-flash`,
temperature 0) with a disk cache and latency replay; **no stub numbers exist in any table** —
cells where the call cap bound the run are marked in the notes.

## 3. The metric table

### 3.1 Main matrix (10 seeds/cell; `results/metrics.csv`, runs in `results/runs.json`)

| approach | scenario | success | LLM calls (mean) | idle ratio | repeated failures (mean) | recovery (ticks) | actions/game-min |
|---|---|---|---|---|---|---|---|
| llm (baseline) | locked | 0.90 | 19.0 | 0.281 | 0.0 | — | 0.0009 |
| reflect (a) | locked | 1.00 | 11.3 | 0.176 | 0.0 | — | 0.0003 |
| library-cold | locked | 1.00 | 11.3 | 0.190 | 0.0 | — | 0.0005 |
| library (b)* | locked | 1.00 | 10.9 | — | 0.0 | — | — |
| curriculum (c) | locked | 1.00 | 21.0 | 0.339 | 0.0 | — | 0.0011 |
| actionrate (d) | locked | 1.00 | 20.4 | 0.383 | 0.0 | — | 0.0012 |
| combo (b+a+d) | locked | 1.00 | 10.2 | 0.155 | 0.0 | — | 0.0004 |
| llm | wall | 1.00 | 8.5 | 0.296 | 0.0 | — | 0.0013 |
| reflect | wall | 1.00 | 8.6 | 0.337 | 0.0 | — | 0.0012 |
| library-cold | wall | 1.00 | 7.8 | 0.285 | 0.0 | — | 0.0013 |
| library (b)* | wall | 1.00 | 8.6 | — | 0.0 | — | — |
| curriculum | wall | 1.00 | 13.1 | 0.375 | 0.0 | — | 0.0014 |
| actionrate | wall | 1.00 | 8.5 | 0.276 | 0.0 | — | 0.0015 |
| combo | wall | 1.00 | 8.3 | 0.261 | 0.0 | — | 0.0013 |
| llm | toy2-locked | 0.70 | 30.6 | 0.422 | 0.4 | — | 0.0028 |
| reflect | toy2-locked | 0.70 | 32.9 | 0.465 | 1.5 | — | 0.0024 |
| library-cold | toy2-locked | 0.70 | 34.2 | 0.471 | 0.1 | — | 0.0028 |
| library (b)* | toy2-locked | 0.60 | 33.6 | — | — | — | — |
| curriculum | toy2-locked | 0.70 | 34.8 | 0.475 | 0.5 | — | 0.0027 |
| actionrate | toy2-locked | 0.70 | 23.2 | 0.266 | 0.7 | 2156 (2 runs) | 0.0025 |
| combo | toy2-locked | 0.70 | 24.4 | 0.373 | 1.4 | — | 0.0027 |
| llm | toy2-wall | 1.00 | 20.4 | 0.420 | 0.0 | — | 0.0031 |
| reflect | toy2-wall | 1.00 | 21.1 | 0.468 | 0.0 | — | 0.0032 |
| library-cold | toy2-wall | 1.00 | 20.9 | 0.503 | 0.0 | — | 0.0029 |
| library (b)* | toy2-wall | 1.00 | 23.4 | — | — | — | — |
| curriculum | toy2-wall | 1.00 | 23.3 | 0.531 | 0.0 | — | 0.0032 |
| actionrate | toy2-wall | 1.00 | 13.0 | 0.313 | 0.0 | — | 0.0044 |
| combo | toy2-wall | 1.00 | 11.9 | 0.357 | 0.0 | — | 0.0043 |

\* `library` rows are the **owner-agreed three-layer build** (persona across saves + save memory
keyed by the save id + session-end distil), rerun after the amendment (`results/runs.json-library3`;
the main matrix's in-flight library rows used the pre-amendment code and are superseded by these).
Its idle/recovery columns were not re-extracted; see §3.3 for what the rerun adds.

Reading the table honestly:

- **Success rates saturate.** On `locked`, `wall` and `toy2-wall`, essentially every model-driven
  option solves every seed — including the baseline (the one baseline miss is `locked` 0.90). The
  scenarios reproduce the *shape* of the P2-0019 failures and the metrics capture the cost of
  navigating them, but the bench model (deepseek-flash, temperature 0) is strong enough that
  success rate does not separate the options. `toy2-locked` is the one hard cell: **every**
  approach lands at 0.60–0.70, i.e. the same 3–4 seeds fail for everyone — a scenario difficulty
  result, not an architecture result. The separating metrics are LLM calls, idle ratio, and (for
  the async rows) repeated failures — plus the cross-session trajectory in §3.3.
- **On `locked`, the knowledge-oriented options cut calls roughly in half** (library 10.9, reflect
  11.3, combo 10.2 vs baseline 19.0) and show the lowest idle ratios (library-cold 0.19, reflect
  0.18, combo 0.16 vs baseline 0.28). The knowledge scenario is where the options' machinery pays.
- **On `wall` (the easy wall variant), costs converge** (7.8–13.1 calls) — when one map-look
  reveals the lever, no architecture has an edge. This is itself a finding: the wall scenario's
  discriminating power is weak for a model that reads maps well; the toy2-wall variant confirms it
  (all 10/10).
- **`toy2-locked` punishes everyone**: cross-game transfer of the *wait-for-schedule* pattern did
  not happen from the prompt alone; the persona library's distilled generic policy (§3.3) did not
  prevent cap-exhaustion in the same seeds that fail for every other option.

### 3.2 Async matrix — option (e), the owner's big-brain/small-brain split (10 seeds/cell; `results/metrics.csv-async`)

| approach | scenario | success | LLM calls | idle | repeated failures | recovery (ticks) | actions/game-min |
|---|---|---|---|---|---|---|---|
| async (code small brain) | locked | 1.00 | 18.4 | 0.383 | 12.4 | 1593 (10/10 runs) | **0.0033** |
| async | wall | 0.60 | 23.4 | 0.419 | 7.3 | 473 (3 runs) | 0.0016 |
| async | toy2-locked | 0.70 | 14.1 | **0.164** | 14.8 | — | **0.0033** |
| async | toy2-wall | 1.00 | **8.9** | 0.322 | 0.0 | — | **0.0050** |
| async-llm (cheap-model small brain) | locked | 0.80 | 36.8 | 0.527 | 0.5 | 307 (1 run) | 0.0007 |
| async-llm | wall | 0.20 | 37.9 | 0.680 | 3.3 | 441 (2 runs) | 0.0011 |
| async-llm | toy2-locked | 0.00 | 45.0 (cap) | 0.565 | 2.5 | — | 0.0031 |
| async-llm | toy2-wall | 0.00 | 45.0 (cap) | 0.733 | 0.2 | — | 0.0017 |

**The owner's question — can the small brain be a cheap model or must it be pure code — is
answered by this table: pure code wins every cell at equal call budgets.** The code small brain
achieves the matrix's best action rates (0.0033–0.0050 actions/game-minute, 2–4× the main
matrix's best) and the lowest observed idle on toy2-locked (0.164) at 8.9–23.4 calls; the
cheap-model small brain burns 2–4× the calls, is cap-pinned at 45.0 on both toy2 scenarios
(0/20), and pays idle 0.53–0.73. This is the async design's own falsifiability clause working:
the bench rejected the flash-tier small brain exactly as the owner's add-on asked it to test.
The honest weaknesses in the same table: the async (code) rows carry the matrix's highest
repeated-failure counts on `locked`/`toy2-locked` (12.4/14.8 — the plan executor re-attempts a
blocked approach until its 3-strikes detector escalates, and its re-plan policy then retries the
same wall in new plans), and `wall` 0.60 is the matrix's worst success on that scenario
(6/10) — the bench prototype ships no lesson store and its re-planning is memoryless.

### 3.3 Cross-session growth: the three-layer library's trajectory (`results/runs.json-library3`)

The warm library's seeds are successive sessions on one save. Per-seed LLM calls
(repeated failures were 0 in every successful run):

| scenario | seed 1 (first sitting) | seeds 2–10 (later sittings) |
|---|---|---|
| locked | 17 calls | 9–11 calls (−40% after the first session) |
| wall | 9 | 7–10 |
| toy2-locked | 27 | 23–30 (6/10; the same hard seeds fail) |
| toy2-wall | 22 | 20–34 |

What the store actually accumulated (committed under `results/library/`): save memory holds the
world fact ("the north pass … blocked by a Rockslide at (11,4); the repair crew clears it on the
morning of day 5"), and the **persona layer distilled a genuinely game-generic policy — "when a
destination is gated by a scheduled world event, check the schedule before attempting the route
and wait rather than retrying" — learned across both games** (the Keycraft vendor produced it).
The honest defect: distil de-duplicates by exact string, so paraphrased near-duplicates
accumulate session over session (the same shrine fact appears three times in three wordings) —
the prompt-bloat risk the library advocate conceded, visible in the artifact.

## 4. The options: best arguments and surviving attacks

Full record: openings + rounds 1–3 in `transcripts/`. What survives, per option:

### (a) reflect — stuck detector + reflect-and-search
**Best arguments.** The measured cheapest knowledge fix on the bench's own scenario (locked 1.00
@ 11.3 calls, idle 0.176, zero repeated failures); Reflexion's ablation (blind retries 0.60 vs
0.68) is the P2-0019 wall exactly; ExpeL's insight lifecycle and RSIAgent's frozen lesson memory
show the loop's shape at scale. It is the *writer* every store needs.
**Surviving attacks.** Lessons die with the run as prototyped (the bench keeps them in RAM;
cross-run persistence is (b)'s layer) — reflection alone cannot compound; reflection is reactive —
it pays first-failure tuition before it learns, and its wiki searches cost a full model turn each
in real DSH; the model can distil wrong lessons (no verifier beyond environment feedback — the
RSIAgent attack survives unresolved).

### (b) library — the owner-agreed three-layer memory
**Best arguments.** The only option that compounds: the per-seed trajectory (17 → 9–11 calls on
`locked`) and the distilled cross-game persona policy are demonstrated artifacts, not promises;
round-1's skills row (mine 8/10 at ~0.1 calls from retrieval) is the strongest single datum any
advocate cited; it held the knowledge scenario at the cheapest successful call count and lowest
idle (0.144 in the main-matrix build); the save key (`Game1.uniqueIDForThisGame`) is mod-readable
at runtime (cited mod source), no watermarking needed; DSH ships no memory service, so plugin
files + prompt sections are the only DSH-native shape.
**Surviving attacks.** A store needs a producer — the design still requires a stuck-reflection or
survey trigger to fill it (the "who fills it" attack survives as a composition requirement);
stale lessons are only bounded by asOf/confidence fields, not by a verified correction mechanism;
distil paraphrase-duplicates accumulate (seen in the artifact); warm-vs-cold deltas are 1–3 calls
on the easy scenarios — the compounding claim is currently demonstrated on one scenario
(`locked`) and one hard cell where it does not yet help (`toy2-locked` 0.60).

### (c) curriculum — exploration-first
**Best arguments.** Fixes the knowledge class at the root with zero network (the notice board is
readable before any failure); Voyager's curriculum ablation (random curriculum −93% discoveries)
and Go-Explore's "archive before grinding" are strong evidence that surveying first works; the
field guide is the natural *producer* for (b)'s layers.
**Surviving attacks.** The cost attack stands: the survey adds calls on the bench (21.0 vs 11.3
on `locked`; 34.8 on `toy2-locked`) and no amortization is yet measured across sessions (its own
prototype's guide dies with the run); "the world documents itself" is partly scenario-author
charity (the notice board's placement is authored); survey-first needs a permission story the
opening only partially gave (the owner's rules allow it only inside the delegated plan's
boundaries); and on `wall`, where looking at the map suffices, it paid 13.1 calls for no success
gain.

### (d) actionrate — batched plans, reflex tier, skills
**Best arguments.** The measured substrate claim: its executor is the matrix's cheapest cells
(actionrate `wall` 8.5 calls, `toy2-wall` 13.0 @ 0.0044 actions/game-minute; combo with the same
executor 10.2–11.9 calls), and Anthropic's code-execution-with-MCP (98.7% token saving) plus AWM
(steps 7.9 → 5.9) evidence the batching dividend; the sharpened round-2 claim survived: grinding
is a plan property, not a rate property — its stop-on-first-failure executor measured 0.0
repeated failures everywhere.
**Surviving attacks.** It fixes throughput, not knowledge — conceded from the opening and never
disputed; on `locked` it paid the most calls of any non-curriculum option (20.4) because its
batches still route through the model for every decision; "skills/reflex tables are per-game data
in disguise" was answered (runtime-authored, adapter-driven) but the reflex tier's shipped
per-game table (`reflexes/stardew-valley.json`) remains a real precedent the owner's rule has to
be applied to carefully.

### (e) async — big-brain/small-brain (owner's design)
**Best arguments.** The only design that attacks knowledge and rate on independent clocks; the
code small brain's cells are the matrix's best action rates (up to 0.0050 actions/game-minute)
and lowest toy2-locked idle (0.164) at low calls (8.9–14.1 on three of four scenarios); the
owner's code-vs-cheap-model question is *answered inside the design's own bench* (flash-tier
small brain 0/20 on toy2, cap-pinned — the verdict is "pure code" with the falsifiability clause
demonstrated); PUBG Ally and SwiftSage show the fast/slow split shipping in products.
**Surviving attacks.** The prototype's re-plan policy is memoryless and wall-re-hitting: worst
repeated-failure counts (12.4–14.8) and the matrix's worst `wall` success (0.60) — the design
needs (b)'s store and a re-plan guard it does not yet ship; the bench harness prices the async
clock synchronously (the big brain's planning time lands in wall-clock while the small brain
holds), so the design's central "never blocks the body" advantage is under-measured by this
harness and remains argued rather than measured; two-brains debugging cost is conceded but
bounded only by logging discipline (the complete replay trail exists in the bench logs).

### The static composition (reference row: combo = b+a+d)
Not a debated option (per the owner's amendment), but it held the best `locked` cell of the main
matrix (10.2 calls, idle 0.155, 1.00) and matched or beat its parts everywhere except the
uniform-hard `toy2-locked`. It is the cheapest demonstration that the options' mechanisms
compose without interference.

## 5. Cross-game cost

LOC accounting (`results/loc.json`; non-blank lines; `lib/driven.ts` counted as shared
infrastructure except the `[plan-submit]` region charged to actionrate/combo):

| option | loc_core | shipped per-game data |
|---|---|---|
| reflect (a) | 84 | 0 |
| library (b, 3-layer) | 141 | 0 |
| curriculum (c) | 111 | 0 |
| actionrate (d) | 25 (+ plan executor) | 0 |
| combo (b+a+d) | 97 | 0 |
| async (e, both variants) | 358 | 0 |
| round-1 reference: llm / goap / handcoded | 86 / 340+39 / 115 | 0 / 39 / 0 (goap port to toy2: +218) |

Every round-2 option ships **zero game-specific lines**; all game facts (maps, corpora, notice
texts) are bench fixture data, and everything learned at runtime lives in plugin-owned files.
The second game cost only the Keycraft variant adapters (`toy2/variants.ts`, a bench fixture, not
shipped plugin code) plus zero approach changes — identical approach code ran on both games
through the same port. This is the extensibility story the judge weights, and the bench
supports it: no per-game knowledge tables exist in any option's plugin-side code.

## 6. Open risks

1. **External validity of the model.** deepseek-flash at temperature 0 solved nearly every seed;
   the success-rate column cannot separate the options here. The cost/behavior columns and the
   async-llm rejection carry the signal. Weaker models (or a live game's noisier observations)
   may re-open the success-rate gaps the bench closed.
2. **Scenario authoring charity.** The notice board's distance, the wiki corpora's phrasing and
   the lever's map visibility were authored to be discoverable. The P2-0019 real failure involved
   export gaps (unremoved landslides, hidden warps) a bench fixture cannot fully reproduce.
3. **The async clock is under-measured.** The harness interleaves big-brain planning into
   wall-clock while the small brain holds; "never blocks the body" is only partially exercised
   (the small brain *did* keep acting — 22–67 tasks/run — but true concurrency effects on a live
   tick budget need the real mod).
4. **Learned-data quality.** No verifier beyond environment feedback exists in any option; wrong
   lessons persist until a failure contradicts them; paraphrase dedup is unsolved (seen in the
   artifact). RSIAgent's verifier-isolation and CLIN's reconcile step are the cited directions.
5. **Web search in real DSH costs a model turn per query** and needs the DeepSeek credential;
   the bench wiki is offline, deterministic and free — real searches will be rarer and slower
   than the bench's.
6. **Permission boundary.** Survey-first and wait-strategies run inside the delegated plan today;
   any curriculum that generates its own objectives (Voyager-style) needs the owner's explicit
   permission surface before it ships — the advocates converged on "delegated-goal-triggered
   looking", not self-generated tasks.
7. **Cache determinism.** Reruns replay cached replies with recorded latency; the recorded matrix
   is one sample of a stochastic system at temperature 0. `BENCH_NO_SLEEP_CACHE=1` smoke runs are
   plumbing-only and were never recorded.

## 7. Artifact index

- `dsh-facts.md` — verified platform facts (file paths).
- `bench/` — scenarios (`lib/locked.ts`, `lib/wall.ts`, `toy2/variants.ts`), offline wiki
  (`lib/web-sim.ts`, `lib/corpus/`), options (`lib/approach-{reflect,library,curriculum,actionrate,combo,async}.ts`),
  shared loop (`lib/driven.ts`), mechanics check (`check-scenarios.ts`).
- `results/` — `metrics.csv` + `runs.json` (main matrix), `metrics.csv-async` + `runs.json-async`
  (option e), `metrics.csv-library3` + `runs.json-library3` (three-layer b), `summary.json*`,
  `loc.json`, library stores (`library/*.json`).
- `transcripts/` — `advocate-*.md` (5 openings), `round-1/2/3.md` (assembled), per-advocate
  `sources-*.json`; `notes-rsi.md`, `notes-classics.md` (required reading); merged
  [sources.json](sources.json) (48 URLs).
