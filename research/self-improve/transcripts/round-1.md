# Round 1 — assembled attacks (all five advocates)

---

# round-1-reflect

# Reflect (a): cross-examination, round 1

## Attacks

### (b) library: no writer for the failure that named this debate

(b) claims the mine failure becomes "permanently fixed after one bad experience, because the lesson is written once and rendered into every later session for free." Event 2, the in-turn write, is discretionary: "the model may record the lesson with a `library_learn` call in the same turn it reacts" — but P2-0019 shows what this model does after a blocked walk: walks again, for days. Nothing in (b) interrupts that reflex; the interrupt is my loop, which (b) concedes is "a *better writer*" whose composition is "the natural end state." Event 1, the day-end distill ("one model call per game day"), lands after the day is lost and can only distill what episodes show: "walk blocked," never "until spring 5" (knowable only from the world or wiki, BRIEF.md). Event 3, the only search path, fires "when a rare `web_search`/`web_fetch` is granted" — granted by whom, when? Undefined: optional writes, a day-late distill, an orphaned search trigger.

(b) prices rivals as options that "re-pay its cost every session (reflect, curriculum)" while calling itself "the cheapest architecture in LLM calls we have ever measured" on round-1's skills rows (mine 8/10 @ 0.1, farm 10/10 @ 0.0) — retrieval with authoring paid separately. Its specified writer costs a call every game day plus a reconcile per session, forever: a standing tax my loop never pays in steady state.

### (d) actionrate: the 5-10x dividend evaporates where learning is needed

(d) promises "every learning loop bought with those attempts gets 5-10x more of them for free." The bench's executor runs steps "in order (stopping on the first failure)" (bench/README.md); a closed pass or immune golem kills every batch at its first failing step, so batch-of-8 degrades toward one useful action per call precisely where this debate lives. (d) says idle-heavy bodies "cannot run the trials that fill any library," yet round 1 shows idle and learnability are orthogonal: the idle-heavy pure-LLM row (farm idle 0.36) is the approach that learned a new game interactively (toy2 3/3 at 30 calls, BRIEF.md), while every 0.00-idle fixed executor learned nothing, ever [reasoning: they cannot, by construction]; P2-0019's days of wall-hits learned nothing, because nothing reflected. (d) admits "the reflex tier's current `reflexes/stardew-valley.json` is shipped per-game data," to be migrated to a "minimal declaration-derived safety set" it only asserts is derivable [reasoning]: until then it ships the product's only hardcoded game table. Its own ledger concedes batching cannot see "plan-level wrongness"; throughput needs my loop to notice it.

### (e) async: the only novel part is the channel, and it is the admitted unknown

(e) calls each rival blocking ("the reflection directive consumes turn time while the body waits") and claims "the split is exempt by construction, not by tuning." (e) is my detector (its §2: same K=3) plus my reflect-and-search (its §7) plus (b)'s store plus (d)'s executor: the bench's `combo` row in motion. Combo's missing part is the async channel, which (e) itself calls unknown: escalation is "delivered at the next turn admission," but "the goal round driver's continuation trigger timing is not documented" and delivery latency is "an open spike item." On the wall scenario both detect at K=3 and deliver at the same next turn admission; mine reflects in that prompt, while (e) freezes the tail, safe-holds ("take no new semantic action"), deliberates (possibly one full-model-turn search), rules, and adopts the repair "at the next step boundary." Strictly more stages on `recovery_ticks_mean`, while the body does what mine's does during reflection: nothing. "Safe-hold" is idle with better press. Day one: with no plan yet, the small brain "never invents approach steps," so every fresh session opens with the body waiting on the model. "No other option keeps the body busy while learning happens" holds only mid-plan.

## Answering the predictable

**1. "Three failures and several lost days are the *entry price* of knowledge" (c), with its Reflexion-WebShop ceiling for loops that "wait for failure to teach it."** The tuition is three bounded attempts plus one same-day directive; rivals pay the same or more. (b)'s writer fires in-turn or at day-end, so the spring-5 fact enters its store no earlier than my directive produces it. (c) front-loads a survey budget on every unlearned save, paid even where the world documents nothing, and its termination signals (model-declared, budget, no-new-findings) cannot certify coverage without coding game knowledge: a survey ending "done" without the fact marks the save learned forever: a *confident* grinder, worse than a doubting one. The WebShop ceiling concerns exploration-diverse tasks; my game-day backstop caps exposure and catches grinding the K=3 signature misses.

**2. "Reflections multiply round-trips and make latency worse before smarter" (d), echoed by (e).** Steady state adds zero turns: failure-triggered, capped per game-day; a working companion never reflects. When triggered, the body is already blocked and the displaced turn is a fourth futile retry, priced at nothing by Reflexion's own ablation (0.60 without vs 0.68 with) and by round-1's pure-LLM mine rows failing 3/10 seeds at ~6 calls each (BRIEF.md). (d) concedes batching cannot see plan-level wrongness, so it needs this loop; (e) routes the same evidence through more stages to the same turn admission. One bounded turn that changes the next action is the cheapest move on the board; P2-0019 paid days for skipping it.

---

# round-1-library

# Cross-examination, round 1 — advocate (b): the library

Sources: the openings, `dsh-facts.md`, `bench/README.md`, the cited prototypes,
the round-1 REPORT, the notes files; no bench run; inferences labeled.

## Attacks

### 1. Reflect (a): lessons die with the run

(a) answers the forgetting attack: lessons are "plugin files … one per save";
persistence is "file I/O, not architecture … Build the writer first; the reader
is a prompt section away" (advocate-reflect.md, Anticipated 1).

Its own bench prototype never writes a file: `approach-reflect.ts` keeps lessons
in a per-run in-memory array (`const lessons: string[] = []`), its header
conceding verbatim: "here in-memory per run — cross-run persistence is option
(b)'s claim." The reflect row relearns the same spring-5 fact in every seed,
while the library row's seeds "ARE successive sessions on one save"
(`library-cold` the control — bench/README.md). BRIEF.md: "Nobody addressed
growth across sessions — that is this round"; (a) defers exactly that. Nor is it
"a prompt section away": the load path (save identity, transparent loading,
staleness/correction) is my whole Mechanism. (a)'s own answer cites ExpeL, CLIN,
AWM as what "keeps the *same* write loop and simply persists the store." A
writer without a store is Reflexion 2023: effort paid per session, gone by the
next.

### 2. Curriculum (c): the field guide is a per-run library

(c) claims the survey is "bounded and front-loaded: one budgeted survey per save,
then amortized for the life of the save," and "the producer is the architecture,
the store is its artifact" (advocate-curriculum.md).

The prototype stores the guide in RAM: `approach-curriculum.ts` declares
`const guide: { topic; note }[] = []` per run, injected into a WORK prompt
rebuilt each run. Its bench row re-surveys from zero every seed, re-paying the
8-turn budget — the claimed amortization is unmeasured by its own row. Where (c)
does claim survival — "the guide persists in the plugin's own files keyed by
save id … in the same per-save directory shape the ledger already uses" — that
is my layer-2 store adopted wholesale. Even Voyager's cross-world headline — "a
plug-and-play asset" (notes-classics.md) — is the library, not the curriculum,
carrying.

### 3. Async (e): the big brain's lessons have nowhere to land

(e) claims "a confirmed lesson … is written through the existing
`remember`/`dream_commit` ledger path" and concedes "the persona library is the
agreed *storage* design (owner-amended …); my protocol contributes the *write
trigger* … and the *read path*" (advocate-async.md §7).

Three cuts. (i) The ledger is an episodes-and-moods store, not a lesson store
(my opening §6, `mind/ledger.ts`); ExpeL measured raw reflections fed as
insights *hurting* — 29.0 vs 39.0 on HotpotQA (notes-classics.md) — so
escalation learnings filed as episodes are sediment. (ii) The prototype has no
lesson tool: the big brain has only observe/map/search/fetch/submit_plan
(`approach-async.ts`), its message board is `newShared()` per run — its matrix
rows measure a memoryless big brain, every session from zero. Its search ration
("deduped against a cached-query file") without a persistent fact store means a
later session either re-pays the search or — labeled reasoning — is deduped
against a query whose answer it cannot recall. RSIAgent, (e)'s own evidence,
grew a 316,541-byte memory and froze it for reuse (notes-rsi.md): memory is
load-bearing in RSI, not transport. (iii) The small brain is pure code replaying
plans. Day 1 of a new save with an empty library: the plan comes from a big
brain with no lessons, no skills, no cache — the P2-0019 baseline by (e)'s own
construction. What is uniquely (e)'s — async clocks — is transport; the growth
loop lands in my design or nowhere.

## Answering the predictable

**Expected attack 1 (from (a)'s Claim, echoed by (e) §9): "a library with no
writer is an empty shell — (b) has no stuck detector and no search, so who fills
it?"** A verified `blocked` outcome is visible without detection machinery; the
model records the lesson in the reacting turn — one call inside a turn it was
already taking. The day-end distill is one call per game day, budgeted like
Generative Agents' threshold-150 reflection, 2–3 per agent-day
(notes-classics.md). Measured economics: round-1 skills paid 1–3 authoring calls
once, then retrieved at mine 8/10 @ 0.1 calls, farm 10/10 @ 0.0 (round-1
REPORT). I concede (a)'s loop is a better writer; composition is the end state.
But the writer is the cheap half — the load-bearing half is the store with
identity, loading, staleness, and correction, which (a)'s own prototype defers.

**Expected attack 2 (from (c)'s Anticipated 5): "(b) is a store with no
producer — it learns reactively; CLIN's art-studio bottleneck: 'if the agent
never reaches the relevant area … it never forms the needed memory and keeps
failing'; and your own concession, 'an empty library plus a passive loop grows
slowly.'"** Yes — stated plainly in my opening. The knowledge this round exists
for sits on the goal's path: P2-0019's companion was walked to the mine by the
delegated goal, so the reactive write fires at first contact and the fact is
permanently fixed after one bad experience; CLIN's bottleneck concerns knowledge
the goal never touches. Beyond the goal's path the survey is the right
accelerant — and it writes into my schema: (c)'s persistence section is per-save
files keyed by save id with confidence tiers, i.e., my layer 2. The
producer/store split is a division of labor inside my three layers, not a rival
architecture.

---

# round-1-curriculum

# Curriculum (c): cross-examination, round 1

Sources: the five openings, BRIEF.md, dsh-facts.md, bench/README.md,
`bench/lib/approach-async.ts`, `bench/matrix-async.log` (in-flight,
unofficial), round-1 cross-exams; no bench runs by me.

## Attacks

### (b) library: a warehouse is not a supply chain

(b) claims retrieval is "the cheapest architecture in LLM calls we have ever
measured in this repo: … mine 8/10 at 0.1 … and farm 10/10 at
0.0" (her opening). Those rows hit ~0 calls only after a
separate authoring run paid discovery — bench/README.md: round 1 "primes the
on-disk skill libraries (one authoring run each)". Storage
is not acquisition: authoring was billed apart, and her mechanism keeps
billing — "one model call per game day" distill plus "one call per session"
reconcile forever, stale lessons costing rewrites under no cap; re-authoring
on drift is unbounded.

Her layers answer where lessons live, not where they come from — her own
Anticipated-1 heading asks "who fills it?". Her main writer, the day-end
distill, fires after the day is lost: P2-0019 lost "days" (BRIEF.md), so the
spring-5 lesson lands days late, distilled from episodes showing "walk
blocked", never "until spring 5" — knowable "only from the world or the wiki"
(bench/README.md). On a fresh save she concedes the sheet "is empty …
behaves exactly like today's product," and "an empty library plus a passive loop grows slowly; option (c)'s survey is
the accelerant". Her
owner-mandated brief — defend "what gets distilled when" — distills whatever
failure already produced. CLIN's bottleneck (her citation) is the verdict: insights "come only from self-experience; if the agent never reaches
the relevant area … it never forms the needed memory and keeps failing"
(notes-classics.md). A store whose only producer is failure
is my survey with the survey deleted.

### (e) async: the big brain has no way to learn the world

(e)'s binding design: the big brain "plans, reflects and web-searches
ASYNCHRONOUSLY and never blocks the body"; the small brain "keeps acting on
the current plan" (BRIEF.md amendment). The plans come from a brain
that must know the world, and (e)'s only learning trigger is escalation on
repeated failure (§2, §7) — reflect's loop on another clock: the world is
learned only after K=3 failures. (e) concedes exploration is
borrowed: "(c)'s exploration is what the big brain plans when a goal is
blocked-but-waitable" (its §7) — with nothing triggering it before the wall.

Its prototype proves it: the async big brain's only knowledge tools are
"observe/web_search/web_fetch" — no lesson tool, no guide — with `newShared()`
state per run (`bench/lib/approach-async.ts`): every session starts knowing
nothing. An in-flight run log in the bench directory
(`bench/matrix-async.log`; unofficial) shows the small brain
executing an ignorant big brain: repeated-failure counts of 5-15 on locked
(nine of ten seeds; one hit 35); 4 of 10 wall seeds failed with the highest
counts (19-20). The body re-walks into the closure because no survey read the
notice board (bench/README.md): throughput multiplies blind grinding; my
survey prevents it. Even trigger timing is admitted: escalation is
"delivered at the next turn admission" while "the goal round driver's
continuation trigger timing is not documented" — "an open spike item" (§4).

### (a) reflect: lessons written after the wall

(a)'s search "fires only inside a triggered reflection — never per action,
never on a timer" (§6): knowledge is strictly
post-wall. On the closure class, (a) pays three blocked walks plus a search
turn (one full model turn,
dsh-facts.md §1), writing the spring-5 fact as a hypothesis inferred from
failure; the survey reads the notice board (bench/README.md) and
copies it at `observed` confidence: zero failures, zero searches, and — by
(a)'s own RSIAgent citation — the better, environment-grounded tier. (a)
concedes the boundary: wiki-less games leave it "observation-only … just not
the closure class" (#3) — yet the closure fact was never wiki-only: it is in
the world. Its own words convict it: "the first failed attempt of any kind is tuition"; "(c) could in
principle front-run some of that" (#5) — tuition P2-0019 paid in lost days.

## Answering the predictable

**Expected attack 1 — "the survey multiplies round-trips on an idle-heavy
body" (d: knowledge options "multiply round-trips on the worst substrate"; e:
"(c) explores but must still act through the same blocking loop").** Survey
legs are ideal PTC work — one model turn programs walk-look-read-record
(dsh-facts.md §3): near one round-trip per leg, not four. Survey
days are dense with done body tasks; unsurveyed days with `blocked` retries — the behavior `repeated_failures_mean` targets (bench/README.md).
Cost is paid once per save: the guide persists in plugin files (dsh-facts.md
§4) and later sessions load it free — "re-pays its cost every session" is
false by (b)'s own persistence logic.
Urgent goals degrade to a route survey of the goal's own path — the locked
scenario's notice board.

**Expected attack 2 — "termination cannot certify coverage; a survey ending
'done' without the fact marks the save learned forever — a confident grinder"
(reflect's round-1 answer).** Nothing marks a save "learned": coverage
is rendered state, not belief; every entry carries `confidence` and `asOf` —
expired facts render as expired hypotheses, missing facts as
`kind: "unknown"`: honest gaps routed to the wiki search or the player. A wrong "done" self-corrects at the first contradicting outcome;
the grinder needs the guide to assert an absence, and absences are data, not
assertions. [Reasoning] The reactive alternative is the
worse grinder: failure-lessons alone stay ignorant of all not yet failed.

---

# round-1-actionrate

# Actionrate (d): cross-examination, round 1

Sources: the five openings, BRIEF.md, dsh-facts.md, bench/README.md, bench
internals (`lib/harness.ts`, `lib/locked.ts`), completed per-seed rows in
`bench/matrix-run.log` / `matrix-async.log` (raw, mid-run; aggregation lands in
the final report). Bench not run; inferences labeled.

## Attacks

### (b) library: "cheapest architecture," refuted by its own event list

(b) bills itself "the cheapest architecture in LLM calls we have ever measured"
while taxing rivals that "re-pay its cost every session".
But its own mechanism re-pays every session (owner-amended design, BRIEF.md):
day-end distill is "One model call per game day"; reconcile is "One call per
session." Its 0.0-0.1-call steady state (mine 8/10 @ 0.1, farm 10/10 @ 0.0)
retrieves authored libraries; authoring was "paid once (1–3 calls)" — the end
state of growth, not what this round prices.

The transparent load is the same story: "trimming is by construction: character
budget on the sheet, per-kind quotas." Trimming matters only because the sheet
grows every session; an evicted lesson sits behind `library_query`, a model call
to recall. "Permanently fixed after one bad experience" holds only while the
lesson fits the sheet.

Finally, the exchange rate (b) ignores: its own headline embeds my mechanism.
Round-1 skills ran farm at 0.0 calls **and 7.2 s vs 44.5 s**, a 6x wall-clock
win from a fixed executor at idle 0.00, not from the library. (b) concedes a
knowing companion "still idles at the round-1 gap ratios," on a substrate at G1
idle ~0.9, G2 p95 ~20 s (BRIEF.md). A fast body that relearns one fact per
session outruns a slow body that relearns perfectly. [reasoning]

### (c) curriculum: the survey is the worst case for action rate

(c) claims the survey is "the exploration that was already happening,
**captured**." The raw rows say *added*: curriculum locked successes ran 16-28
calls vs baseline 13-19; toy2-locked successes 26-32 vs 27-30, both curriculum
failures pinned at the harness cap (45 = maxModelCalls, `lib/harness.ts`)
[raw rows, matrix-run.log]. The baseline explores anyway (round-1 toy2:
pure-LLM 3/3 @ ~30 calls, BRIEF.md); the survey is a premium on exploration the
goal loop already pays. Its concession: "for a five-minute goal on a save the
player will never revisit, survey-first is the wrong size."

"The world documents itself" is (c)'s load-bearing claim, and it is authored,
not discovered: the notice board sits at tile (3,7) while every spawn is
(2,7)/(5,8)/(7,6), 1-4 tiles away, because the scenario author wrote
"discoverable only by exploring (a readable notice board by the start)"
(`lib/locked.ts`; the wiki corpus is "scenario fixture data like the map rows").
The real e2e had no board in reach: P2-0019 "did not know the mine is closed
until spring day 5 and lost days to it" (BRIEF.md). [reasoning] Facts a few
tiles from spawn exist by design; (c) concedes the channel is empty where worlds
"document nothing in-world."

### (e) async: (d) plus a second brain paying round-trips to agree with the digest

(e) concedes the core: "(d)'s batching is my executor's degenerate case" (its
Anticipated 4). Until escalation fires,
(e) is (d) plus bookkeeping; its rows show: code-brain async rows run
toy2-wall in 7-12 calls and toy2-locked successes in 9-12
(`bench/matrix-async.log`), one call planning multi-step batches, the
`plan_submit` economics of bench/README.md. That is (d) at work.

The machinery's results. With a cheap-model small brain, locked runs 30-45
calls (seed 4 dead at the 45 cap) vs 13-17 with the code brain: 2-3x the budget,
burned by putting a model where (d) puts an executor; hence (e)'s default is
(d)'s fixed-code design. Where escalation machinery had to earn its keep (wall),
async went 6/10, all four failures pinned at the wall's call cap (40,
`lib/harness.ts`), while the llm baseline went 10/10 at 7-13 calls [raw rows,
both logs]. The second brain did not save the seeds.

When escalation fires, round-trips compound in (e)'s own text: freeze tail,
safe-hold, queue, "delivered at the next turn admission," big-brain ruling (≤1
search; one search is a full model turn, dsh-facts.md), repair adopted "at the
*next step boundary*," with continuation timing "not documented" and delivery
latency "an open spike item." In (d), the first failing call stops the batch and
the digest ("one digest line per call") reaches the model at the next prompt
(bench/README.md). One round-trip, same information.

## Answering the predictable

**Expected attack 1, from (e) Anticipated 4/§9: "(d) as benched is still
synchronous … the plan dies when the turn ends."** Round 1 measured fixed
executors at idle 0.00 while re-consulting the model per digest: the body works
between calls because each call returns up to eight actions. Actions per call is
the unit that matters; plan lifespan is not. If a plan must outlive its turn,
persistence is plugin file state (the ledger pattern (b) ships): one increment
on (d), not a second brain.

**Expected attack 2, from (a)/(c): "efficiently doing the wrong thing … (c)
claims your PTC legs, so batching is commodity transport."** (c)'s Anticipated 7
claims my primitive "helps any phase equally." Stop-on-first-failure caps waste:
a batch failing at step 3 returns two done tasks and one digest; the incumbent
spends three full turns at ~20 s p95 for the same information. Batch size is the
model's priced choice (1 on hostile ground; 8 on chores). (c)'s borrowing
confirms my claim: its survey cannot afford its idle ratio without (d)'s
transport. A substrate every option needs is the right first growth investment;
the `combo` row measures that stacking.

---

# round-1-async

# Async (e): cross-examination, round 1

Standing note: (e) is the owner's own amendment design; (b)'s layers are the agreed store. I attack mechanisms, not mandates.

## Attacks

### (a) reflect — the body waits through the reflection turn

(a) keeps one model in the action path: when stuck, the listener "demands one bounded reflection step before the next body action," and (a) prices the wait itself: "During a stuck episode the body is blocked; the counterfactual use of that turn is another futile retry." Round 1 measured that tax on every model-in-the-loop row (farm llm 0.36, mine llm 0.28, hybrid 0.38; round-1 REPORT), and (a) concedes the axis: "reflection adds turns when triggered; it does nothing for round-trip latency or actions-per-day." Then it adds search, the costliest turn in the stack ("one search costs a full model turn," dsh-facts.md §1), budgeted S=2 per game-day. Its steady-state defense ("a working companion never reflects") fails on this bench: both scenarios open stuck (bench/README.md), so reflection sits on every run's critical path. (a) changes what the model knows between attempts; the attempts still wait on the model.

### (b) library — it renders memory; nothing moves the body

(b)'s own ledger closes this: "a companion that knows the mine is closed still idles at the round-1 gap ratios while a model call is in flight — that is option (d)'s PTC/batching work." Layers 1–2 change what the model starts knowing; during the sitting the session model remains the only decision-maker, so round-1 idle (0.28–0.36) and ~20 s p95 gaps (BRIEF.md) stand — and (b) hands its latency fix to (d), whose executor is (e)'s. Second, the writer is a batch: "the main writer" is the day-end distill, "one model call per game day"; the in-turn write is discretionary ("the model may record"); reconcile is "one call per session." Nothing in (b) interrupts the retry reflex P2-0019 exhibited — the day's grinding is what gets distilled; wrong lessons render until a verified failure demotes them, at (b)'s own price, "one wasted encounter … that encounter is the correction signal," per wrong lesson — CLIN's stove insight, its own cautionary tale.

### (d) actionrate — next-digest is the idle tax, renamed

(d) claims "the body is never idle waiting for the model unless the plan itself says 'stop and wait'" and even "call t+1 is composed while the executor is still running batch t." But its executor "runs them in order (stopping on the first failure) and returns a digest" (bench/README.md), re-consultation happens at "a batch digest returns," and even the abort path "escalates with the digest." A halted batch is no active body task while the next model call is in flight: the bench's own idle-ratio definition. And t+1 cannot be composed during t: with stop-on-first-failure, the digest t+1 plans from does not exist until batch t halts [reasoning]. Its 0.00 evidence does not transfer: "every fixed executor (modes, goap, skills, handcoded, llm-bt) shows idle 0.00" describes rows with no model in the loop; (d) re-enters the model every 8 steps. Its honest ledger finishes the case: stop-on-failure "catches *step* failure, not *plan-level* wrongness (a perfectly executed 8-step plan toward a closed pass still wastes the morning)," yet its attack section insists "no detector needed" because "every failure reaches the model at the next digest." Both cannot hold — the digest is what P2-0019's model already had, and it re-planned the same wall for days; cross-batch repetition is what the small brain's signature ledger is for. So (e) is (d)'s executor generalized — the plan inbox persists across turns in plugin files (vs PTC "isolated per run," dsh-facts.md §3), the body working while the big brain thinks — plus the escalation channel for the wrongness (d) concedes.

## Answering the predictable

**1. "Two brains = two places to debug; nondeterminism" (openings' anticipated attacks; (d)'s variant: "unearned complexity … the simpler sufficient thing").** The split removes confounds: round 1 moved mine success 50–70% between replicas on wall-clock interleaving alone while fixed-executor rows held identical — one turn mixing semantics with execution is the reproducibility problem; a deterministic executor under one semantic decider is the cure, and the trail (plan id, step, native outcome, ruling) needs no narrative to trust. The cheap-model variant is optional, owner-benched (`smallbrain=code` vs `flash`), confined to skill selection and target adjustment, degrading to fixed replay; the game's task status, never a model, declares success (RSIAgent's verifier rule, notes-rsi.md). And (d)'s own ledger contradicts "simpler sufficient": plain batching cannot see plan-level wrongness — the detector is the fix for its named gap, not speculative machinery.

**2. "Escalation latency: while the big brain thinks, the body still fails; safe-hold is idle with better press" (anticipated in the openings; fired already in round-1-reflect.md).** Three bounds. The costly pattern stops at K=3 — the frozen tail ends the golem health drain; (a) spends the same window on retries, (d) on digest-replans of the same wrong plan. The first escalation move is retrieval over stored lessons at ~0 marginal calls (round-1 skills: mine 8/10 @ 0.1), search rationed to ≤1 and cached. Safe-hold is bounded by the plan's `maxSteps`/`expiresAtTick`, visible in the outbox — against the accidental 0.28–0.9 idle incumbents pay on ordinary turns; mid-plan without escalation nobody pauses, the tax rivals pay every turn. `recovery_ticks_mean` measures the residual; the honest unknown (round-driver cadence, undocumented in dsh-facts.md) is a tuning item, not a redesign.

