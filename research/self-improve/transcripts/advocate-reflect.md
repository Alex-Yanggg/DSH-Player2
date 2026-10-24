# Advocate (a): reflect — the stuck detector + reflect-and-search loop

Advocate: reflect (option a). Date: 2026-10-24. Sources I fetched myself are in
[sources-reflect.json](sources-reflect.json); notes-* citations are reused as
permitted by the brief.

## Claim

The companion's growth loop should be owned by a **stuck detector + reflect-and-search
step that writes durable lessons** — Reflexion/ExpeL style — with web search reserved
for world facts the model cannot observe. This is the only option that directly fixes
all three knowledge failures observed in P2-0019 (days lost to the spring-5 landslide;
the same wall hit repeatedly without stepping back; no behavior change after failure)
with the least machinery: one pre-step listener, one new tool, one file per save, one
budgeted search. It is also the right *first* build regardless of what comes later,
because the lesson file it writes is the substrate every other option consumes: the
library (b) is a persistence layout for lessons nothing would write without this loop;
the curriculum (c) needs failure-driven practice targets this loop identifies; even
action-rate work (d) needs to know *what* is worth batching. The evidence base is
consistent across five independent research lines: blind retries recover nothing
(Reflexion's own ablation); distilled lessons beat raw experience; the game's own
outcome — never the model's narrative — is the verifier; and a training-free loop that
distills "reusable causal relationships between actions, conditions, and consequences"
into a persistent memory is the current definition of agent RSI (RSIAgent).

## Mechanism

The design goal: the smallest loop that converts *repeated failure* into *changed
behavior*, and missing *world knowledge* into a *cached, sourced lesson*. Six parts.

### 1. What counts as "stuck": task-outcome signatures

The plugin already sees every body-task result (`body_walk_to`, `body_controls/input`,
`world_find`, ...) as a structured outcome — success, or a failure kind (blocked,
interrupted, invalid). The detector does not interpret the world; it hashes a **coarse
signature per failing task**:

> signature = (task kind, first input action — first press or first hold — plus the
> movement target for walk/arrive tasks)

This is exactly the signature the bench reflect prototype uses ("consecutive failing
body tasks with the same first-press/first-hold signature", [bench/README.md](../bench/README.md)),
and it is deliberately dumb. **Stuck** is declared when either:

- **Signature trigger:** K consecutive failures share one signature (K=3 initially,
  plugin config), or
- **Progress backstop:** no delegated-goal progress (no newly completed subtask, no
  new area reached) within one full game-day window.

Both constants are config numbers, not game facts (see Extensibility). The
justification for this one piece of fixed logic, per the repo's "intelligent software"
rule: the model *cannot* reliably notice its own repetition, because each turn's
context is bounded and cosmetic variation makes attempt #4 look novel from inside
(turn markers on `agent/pre-step` exist in the product for the same stated reason).
The listener sees across turns what no single model turn can.

### 2. What triggers reflection

The plugin's `agent/pre-step` listener — the same listener that already writes turn
markers — checks the outcome ledger at each step admission. When a stuck condition
trips it injects a **reflection directive** into the next prompt: a model-visible
message, the same attach-context shape `dsh-hook-protocol` gives hooks and the same
mechanism as the existing turn markers. It does not take the loop away from the model;
it interrupts the retry reflex and demands one bounded reflection step before the next
body action. The directive carries the ledger excerpt (the last N failing signatures
and their outcomes) so the model reflects on evidence, not memory.

### 3. What the reflection prompt asks

Five moves, in a fixed order, in game-free prose:

1. **State the pattern.** What was attempted, what was expected, what was observed
   each time (from the attached ledger excerpt).
2. **Separate the knowable from the unknowable.** What assumption may be false; what
   could you *not* know from observation alone (closures, schedules, immunities,
   routines — the model names the category, never a canned answer).
3. **Search, if and only if (2) is non-empty** and the missing item is world
   knowledge: one batched `web_search` call (see cost bounds below).
4. **Write the lesson** with `lesson_write` (below), citing evidence — the failing
   signatures and outcomes — and, for searched facts, the source URL.
5. **Name the next approach and how it is measurably different.** "Swing again" is
   rejected by the prompt; "the shrine lever west of the bridge" is an answer.

Move 5 is enforced socially, not by code: the directive says the next body task must
differ in kind or target from the failing signature, and the listener will re-trigger
if it does not.

### 4. Where lessons live

**Plugin files in the plugin's own data directory, one per save**, following the
memory-ledger pattern the plugin already ships (`remember`/`dream_commit` write a
durable, player-inspectable ledger today — BRIEF.md, "What Player2 is today"). Entry
format — typed, not free-form reflection dumps (why: ExpeL measured that raw
reflections fed as insights *hurt*, 29.0 vs 39.0 on HotpotQA; CLIN measured that
causal templates beat free-form advice by 6.2 points):

```json
{
  "claim": "the mountain pass stays closed until the morning of day 5",
  "form": "world-fact | causal (X NECESSARY to Y | X DOES NOT ACHIEVE Y)",
  "evidence": ["walk_to(pass) blocked x3, game-time recorded"],
  "source": "observed | https://...wiki/... (via web_search 2026-10-24)",
  "confidence": { "state": "hypothesis|held", "up": 1, "down": 0 },
  "created": "...", "lastConfirmed": "..."
}
```

The causal `form` is CLIN's memory shape ("X is NECESSARY to Y", "X DOES NOT
CONTRIBUTE to Y", with uncertainty markers — [CLIN project page](https://allenai.github.io/clin/));
the up/down counters with zero-count eviction are ExpeL's insight operators
([notes-classics.md](notes-classics.md)). The schema itself is my design — labeled as
such. Plain JSON/Markdown: human-readable, diffable, resettable — the
determinism/debuggability product rule is satisfied by construction.

### 5. How lessons get back into the prompt

Two paths, both verified seams:

- **Passive (default):** the plugin's persona prompt section — the plugin already owns
  persona sections — renders the current lesson list, with `dsh-persona` resolving the
  template variable at render time so the content is the live file. Bounded: top-M
  entries by confidence and recency, token-capped. Reflexion kept only "1-3"
  reflections in context; ExpeL's insight list "currently fits in context" and its
  authors flag retrieval-over-insights as future work for "truly lifelong agents" —
  the bounded list is the honest v1 of that.
- **Active:** a `lesson_read` tool for explicit recall when planning an unfamiliar
  subtask.

### 6. When web search fires, and how its cost is bounded

[dsh-facts.md](../dsh-facts.md) is blunt: DeepSeek exposes no dedicated search
endpoint, so **one search costs a full model turn** in latency and tokens. The design
treats search as a budgeted event, never a reflex:

- **Fires only inside a triggered reflection** — never per action, never on a timer.
- **One search turn per reflection**, batched: `web_search` is multi-query (up to 4
  queries / 8 sources by default per dsh-facts), so one turn answers several
  questions.
- **Hard cap:** at most S searches per game-day per save (S=2 initially, config). The
  listener enforces the cap by declining to inject the search directive and recording
  the refusal in the log.
- **Every result becomes a lesson immediately** — a fact is paid for once per save,
  *ever*, not per session. dsh-facts itself prescribes this: "search sparingly, cache
  results in plugin files."
- **Prefer `web_fetch` over new searches**: fetching a known URL uses the plain-HTTP
  fetch provider, which needs no credential (dsh-facts), and it costs no additional
  search-provider model turn.
- **The latency lands where it hurts least.** During a stuck episode the body is
  blocked; the counterfactual use of that turn is another futile retry. The observed
  alternative price was paid in P2-0019: in-game days lost to a closure one bounded
  search turn (searchTimeoutMs 60000 per the acp profile) would have answered.

### The loop end to end on the two real failures

- **Spring-5 landslide (locked-closure class).** Body walks into the closure, fails;
  signature `(walk_to, mine-entrance)` fails 3x → directive → move 2: the model names
  "closed? until when?" as unknowable → one search turn → lesson (world-fact, source
  URL, hypothesis) → next approach: work elsewhere until day 5, then verify → the
  pass opens → lesson promoted to `held`. Total search cost: 1 turn; total novelty:
  zero new game facts in code.
- **Repeated wall (wrong-approach class).** Same signature trip; move 2 finds nothing
  unknowable — the approach itself is wrong → no search spent → lesson (causal:
  "attacking the golem DOES NOT ACHIEVE crossing the bridge") → different approach.
  This is Reflexion's core result applied: without the written lesson, retries stay
  at baseline (0.60 vs 0.68 on its hardest programming subset — full text cited
  below); with it, behavior changes.

### Bench mapping

The bench reflect prototype is this loop at toy scale: the same signature detector,
reflect-and-search on a simulated deterministic offline wiki corpus, lessons saved
in-run ([bench/README.md](../bench/README.md)). I do not quote its numbers — the
matrix is measured elsewhere; the relevant claim is architectural identity: what the
bench prototypes is what the plugin would run, minus the real `ctx.web` provider
swapped for the corpus.

## How it fits the DSH seams

Only verified seams from [dsh-facts.md](../dsh-facts.md); all are already mounted in
the `acp` profile Player2 boots:

| Seam | What lives there |
| --- | --- |
| `agent/pre-step` listener (`dsh-agent-loop` pre-step admission; the plugin already uses it for turn markers) | The stuck detector, the outcome ledger check, reflection-directive injection, search-budget enforcement. The one place that sees outcomes across turns. |
| `defineTool` tools (the plugin already defines body tools and `remember`) | New `lesson_write` (and `lesson_read`); the write path reuses the `remember`/`dream_commit` ledger pattern. |
| Own files (plugin data dir) | The per-save lesson store, the search cache, the outcome ledger. Nothing game-specific is shipped in the package; everything here is runtime-written and resettable. |
| `ctx.web` (`dsh-web` WebRuntime + `dsh-tool-web`'s `web_search`/`web_fetch` + `dsh-web-search-deepseek` on `DEEPSEEK_API_KEY` + `dsh-web-fetch-http`) | The world-knowledge seam. Both verified routes work: the model-facing tools (already mounted in acp) or `ctx.web.search()` called from the plugin's own tool code. The provider's full-model-turn cost is the reason for the budget in Mechanism §6. |
| Goals (`dsh-goal`, mounted with the round driver; 256-round cap; blocked goals keep a stable policy code + explanation) | The delegated goal stays the loop's master — reflection is triggered by *goal-blocking* outcomes, and blocked-goal policy codes are a second, DSH-native stuck signal the detector consumes. The round cap bounds the whole loop. |
| Prompt sections (persona rows whose `{{…}}` variables resolve at render time, `dsh-persona`) | The bounded lesson list, rendered fresh each step from the lesson file. |

**Deliberately not used (discipline, not inability):** `ctx.sessionQuery` (needs an
FTS-enabling profile patch; the lesson list is small and prompt-loaded — retrieval
*over* lessons is ExpeL's own flagged future work, not a v1 need), `ctx.spillStore`,
PTC, the skill catalog. Every seam option (a) needs exists today, unmodified. That is
the "least machinery" claim made concrete: no new profile rows beyond what `acp`
already mounts, one listener, two tools, one file format.

## Permission boundary, latency, debuggability

- **Permission boundary:** reflection and search are internal cognition plus read-only
  web. They introduce **zero new game permissions** — the loop acts only within the
  already-granted delegation, and it is failure-driven on the player's task, not
  self-task-generating (that is the structural difference from exploration-first
  curricula). It cannot become unattended farming because it cannot generate work:
  it can only change how an approved goal is pursued. The stop condition is the
  delegated goal, unchanged, bounded by the goal round cap.
- **Network requests (documented per the product rule):** only the DSH web seam, only
  on triggered reflections, capped per game-day, through the existing
  `dsh-web-search-deepseek` provider on the existing `DEEPSEEK_API_KEY`. Results are
  cached into local lesson files; player data and lessons stay local.
- **Debuggability:** every stuck trip, injected directive, search, and lesson write is
  a log line keyed by the triggering signature; every lesson carries its evidence and
  source; the store is a human-readable file a player can read and reset. A
  misbehaving companion is explainable from logs alone.

## Best evidence

**The loop works exactly where P2-0019 failed — on repeated failure.**

- Reflexion (NeurIPS 2023): agents "verbally reflect on task feedback signals, then
  maintain their own reflective text in an episodic memory buffer ... to induce better
  decision-making in subsequent trials" ([arXiv abs](https://arxiv.org/abs/2303.11366),
  fetched). The decisive ablation for us: on the 50 hardest Rust HumanEval problems,
  blind retry-without-reflection stays at 0.60 vs 0.68 with reflection — "blind trial
  and error debugging techniques without self-reflection are ineffective"
  ([ar5iv full text](https://ar5iv.labs.arxiv.org/html/2303.11366), via
  [notes-classics.md](notes-classics.md)). That is the P2-0019 wall, measured.
- ExpeL (AAAI-24): the agent "autonomously gathers experiences and extracts knowledge
  using natural language" and "at inference ... recalls its extracted insights and
  past experiences to make informed decisions" ([arXiv abs](https://arxiv.org/abs/2308.10144),
  fetched). ALFWorld 59.0±0.3 vs ReAct 40.0±0.3, beating Reflexion's retry loop while
  spending a single attempt — the insight list is the asset, the retry loop is only
  the tuition ([ar5iv full text](https://ar5iv.labs.arxiv.org/html/2308.10144), via
  notes-classics).
- CLIN (COLM 2024, AI2): a frozen model with "a persistent, dynamic, textual memory,
  centered on causal abstractions" outperforms Reflexion by "23 absolute points" on
  ScienceWorld and transfers zero-shot to new environments/tasks (+4/+13), with
  continued memory updates adding +17/+7 ([project page](https://allenai.github.io/clin/),
  fetched; [arXiv abs](https://arxiv.org/abs/2310.10134) via notes-classics). The
  lesson, not the retry, is what transfers.

**The lesson unit and the verifier are settled science.**

- RSIAgent (arXiv 2609.15364): training-free RSI where the persistent memory holds
  "reusable causal relationships between actions, conditions, and consequences", the
  memory "is frozen and can be directly reused for downstream tasks without updating
  model parameters" ([arXiv abs](https://arxiv.org/abs/2609.15364), fetched), and the
  verifier is deliberately isolated from the actor, grounded only in environment
  feedback, returning PASS/FAIL ([full text](https://arxiv.org/html/2609.15364v2), via
  [notes-rsi.md](notes-rsi.md)). On game tasks (GameCraft-Bench, GLM-5.3-Flash
  generator) the full RSI loop scores 48.72 vs 44.73 without it (notes-rsi, Table
  caveats included there). This is option (a)'s exact shape — detect, distill, verify
  against the environment, reuse.
- Lessons must be distilled and typed, not dumped: raw reflections fed as insights
  *hurt* ExpeL (29.0 vs 39.0 on HotpotQA); causal templates beat free-form advice by
  6.2 in CLIN's ablation (both via
  [notes-classics.md](notes-classics.md), full texts at
  [ar5iv 2308.10144](https://ar5iv.labs.arxiv.org/html/2308.10144) /
  [ar5iv 2310.10134](https://ar5iv.labs.arxiv.org/html/2310.10134)). Mechanism §4 is
  built to that measurement.
- Only outcome-confirmed entries get promoted: AWM grows workflows online only from
  evaluator-judged successful trajectories ([arXiv abs](https://arxiv.org/abs/2409.07429),
  full text [arXiv HTML](https://arxiv.org/html/2409.07429v1), via notes-classics);
  Reflexion's only measured regression came from false-positive evaluation (16.3% FP
  on MBPP) — prefer false negatives, because reflection can catch a suspicious failure
  but nothing catches a lesson that was never questioned. RSIAgent's memory
  reconciliation (revise contradictions, qualify unsupported claims) is the same
  discipline at library scale (notes-rsi).

**Budgeted reflection is a solved problem, not a novelty.**

- Generative Agents trigger reflection only when summed event importance crosses a
  threshold (150), yielding 2-3 reflections per agent-day
  ([ar5iv full text](https://ar5iv.labs.arxiv.org/html/2304.03442), via
  notes-classics) — a cheap scalar trigger with a bounded per-day cost, which is what
  my progress backstop imitates.
- Voyager parks a task after 4 stuck rounds and moves on, retrying later
  ([arXiv abs](https://arxiv.org/abs/2305.16291); [project page](https://voyager.minedojo.org),
  fetched) — proof that a blunt counter suffices to interrupt grinding; removing its
  self-verification cost it −73% on discovered items (via notes-classics), i.e. the
  check-before-commit step is where the value concentrates.

**The web seam exists and the price is known.** `ctx.web` + `web_search`/`web_fetch`
mounted in `acp`, DeepSeek provider on `DEEPSEEK_API_KEY`, one search = one full model
turn, http fetch credential-free ([dsh-facts.md](../dsh-facts.md), verified against
the installed 0.2.0-rc.2 packages with file paths). The design's budgets are derived
from that price, not guessed.

## Extensibility across games

The judge's weighted criterion, addressed head-on. **Four of the loop's five moving
parts contain no game content by construction:**

1. **Stuck detection is game-agnostic.** It consumes only BodyPort task outcomes and
   the inputs of failed tasks — the controller vocabulary (press/hold/target) every
   game adapter already emits, because the mod is a pure adapter (BRIEF.md). No game
   name, no game vocabulary, no thresholds derived from game rules. The bench's
   round-2 scenarios already run the same detector on a second toy game with a
   different input vocabulary (Keycraft, same port shape) — the design premise is
   that outcome signatures port with the port.
2. **The reflection prompt is game-free prose** ("what kept failing; what can't you
   know; search; write a lesson; try differently"). It ships once, for every game.
3. **World knowledge is fetched at runtime, not coded.** The wiki is whatever
   `ctx.web` finds for this game at play time. The bench's offline corpus is scenario
   fixture data — "the corpus is scenario fixture data like the map rows"
   ([bench/README.md](../bench/README.md)) — standing in for the network in a
   deterministic offline test, exactly as map rows stand in for a real game world. It
   is not a shipped knowledge table, and the product has no counterpart for it: the
   shipped plugin contains no game facts at all.
4. **The lesson schema has no game fields.** World-fact and causal entries are
   game-neutral; RSIAgent's memory is explicitly free-form with "no required schema,
   file count, or length" (notes-rsi) — the field has converged on schemaless,
   runtime-authored knowledge stores.

**What needs per-game input, and why it is not a "hardcoded game fact":**

- The adapter — game-specific *by design*, it is the mod — declares a game id and a
  save id; the plugin uses them to key lesson files and to form search queries (a
  search for a closure policy needs the game's name in the query). A game-name string
  is identity metadata the adapter already owns, not knowledge about the game. The
  owner's ruling bans game *content* in code — facts like "the mine opens spring 5",
  per-game rule tables. A label and two budget constants (K, S) are configuration.
- Signature normalization may want adapter tuning if a game's input space makes
  genuinely different attempts collide (over-triggering, cost: one bounded turn) or
  identical walls look maximally different (under-triggering, cost: covered by the
  game-agnostic progress backstop). This is input-vocabulary plumbing, the same
  category as the adapter itself, not a knowledge table.
- Speculation, labeled: search quality depends on the game having public written
  knowledge. For wiki-less games the loop degrades to observation-only lessons — which
  still fixes the wall class (the golem lesson needs no wiki), just not the closure
  class. Honest cost, and it is a property of the world, not of the code.

**Transfer evidence that the loop's product generalizes:** ExpeL's insights transferred
across domains (HotpotQA → FEVER: 70 vs ReAct's 63, via notes-classics); CLIN's
meta-memory transferred zero-shot to unseen environments/tasks (+4/+13,
[project page](https://allenai.github.io/clin/)); Voyager's library transferred to
fresh worlds of the *same* game ([project page](https://voyager.minedojo.org), fetched
— note it claims cross-world, not cross-game, transfer; I do not claim more than it
does). The honest summary: the *mechanism* is game-agnostic with high confidence; the
*amortization* is strongest within a game, which is precisely where one DSH session
per save lives.

## Anticipated attacks and your answers

**1. "Reflection without a library forgets everything next session — this cannot
produce cross-session growth."**

False dichotomy — my mechanism includes the durable store. Lessons are plugin files
keyed by save id, written at reflection time; the persona prompt section loads them
every session (Mechanism §4-5). Reflexion discarded reflections between tasks in 2023;
every successor that studies cross-task growth — ExpeL's insight list, CLIN's
persistent memory, AWM's workflows — keeps the *same* write loop and simply persists
the store, because persistence here is file I/O, not architecture
([arXiv 2308.10144](https://arxiv.org/abs/2308.10144),
[allenai.github.io/clin](https://allenai.github.io/clin/),
[arXiv 2409.07429](https://arxiv.org/abs/2409.07429)). What option (a) defers is
option (b)'s *specific* problems — cross-save identity, transparent persona-level
loading — deliberately: a library with no writer is an empty shell. And the observed
failures that motivated this round all happened *within one session*; the first build
must own the write path. The bench agrees with the split: reflect saves lessons
in-run; library is the storage layout of the same artifact
([bench/README.md](../bench/README.md)). Build the writer first; the reader is a
prompt section away.

**2. "Web search costs a full model turn per query — latency."**

Yes — dsh-facts says exactly that, and the design is built around the price, not
around pretending it away: trigger-gated (only inside a stuck reflection), one batched
search per reflection (`web_search` takes up to 4 queries / 8 sources in one call),
capped at S per game-day, results cached into lessons so each fact is paid **once per
save, ever** (dsh-facts' own prescription: "search sparingly, cache results in plugin
files"). Now the counterfactual. The search turn does not displace an acting turn —
during a stuck episode the body is blocked, and the alternative use of the turn is
another futile retry. Round-1's baseline shows what the alternative regime looks like:
the pure-LLM mine runs spent ~6 calls each and still failed most seeds (7/10 at 6.1
calls, per [BRIEF.md](../BRIEF.md)'s round-1 summary) — several cheap turns that knew
nothing beat one informed turn only in the sense that a flood beats a bridge. P2-0019
paid for the missing fact in in-game days. One bounded search turn (searchTimeoutMs
60000) against days of grinding is the cheap side of the trade. Finally: the cost is
amortized by design — the second companion that ever faces that closure pays zero,
because the lesson already exists.

**3. "The model can reflect itself into wrong lessons (verifier problem) — who checks
lessons?"**

The game checks — never the model alone, and never the model's narrative. Three
layers. (i) *Grounding*: every lesson carries structured evidence — the task
signatures and outcomes the BodyPort reported — not the model's summary; RSIAgent's
core design rule is a verifier "deliberately isolated from the actor's private
reasoning", grounded only in environment feedback, returning PASS/FAIL
([notes-rsi.md](notes-rsi.md), [arXiv 2609.15364](https://arxiv.org/abs/2609.15364)).
This matches the repo's own engineering rule that a missing or invalid native result
surfaces as failure rather than a plausible local fallback. (ii) *Promotion*: a
searched world-fact is written as `hypothesis` and becomes `held` only when a later
outcome confirms it — if the wiki says the pass opens day 5 and day 5 arrives with the
pass closed, the next failure downvotes the entry; ExpeL's counters evict at zero
([ar5iv 2308.10144](https://ar5iv.labs.arxiv.org/html/2308.10144)). AWM's success-gate
(only judged-successful trajectories induce memory) and Reflexion's false-positive
regression (16.3% FP on MBPP flaky tests) are the two measurements that fix this
policy: prefer false negatives — a missing lesson costs a search; a wrong lesson that
cannot die poisons everything downstream ([arXiv 2409.07429](https://arxiv.org/abs/2409.07429),
[ar5iv 2303.11366](https://ar5iv.labs.arxiv.org/html/2303.11366)). (iii) *Oversight*:
the store is a local, human-readable, resettable file with sources attached — a player
can audit and wipe it, which is more than most memory designs offer. Residual risk,
stated honestly: a wrong hypothesis can steer one additional failed attempt before
disconfirmation, and RSIAgent itself lists model-verifier error propagation as a
limitation (notes-rsi). One bounded failed attempt, logged, evidence-attached, is the
failure mode — not silent drift.

**4. "Stuck detection on outcome signatures is brittle (cosmetic retries differ,
same-wall retries look identical)."**

The signature is deliberately coarse, and the error asymmetry justifies it. Case one
— cosmetic retries that *differ* but share the first press: that collision is correct
behavior. Repeatedly performing the same interaction that keeps failing is precisely
the pattern to interrupt; timing jitter does not make the fourth identical swing a
new idea. Case two — the same wall reached by *different-looking* tasks — is the real
risk, and three layers cover it: (a) the movement target is in the signature, so
different-input/same-destination attempts still collide; (b) the progress backstop (no
new subtask or area per game-day) catches any grinding the signature misses — the
same shape as Generative Agents' scalar importance threshold, which produced a
healthy 2-3 reflections per agent-day
([ar5iv 2304.03442](https://ar5iv.labs.arxiv.org/html/2304.03442)); (c) Voyager's
blunt 4-round counter is field proof that a dumb trigger suffices to interrupt
grinding ([voyager.minedojo.org](https://voyager.minedojo.org)). Now price the errors:
a false positive costs one bounded reflection turn (and the cap bounds how often);
a false negative costs another stretch of futile retries — and Reflexion measured what
those are worth: nothing (0.60 vs 0.68 without reflection,
[ar5iv 2303.11366](https://ar5iv.labs.arxiv.org/html/2303.11366)). Asymmetric in favor
of over-triggering. Last: the detector does not diagnose — it only interrupts.
Diagnosis is the model's job, which is the repo's "intelligent software" principle
applied correctly: fixed logic where the model structurally cannot see (across turns),
policy everywhere else.

**5. (Pre-empted) "You add model turns to a companion that already acts too
sparsely."**

Steady-state play adds zero turns: a working companion never reflects. The loop is
failure-triggered and budget-capped, so the turn count grows only where behavior is
already broken — exactly where spending a turn on cognition instead of a fourth retry
is the rational trade. And the honest division of labor: option (d) owns turns-per-
action; option (a) owns whether the next action is even the right one. They compose
(reflection output is a natural input to what gets batched), but they are different
axes, and the observed failures — days lost, walls repeated — are knowledge failures,
not throughput failures. Fix the model's ignorance first; then make its correct
actions cheap.

## What this does not fix (preview of round 3)

Stated now, in good faith: (1) **Action rate** — reflection adds turns when triggered;
it does nothing for round-trip latency or actions-per-day; option (d) owns that axis
and this option needs it eventually. (2) **Cross-save transfer** — v1 lessons are
per-save; sharing across saves is option (b)'s identification and privacy problem,
which (a) deliberately does not solve. (3) **Wiki dependence** — the closure class is
fixed only where the world's knowledge is written down somewhere searchable; the wall
class is fixed everywhere. (4) **Weak-model dependence** — Reflexion measured no gain
for a weak model (starchat-beta, 0.26 → 0.26, via notes-classics); the loop's value is
conditional on the model's reflection quality, and DeepSeek's serving is what we have.
(5) **First-failure blindness** — the loop reacts to *repeated* failure by design; the
first failed attempt of any kind is tuition. A proactive layer (option c) could in
principle front-run some of that, at the price this option refuses to pay by default:
unrequested autonomy.

## References

Fetched by me for this statement (full list with dates in
[sources-reflect.json](sources-reflect.json)):

- Reflexion: Language Agents with Verbal Reinforcement Learning —
  https://arxiv.org/abs/2303.11366 (abs page; abstract sentences quoted)
- Reflexion official repository — https://github.com/noahshinn/reflexion (MIT,
  AlfWorld `use_memory` persisting-memory option)
- ExpeL: LLM Agents Are Experiential Learners (AAAI-24) —
  https://arxiv.org/abs/2308.10144 (abs page; AAAI-24 confirmed)
- CLIN project page (Continual Learning from Interactions, AI2) —
  https://allenai.github.io/clin/ (causal-abstraction memory; +23 over Reflexion on
  ScienceWorld; transfer numbers)
- RSIAgent: Autonomous Exploration for Recursive Self-improvement in New
  Environments — https://arxiv.org/abs/2609.15364 (abs page; training-free RSI,
  frozen memory of causal relationships)
- Voyager project page — https://voyager.minedojo.org (curriculum + skill library;
  cross-world transfer claim scope)

Reused from the pre-fetched research notes (permitted by the brief; each was fetched
and verified when the notes were compiled 2026-10-24):

- Reflexion full text — https://ar5iv.labs.arxiv.org/html/2303.11366
- ExpeL full text — https://ar5iv.labs.arxiv.org/html/2308.10144
- CLIN — https://arxiv.org/abs/2310.10134 and
  https://ar5iv.labs.arxiv.org/html/2310.10134
- Agent Workflow Memory — https://arxiv.org/abs/2409.07429 and
  https://arxiv.org/html/2409.07429v1
- Voyager full text — https://ar5iv.labs.arxiv.org/html/2305.16291
- Generative Agents full text — https://ar5iv.labs.arxiv.org/html/2304.03442
- RSIAgent full text — https://arxiv.org/html/2609.15364v2
- HarnessPro (context on harness-level RSI and cost-bounded evolution) —
  https://arxiv.org/abs/2610.26770, https://github.com/pzs19/HarnessPro

Repo-internal verified facts (fetched = read from the working tree / git):

- [BRIEF.md](../BRIEF.md) — P2-0019 observations, round-1 summary, product
  constraints, the plugin's existing seams
- [dsh-facts.md](../dsh-facts.md) — verified DSH 0.2.0-rc.2 seams with package-file
  paths (ctx.web, dsh-tool-web, dsh-web-search-deepseek, acp profile contents,
  dsh-goal, dsh-persona, dsh-agent-loop pre-step)
- [bench/README.md](../bench/README.md) — the reflect prototype's design, signature
  definition, scenario mechanics, wiki-corpus status as fixture data
- [notes-classics.md](notes-classics.md) / [notes-rsi.md](notes-rsi.md) — the
  measured numbers and limitations cited above
