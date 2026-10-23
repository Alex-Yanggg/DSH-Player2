# Behavior-architecture debate: final report

How should the Player2 companion turn a player's goal ("plant and water the
parssnips", "get to the ladder") into in-game actions? Ten advocates — each a
GLM sub-agent with web research and fetched citations — defended ten
architectures through three cross-examination rounds, and a bench measured a
minimal prototype of each runnable architecture on the repo's own body
simulator. **This report does not pick a winner.** A separate judge does, and
the judge's top-weighted criterion is *extensibility across many games while
staying a DSH plugin*.

Where everything lives:

- The task contract: [TASK.md](TASK.md). The shared brief: [BRIEF.md](BRIEF.md).
- Openings: `transcripts/advocate-<name>.md` (+ per-advocate source lists
  `transcripts/sources-advocate-<name>.json`; all fetched URLs merged into
  `transcripts/sources.json` — 134 unique URLs, each with fetch date and note).
- Rounds: `transcripts/round-1.md`, `round-2.md`, `round-3.md` (assembled from
  the per-advocate `round<n>-<name>.md` contributions).
- Finalists and criteria: [transcripts/finalists.md](transcripts/finalists.md).
- Bench: [bench/](bench/) — one command reruns everything (see
  [bench/README.md](bench/README.md)). Raw per-run records:
  `results/runs.json` (140 runs), `results/runs-toy2.json` (21 runs),
  aggregates `results/summary.json`, table `results/metrics.csv`, line counts
  `results/loc.json`. Model-authored artifacts: `results/skills/`.
- Process log: [PROGRESS.md](PROGRESS.md).

The five finalists (by the criteria in finalists.md): **llm** (the incumbent
tool-loop), **modes** (reactive data-driven layer), **goap** (planner with LLM
goal translation), **skills** (code-skill library), **hybrid** (composed
directive). llm-bt and handcoded are reported as non-finalist reference rows.

---

## Method

**The debate.** Each advocate read the same brief (the repo's real
architecture, the seven DSH seams, the product constraints), researched with
web search and actual fetches, and wrote an opening with a claim, mechanism,
seam mapping, evidence, an extensibility section, and anticipated attacks.
Three rounds followed: attacks on at least two rivals' concrete claims (R1),
answers plus new attacks (R2), final answers, final attacks, and an honest
closing position (R3). Advocates verified each other's sources — e.g. the
llm-bt advocate disproved the brief's "PORTAL (Park et al.)" attribution by
searching arXiv and finding the real PORTAL (Xu et al., 2025,
[arXiv:2503.13356](https://arxiv.org/abs/2503.13356)), and the model advocate
found miHoYo's actual game-playing work (GameScaling,
[arXiv:2610.28698](https://arxiv.org/html/2610.28698), Apache-2.0 weights).

**The bench.** Every LLM number below comes from **real model calls** — the
DeepSeek chat API (model `deepseek-chat`, served as `deepseek-flash`,
temperature 0) using the environment's `DEEPSEEK_API_KEY`. No GLM API key
exists in this environment, so no run is a GLM call; **nothing is stubbed**
(no scripted-model numbers appear anywhere in the table). Calls are cached on
disk with their recorded latency; reruns replay them, which keeps the
one-command rerun cheap and timing-realistic.

Scenarios (10 seeded runs per approach x scenario, fixed seeds shared across
approaches):

- **farm** — till, plant and water 6 parsnips on a 13x10 field (seeded pond
  and stones). Success = 6 watered parsnips (latched at first satisfaction).
- **mine** — reach the ladder tile with two chasing monsters and 40/100
  health. Success = standing on the ladder alive.
- Both run on the repo's **unmodified**
  `packages/dsh-companion-plugin/src/body/sim-adapter.ts`, imported from
  source; the mine scenario adds monsters/health via a bench wrapper, and
  approaches see only an instrumented body port. All approaches get the same
  DSH-style goal rounds: a premature DONE claim is re-prompted until the goal
  is met or the budget expires.
- **toy2** (Keycraft) — a second toy game with a different state and input
  vocabulary (keyboard keys; keys, doors, materials, crafting) behind the same
  port shape: 3 seeded verification runs per approach, and the porting line
  counts.

Metric definitions (details in [bench/README.md](bench/README.md)): idle
ratio = ticks with no active body task while a model call was in flight /
elapsed ticks; stuck events = interrupted/failed body tasks plus
approach-reported recoveries; LOC counted by `bench/lib/loc.ts` (non-blank,
non-test; shared harness excluded, derivations documented).

---

## The metric table

All LLM numbers are real API calls (see Method). `llm` = calls per task.
`loc` = prototype core lines + shipped per-game data lines. `port` = toy2
porting cost, changed+added lines.

### farm (10 runs each)

| approach | success | llm calls (mean) | wall s (mean) | idle ratio | stuck events | loc (core+data) | port |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **llm** (baseline, finalist) | 10/10 | 18.9 | 44.5 | 0.36 | 0.9 | 83+0 | 0 |
| **modes** (finalist) | 10/10 | 1.0 | 8.6 | 0.00 | 0.0 | 365+0 | 0 |
| **goap** (finalist) | 10/10 | 1.0 | 7.4 | 0.00 | 0.1 | 340+39 | 213 (127 code + 86 data) |
| **skills** (finalist) | 10/10 | 0.0 * | 7.2 | 0.00 | 0.0 | 217+0 | 0 |
| **hybrid** (finalist) | 10/10 | 4.3 | 14.4 | 0.12 | 3.3 | 208+0 | 0 |
| llm-bt (reference) | 10/10 | 1.0 | 16.0 | 0.00 | 0.0 | 333+0 | 0 |
| handcoded (reference) | 10/10 | 0.0 | 7.2 | 0.00 | 0.0 | 115+0 | 49 |

\* skills rows are steady-state library retrieval: the skill was authored
once (1-3 calls, recorded in the prime run and in `results/skills/`), then
retrieved by every run at zero calls. The amortization is the architecture's
claim; the raw per-seed calls are in `results/runs.json`.

### mine (10 runs each)

| approach | success | llm calls (mean) | wall s (mean) | idle ratio | stuck events | avg hits taken |
| --- | --- | --- | --- | --- | --- | --- |
| **llm** (baseline, finalist) | 5/10 (dagger) | 6.7 | 15.2 | 0.28 | 1.9 | 3.6 |
| **modes** (finalist) | 2/10 | 3.5 | 15.6 | 0.18 | 3.7 | 1.2 |
| **goap** (finalist) | 9/10 | 1.2 | 10.1 | 0.00 | 18.4 | 0.4 |
| **skills** (finalist) | 8/10 | 0.1 * | 9.2 | 0.00 | 0.8 | 1.1 |
| **hybrid** (finalist) | 3/10 (dagger) | 5.8 | 23.4 | 0.38 | 5.2 | 2.5 |
| llm-bt (reference) | 2/10 (dagger) | 3.1 | 10.2 | 0.17 | 4.3 | 2.1 |
| handcoded (reference) | 8/10 | 0.0 | 9.1 | 0.00 | 1.0 | 1.2 |

(dagger) The mine is timing-sensitive: the same cached model replies replayed
under slightly different wall-clock interleavings change how long the body
stands exposed between calls. Two complete 140-run replicas exist (both in
the bench logs; the table shows the clean single-process rerun) and moved the
model-in-the-loop rows within these bands: llm 50-70%, llm-bt 10-20%, hybrid
20-30%, modes 20%. The fixed-executor rows (goap 90%, skills 80%, handcoded
80%) were identical across replicas.

### toy2 — the porting scenario (3 runs each)

| approach | success | llm calls (mean) | port cost (lines) | what porting means |
| --- | --- | --- | --- | --- |
| **llm** | 3/3 | 26.7 | 0 | same code; the model explores the new game interactively |
| **goap** | 3/3 | 1.0 | 213 | new domain JSON + fixed-stack additions (BFS inventory planner, pressAt operator, item predicates) |
| **skills** | 0/3 | 4.0 | 0 | same runtime; the model must author a new skill — it failed within its repair budget |
| **modes** | 0/3 | 4.0 | 0 | same selector; the model must author a new mode table — it failed |
| **hybrid** | 0/3 | 7.0 | 0 | same executor; the model must author a new directive — it failed |
| llm-bt | 0/3 | 3.0 | 0 | same interpreter; the model must author a new tree — it failed |
| handcoded | 3/3 | 0.0 | 49 | the controller is rewritten for the new game |

The toy2 headline: **zero-code porting and one-shot model authoring are
different claims.** The approaches that ported with zero code changes split
cleanly — the interactive tool-loop (llm, ~27-30 calls of exploration) and the
planner (goap, 1 call: its search composed the lock-and-key dependency that
defeated every one-shot authoring architecture on this model).

---

## Per-approach summary

Each entry: the advocate's strongest arguments (with the load-bearing fetched
citations), the strongest attacks that survived three rounds, the bench story,
and open risks. Citations below are URLs the advocates actually fetched; the
full 134-URL index with fetch dates is
[transcripts/sources.json](transcripts/sources.json).

### llm — pure LLM tool calling (the incumbent; finalist)

**Strongest case.** The model owns the loop through the product's real tools;
the adapter declaration is the *only* per-game surface, and nothing
accumulates per game in code. In the bench it is the only LLM-bound approach
that solved toy2 interactively (3/3, ~30 calls), it matched 100% on farm, and
its mine survival (50-70% across replicas) beat every one-shot authored-data approach except goap and skills. ReAct-class evidence ([arXiv:2210.03629](https://arxiv.org/abs/2210.03629))
and the MCP/tool-calling ecosystem support the loop's generality; the repo's
own `walkTo` helper already amortizes navigation (up to 14 legs per call) with
`until`-condition interrupts as the reactive substrate.

**Strongest surviving attacks.** The reflex gap: `until.monsterWithin` stops
the body but nothing *responds* until the next model call (modes, hybrid, rl
all landed this; the advocate conceded it in round 3 and withdrew the ">15s"
figure to an honest ~1-5s for short calls). Latency economics: farm idle
ratio 0.36 with 18.9 calls/task and 44.5s wall — the most expensive row on
the farm; repetition never gets cheaper (no accumulation), priced directly by
the bench. Long-horizon dithering is bounded here by goal rounds but is a
real product risk.

**Bench story.** Farm 10/10 (18.9 calls, 44.5s, idle 0.36). Mine 5/10 in the
clean replica and 7/10 in the first — the failures are bodies standing still
while a call was in flight; the successes are runs where the walk helper kept
the body moving. toy2 3/3 — interactive discovery works.

**Open risks.** Visible idle time to a co-op player; per-decision cost on
every delegated chore; mine deaths while thinking; and the bench's model is a
small fast model — a stronger model would change the latency/success trade.

### modes — data-driven reflex/modes layer under the LLM (finalist)

**Strongest case.** System 1/system 2 with evidence at product scale:
Krafton's PUBG Ally ships exactly this split (SLM above tick-rate reflexes;
"reflex-level actions never have to wait for the model" —
[NVIDIA ACE post](https://developer.nvidia.com/blog/how-krafton-built-pubg-ally-a-co-playable-character-powered-by-nvidia-ace)),
Mindcraft's modes are shipped data
([github.com/kolbytn/mindcraft](https://github.com/kolbytn/mindcraft)), and
DPT-Agent (ACL 2025) grounds the FSM-under-LLM split. In the bench, farm was
1 call, 8.5s, zero idle — the executor keeps the body moving with no model in
the loop.

**Strongest surviving attacks.** The macro library is per-game code by
another name (llm-bt, hybrid, goap pressed this; the advocate conceded it as
an occasional engineering ticket). The tier cannot learn — first-draft
tactics are authored, not earned (rl). And the bench's own mine result is
damning: 2/10 — the model's one-shot mode tables could not handle the
monster layouts reliably, and the failed runs died *between* revisions.

**Bench story.** Farm 10/10 at 1 call. Mine 2/10 (3.6 calls, idle 0.22): the
selector and interrupt machinery work (mode-switching traces are clean), but
the authored tables' tactics fail across seeds. toy2 0/3: no door logic in
the tables within the repair budget.

**Open risks.** One-shot authoring reliability on novel games is the open
wound this bench exposed; the macro library needs occasional mid-session
tickets (conceded); thresholds are cliffs compared to utility curves.

### goap — GOAP planner with LLM goal translation (finalist)

**Strongest case.** The plan is a checkable, inspectable artifact built by a
fixed search; the LLM only translates goals (LLM+P and Guan/Mahdavi evidence,
[arXiv:2304.11477](https://arxiv.org/abs/2304.11477) and the round-2
record). The bench is its showcase: 100% farm at 1 call, **90% mine at 1.2
calls** (the interrupt policies + replanning absorbed monsters — 18.4
stuck-events are the planner *working*), and the only 1-call toy2 success:
the BFS planner composed the lock-and-key dependency that defeated every
authored-data approach.

**Strongest surviving attacks.** The grounding extractor — the per-game code
that maps raw state to predicates — is real code the "all game specificity is
data" claim hides (utility, fsm, llm pressed it; conceded as a one-time
CI-tested module, priced at 213 lines in the toy2 port). LLM-authored domains
carry a semantics residual (Mahdavi's 66%-vs-29%); replanning can storm
(the bench's 18.4 stuck events are also the cost of not having a cheaper
reflex tier — the fsm advocate's "HTN is a BT in a trench coat" cuts here);
and the flagship farm scenario is unrepresentatively sequential.

**Bench story.** The strongest all-around row: fast, cheap, reliable on both
scenarios, and the best toy2 result per call. The cost is the porting bill
and the extractor's honesty problem.

**Open risks.** Domain authoring quality for real games (the sim domains are
small); the 213-line port is for a *toy* second game; grounding predicates in
Stardew's raw export is unmeasured.

### skills — LLM-written code skills + library (finalist)

**Strongest case.** Behavior becomes compounding per-game data on DSH's own
PTC/run_code seam: Voyager's library numbers
([arXiv:2305.16291](https://arxiv.org/abs/2305.16291)), CodeAct's +20% for
executable actions, SkillWeaver's +31.8% and cross-agent transfer. In the
bench the amortization is real and visible: the farm skill was authored once
(1-3 calls) and every later run retrieved it — 0 calls, 7.2s, 10/10; the
authored mine skill (a reactive loop with monster handling the model wrote
itself) went 8/10 at 0 calls — the best mine cost profile.

**Strongest surviving attacks.** The sandbox: model-authored code executing
against the body is a trust question the file-policy sandbox does not fully
close (llm, hybrid pressed; the advocate kept the "permissions + logging,
sim-first ladder" answer but conceded the boundary is policy, not proof).
Same-domain-only transfer evidence (model). Day-one authoring latency: the
toy2 failure (0/3 within a 5-attempt repair budget) is the same one-shot
authoring wound as modes'.

**Bench story.** The cheapest steady-state row on both scenarios. The
authoring cost is paid once per game+task-family and is recorded; the toy2
failure prices the risk that a new game's authoring exceeds the repair
budget.

**Open risks.** Sandbox trust for a co-op product; authoring reliability on
novel games; retrieval brittleness at library scale (untested here).

### hybrid — LLM directive + reflex executor + skills (finalist)

**Strongest case.** CoALA-style composition
([arXiv:2309.07864](https://arxiv.org/abs/2309.07864)) with one shared
vocabulary: a single authoring turn emits table + skills, validated before
live binding; the executor owns control between turns; the library
accumulates. The advocates' rounds themselves showed every rival shipping
these layers piecemeal — the hybrid's claim is that one artifact flow beats
N vocabularies.

**Strongest surviving attacks.** Integration cost is the bill: the bench's
own numbers — farm 9/10 at 4.4 calls with idle 0.35 (the directive revisions
re-introduce model waits), mine 2/10, toy2 0/3 at 7 calls with the heaviest
validation churn of any approach. llm-bt's "your O(1) engine runs the
per-game macro code you forbade in modes" survived round 3 unanswered in
substance. The kitchen-sink maintainability attack was answered on paper,
not by the bench.

**Bench story.** The composed prototype works (farm 10/10 in the clean run,
9/10 in the first replica) but paid for its surface area everywhere it was
measured: the most calls among authored-data approaches, high idle on mine
(0.38), no toy2 success.

**Open risks.** Two sources of truth at revision time; the most repair
churn; and its advantage (layer reuse) is an argument the judge must weigh
against measured cost.

### llm-bt — LLM-authored behavior trees (non-finalist reference)

**Strongest case.** BT-as-data with a fixed interpreter: the only artifact
that is simultaneously model-written, statically checkable, replayable, and
diffable — LLM-BT's 85%/75% adaptive-repair numbers
([arXiv:2404.05134](https://arxiv.org/html/2404.05134v1)), PORTAL's
thousands-of-FPS-games generalization
([arXiv:2503.13356](https://arxiv.org/abs/2503.13356)), and mature BT
substrates ([behaviortree.dev](https://www.behaviortree.dev/docs/intro)).
Bench farm: 10/10 at exactly 1 call.

**Strongest surviving attacks.** Those flagship numbers lean on
human-in-the-loop repair (fsm verified this by fetching the papers). The
bench's mine result (1/10) and toy2 (0/3) show the model's one-shot trees
failing exactly where reactivity or novel composition is needed. Trees pin
instances (coordinates, timings) where curves or predicates pin tendencies —
the staleness attack from llm survived.

**Why not a finalist.** It converged to modes' shape with a heavier artifact,
its repair loop is the same one-shot authoring weakness, and its distinct
value (static auditability) is a dimension the judge can price from the
reference row.

### handcoded — hand-written state machines (non-finalist reference)

**Strongest case.** Deterministic, tick-rate, zero model calls, shipped
precedent from Halo 3's objectives-over-BTs layering
([GDC08 notes](https://aarmstrong.org/journal/2008/03/02/gdc08-notes-building-a-better-battle-halo-3-ai-objectives))
and BehaviorTree.CPP-grade tooling. Bench: 10/10 farm and 8/10 mine at 0
calls — the performance ceiling every other row is measured against.

**Strongest surviving attacks.** The extensibility bill is the whole
argument: 49 new lines for a *toy* second game, zero transfer, and the
repo's design principle ("guide, don't script") rejects it as the primary
loop — the advocate's own fallback concedes the LLM loop stays for
everything outside the pack. Coverage is bounded by what the author
imagined.

### rl and model-level agents — argued, not benched

Two advocates argued architectures that the bench could not measure as
finalists: **rl** (trained policies as versioned artifacts behind one
`body_skill` tool; DreamerV3's 1-A100/9-day and VPT's 720-GPU costs priced
the extensibility problem honestly; the advocate conceded zero day-one
skills on a new game) and **model** (GameScaling-class policies behind a
`body_policy` seam — 0.13-0.69s/step vs 4.0-23.7s/step for frontier-LLM
agents, [arXiv:2610.28698](https://arxiv.org/html/2610.28698); SIMA's
pixels-in/actions-out generality,
[arXiv:2404.10179](https://arxiv.org/abs/2404.10179)). Their transcripts and
rounds are complete; the bench's stub rule (no shippable policy exists to
call) is why they have no metric rows — the honest report is their evidence
and their own conceded risks (availability, uninspectable acting, GPU side
runtimes).

---

## Cross-cutting findings

1. **The reflex gap is real and measurable.** Every architecture that leaves
   the model as the only decision-maker pays idle-while-thinking on the farm
   (llm 0.36, hybrid 0.35 — hybrid's revisions reintroduce it) and pays in
   deaths on the mine (llm's failed runs). Every fixed executor (modes, goap,
   skills, handcoded, llm-bt) shows idle 0.00.
2. **One-shot authoring is the shared weakness of the authored-data family.**
   modes, llm-bt, skills and hybrid all failed toy2 authoring within their
   repair budgets on this model, while the interactive loop (llm) and the
   planner (goap) succeeded. This is one model (deepseek-flash, temperature
   0) and one novel game — but it is the extensibility criterion made
   empirical.
3. **Amortization works when authoring succeeds.** The skills library and the
   goap domain both turn per-game work into data; their steady-state rows
   (0-1 calls) are the cheapest in the table. The difference is who composes
   novel dependencies: the planner's search did; the one-shot authors didn't.
4. **Reactivity without tactics is not enough.** The mine punished authored
   reflexes whose tactics were wrong (modes 2/10) and rewarded either search
   (goap 90%) or a model that keeps reacting in the loop (llm 70%) or a
   well-authored skill (skills 80%).
5. **Latency numbers favor executors, but the farm is the friendly regime.**
   The fsm advocate's round-3 concession cuts both ways: the farm blunts
   latency arguments; the mine doesn't. The judge should weight scenarios by
   how hostile the target game is.

## Open risks and validity threats

- **Single small model.** All runs used deepseek-flash (temperature 0). A
  stronger authoring model could flip the toy2 authoring failures; a slower
  model would worsen every llm-call latency. GLM itself was not callable in
  this environment.
- **Toy scenarios.** Two small worlds and a toy second game. Real Stardew
  (menus, economy, multi-location errands, balance patches) stresses
  authoring and planning far more; the mine's monsters are simple chasers.
- **Prototype fidelity.** Each prototype is minimal by design; the baseline
  reuses the product's tools verbatim, but its loop is a bench approximation
  of a DSH turn. The hybrid prototype composes the debate's own parts rather
  than an independently engineered system.
- **Cost accounting.** skills/hybrid rows show steady-state retrieval; the
  authoring costs are recorded in the prime runs and `results/skills/`, and
  the report marks them. loc counts exclude the shared harness (common to
  all approaches) — derivations in `bench/lib/loc.ts`.
- **Run-to-run variance.** Two complete 140-run replicas exist (an orphaned
  first matrix overlapped the recorded one; both logs are in the bench
  directory). The table shows the clean single-process rerun
  (`bench/matrix-clean.log`); the mine's model-in-the-loop rows moved within
  the bands footnoted in the table, and every fixed-executor row was
  identical. Ten seeds per cell is enough to see the bands, not to resolve
  them.

## For the judge

The criteria and the five finalists are in
[transcripts/finalists.md](transcripts/finalists.md); the raw records behind
every number are in `results/`. The bench's one-command rerun is documented
in [bench/README.md](bench/README.md). No winner is picked here.
