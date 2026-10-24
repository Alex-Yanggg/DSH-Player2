# Round 3 — assembled answers and closing positions (all five advocates)

---

# round-3-reflect

# Reflect (a): cross-examination, round 3 — answers and closing position

Sources: round-1/round-2 transcripts, the openings, BRIEF.md, dsh-facts.md,
bench/README.md; no bench run; inferences labeled [reasoning].

## Answers

**1. (c) curriculum — "unrequested autonomy priced against her own search turn; her closure lesson stays an inference until day 5."**

Two concessions, one correction. Conceded: my five reflection moves contain no
read-the-world move — nothing directs the model to a notice board before the
search turn. Fixed inside my architecture: a sixth game-free move
("consult observable in-world sources before searching") needs no new seam —
observing is a body tool the model already owns — and where the world states
the fact, a copied `observed` entry beats my wiki-inferred `hypothesis`, as (c)
says. The `hypothesis` tier stays for searched facts (Reflexion's 16.3% MBPP false
positives; AWM's success-gate — prefer false negatives): in-world
first, wiki second, confirmed by outcome. Conceded too: the slogan "unrequested
autonomy" was loose. The boundary I actually claimed was in the same opening
sentence — failure-driven on the player's task, "not self-task-generating." A
read-only search or board read inside the delegated goal is cognition serving
the player's goal; (c)'s trigger 1 makes its own survey the body's default phase
before the goal begins — the agenda inversion (b) attacked in round 2.
And (c)'s `observed` advantage holds only where a survey actually reached
the board — my round-2 unnoticed-absence point stands.

**2. (e) async — "the scoping double standard, and a trigger priced at zero."**

The double standard: conceded on the narrow point. I invoked bench scoping ("a
minimal prototype of one debate architecture," bench/README.md) to excuse my
in-run lessons while prosecuting (e)'s memoryless big brain; symmetric honesty:
the reflect row proves the trigger and write loop, not persistence — my
store is (b)'s layer-2, as I conceded in round 2. But storelessness was never my
main charge against (e): its Answer 3 concedes the repFail 12.4 grinding
"entire," its safe-hold stages and "open spike item" delivery are its
own §§3–5; the idle rows are its aggregates. The trigger "priced at zero":
concede the measurement, contest the inference. Locked could not discriminate
writers — library-cold's discretionary in-turn writes matched my row within a
call (10–14 vs 10–13, both 10/10, zero repeated failures per (b)'s own round-2
citation) — the board and wiki are easy, the model good. Against "the model
writes anyway": P2-0019, where the same model class
re-walked for days rather than writing anything. On this matrix the trigger's
measurable edge is ~one call; its case is the observed failure the bench
abstracts away [reasoning].

**3. (d) actionrate — "the rival carrying a K=3 detector measures 12.4 on locked (per-seed 5–35) and 84 in one toy2 run."**

Misattribution if read onto (a): those rows are (e)'s code brain — its
aggregates, conceded in its Answer 3. (b)'s round-2 citation of the raw rows:
"reflect, library-cold and combo show zero everywhere" for repeated failures.
My reflect row: locked 10/10 at 10–13 calls, zero repeated failures — fewer
calls than (d)'s own locked 17–24. The detector-plus-writer did not grind.

## Closing position (honest)

**The strongest form of (a), as it would ship.** A writer bolted onto the
owner-agreed store, on verified seams only (dsh-facts.md §1–3; all in `acp`). The existing `agent/pre-step` listener — the one already writing turn
markers — hashes coarse outcome signatures across turns (task kind, first
press/hold, movement target) plus a one-game-day progress backstop, both config
constants; on trip it injects a reflection directive carrying the failure
ledger; the prompt runs six game-free moves (pattern; knowable vs unknowable;
look in-world; one batched `web_search` capped at S=2 per game-day; typed
`lesson_write` into (b)'s per-save schema with `asOf`, confidence tiers,
demotion; a measurably different next approach); lessons render each turn via
the persona section's render-time variables. Zero game facts in code; the wiki
is whatever `ctx.web` finds at play time; every network request documented and
capped. Small, inspectable, resettable — and it fixes both observed knowledge
failures at their site: repeated failure.

**What (a) does not fix.** Action rate: reflection adds turns when triggered;
actions-per-day, p95 round-trips and idle are (d)'s axis, and its batching
measured real wins where learning happens (toy2-locked 12–16 vs 27–30 calls at
the same 7/10). Coverage before failure: my loop is blind until first failure
by design — the unnoticed-absence problem I charged (c) with, I share; (c)'s
bounded survey is the only mechanism on the table that front-runs tuition,
provided its trigger-1 inversion is brought inside the permission boundary.
Cross-save identity and the persona layer are (b)'s design; I defer. Async
delivery: if the round-driver cadence were ever documented, (e)'s channel could
carry my trigger's output without freezing the body; I claim my synchronous
reflection turn is bounded, not optimal. And weak models: Reflexion measured no
gain for one (starchat-beta, 0.26 → 0.26); the loop rides on the serving we
have.

**What I would take from the rivals — and what I refuse.** From (b): the store
wholesale — layer 2 keyed by the game's own `uniqueIDForThisGame`, the sheet
with quotas, demotion, `asOf`; my opening called the composition the natural
end state and (b) conceded the writer is mine. From (c): the read-the-world
move and `observed` confidence for in-world-stated facts, adopted above. From
(d): the PTC executor as the substrate my "next approach" feeds. From (e): the
falsifier-before-replan rule its Answer 3 conceded its prototype lacked. The
one thing I refuse: any self-generated phase that displaces the delegated goal
as the body's default work — (c)'s trigger-1 survey-first on every unlearned
save — because it is the one move that turns a trustworthy co-op player into
its own agenda, and every benefit it measured is reachable by failure-triggered
looking inside the player's goal.

---

# round-3-library

# Round 3 — closing: advocate (b), the library

Sources: round-1/2 transcripts, my opening, BRIEF.md, `dsh-facts.md`, `bench/README.md`,
`notes-rsi.md`, final `results/summary.json` aggregates (orchestrator's run; I ran no
bench). [reasoning] marks inference.

## Answers

**1. (a) reflect: "your RSIAgent citation disproves your 'no reflection subsystem' claim."**
Conceded: per `notes-rsi.md`, RSIAgent's memory is grown by dedicated curriculum/actor/verifier roles with distill-then-reconcile — my sentence was wrong as stated. What survives: RSIAgent improved the memory itself (weights frozen, ~7 points OSWorld partial), frozen before reuse — the subsystem serves the store. Mine is that loop at session scale; the daily call is a budget rivals also pay. The matrix's control: reflect (writer, no store) 10/10 at 11.3 calls on locked, library 10.3, cold 11.3 (`results/summary.json`) — even on day one; only one keeps anything for session two. Residual: a silent model pays the first bad day whole — (a)'s trigger is the fix, writing into my store.

**2. (c) curriculum: "the store is cargo — the distill never sees 'until spring 5'; authoring went 0/3."**
False by the bench's construction: the closure is "discoverable by exploring (a readable notice board near the start)" (bench/README.md); the session that hits it reads the board, and the distill runs in that session with that text in context [reasoning]. The 0/3 figure refutes a claim I never made: my opening concedes one-shot authoring fails on a new game; the claim is that experience, once paid, is never re-paid. But the prototype kept the guide in per-run RAM (`approach-curriculum.ts`), and the matrix prices the producer: 21.0 mean calls on locked, 34.8 on toy2-locked, against the library's 10.3 and 32.4 (`results/summary.json`). A producer that re-pays per session and costs more than the store is not the architecture.

**3. (d) actionrate: "warm-vs-cold is a rounding error; your reader is unmeasured."**
Final aggregates supersede my mid-run rows: locked warm 10.3 vs cold 11.3; toy2-locked 32.4 vs 34.2; wall 9.0 vs 7.8 mean calls (`results/summary.json`). Conceded: the delta is ~one call on locked scenarios, nothing on wall — and warm toy2-locked posted 3.7 repeated failures vs cold's 0.1 [reasoning: consistent with a wrong seed-1 lesson propagating; not proven]. What survives: warm tied the matrix's best locked result — 10/10 at 10.3 calls, idle 0.144, the lowest of any row — so persisted lessons load, render free, and do not corrupt the session. The reader is round-1's skills row (mine 8/10 at ~0 calls, farm 10/10 at 0.0), its wall-clock already conceded to the executor; ten seeds show direction, not weeks-of-sittings magnitude.

**4. (e) async: "your demotion needs my detector — attribution."**
Concession first: my round-2 "mechanical" overclaimed, and (e) named the hard part — attribution. But the fix is not (e)'s machinery. The plugin already logs every lesson render and `library_learn` with turn and task context, so the failing turn shows which lessons were in view; v1 demotes conservatively — subject matches the failing task's target, verified outcome only, `contested` only — while the session-end reconcile, one model call with full session context, decides keep/rewrite/delete. Correlation plus one model judgment, not a K-counter, signature ledger, or queue. If unsure: flag-only — the cost is the one wasted encounter I already price. [reasoning: v1 design]

## Closing position (honest)

**The strongest form, as it ships.** One DSH plugin, three file layers. Layer 1, cross-save: the ledger's `person.json` traits plus game-agnostic play principles and player preferences. Layer 2, per save: `saves/<uniqueIDForThisGame>/lessons.jsonl` — append-only typed lessons (world-fact | route | approach | player-pref) with confidence tiers, `asOf` game day/season, evidence refs, source; the id is the adapter-declared `Game1.uniqueIDForThisGame` (read at runtime by a shipped mod — my fetched FamilyPlanning source), with fallbacks for idless games. Layer 3, the session: a fixed-size pinned sheet via persona sections and render-time variables (dsh-facts.md §2) plus a `library_query` tail; writes via `library_learn` on verified outcomes, one-call day-end distill, cached search hits, one-call close/reconcile; correction via `contested` plus reconcile; eviction via per-kind quotas and ExpeL count-decay. Writes ride played sessions only; one egress, the cached wiki search. The owner's amendment settled the storage contract (e's own answers concede it), leaving me these mechanics: distil timing, correction, inspectability. On the matrix's knowledge scenario they held: 10/10, cheapest successful call count, lowest idle.

**What it does not fix.** Throughput: the model still round-trips per action; (d)'s PTC batching owns that — wall: actionrate 8.5, combo 8.3 vs library 9.0 mean calls. Within-session interruption of the retry reflex: (a)'s K=3 detector. Cold-start exploration: an empty store grows only from contact; (c)'s bounded survey remains the new-game accelerant. Bounded wasted attempts and cross-plan attribution: (e) is right that thresholds must count across re-plans. And wrong-lesson propagation is real: warm toy2-locked's 3.7 repeated failures show a store can carry an error a fresh derivation would not inherit — (a)'s re-derivation is immune; my protocol makes it correctable, not impossible.

**What I would take, and the one refusal.** From (a): the stuck trigger as a writer event into my store — combo measured the stack at 10/10 on locked, wall, and toy2-wall (10.2, 8.3, 11.9 mean calls). From (c): the survey as a cold-start phase explicitly granted by the player, never a default agenda. From (d): PTC batching for the body and survey legs. From (e): the discipline without the transport — falsifier-checked re-plans and thresholds counting across re-plans. The one refusal: (e)'s standing second brain. No async clock, queue, or mid-turn model interrupt exists in DSH (dsh-facts.md); the bench ran its channel only synchronously; and its concessions — grinding rehearsed to 12.4 repeated failures storeless, the flash small brain 0/20 and cap-pinned — price the remainder below zero where measured. One session model, one permission surface, plain files the player can read and reset.

---

# round-3-curriculum

# Round 3 — closing cross-examination: advocate (c), the curriculum

Sources: round-1/2 transcripts, my opening, BRIEF.md, `dsh-facts.md`,
`bench/README.md`, `bench/lib/approach-curriculum.ts`, final aggregates
`results/summary.json` (orchestrator's run; I ran no bench). [reasoning] marks
inference.

## Answers

**1. (a) reflect: "termination signals cannot certify the needed fact was found"; the golem probe is "the same failing task my detector consumes."**

Conceded: the signals bound the survey; none certifies the *needed* fact —
hence `kind: "unknown"` entries for noticed gaps, and trigger 3. The
probe's price is real — "each swing is a failing task and drains health"
(bench/README.md) — but one bounded probe per interactive thing is the fee for
a hazard at `observed`; her loop pays K=3 failures to *infer* it.
Matrix: wall 10/10 at 13.1 mean calls, repeatedFailuresMean 0
(`results/summary.json`).

**2. (a): the honest-gaps defense "collapses on its own trigger table"; a miss is "P2-0019 plus a paid survey"; recovery is "my loop, conceded necessary, slower"; (c) is "a prepaid accelerant."**

Conceded: `unknown` entries exist only where the survey *noticed* a gap; a
survey that misses the board writes nothing — coverage cannot show what was
never seen. (i) Trigger 1 is not my only re-opener: trigger 2 opens a local
survey on an observation naming an uncovered area; trigger 3 answers the
silent miss — a blocked goal against an unrecorded obstacle gets a route
survey (opening). (ii) "My loop, slower" misreads trigger 3: her loop pays
K=3 failures plus a reflection turn plus a search turn, then files an
inference unconfirmed until a verifying outcome — day 5 for this closure (my
round-2 attack, unaddressed). Trigger 3 fires on the first blocked-goal
signal [reasoning: in the bench, the first failed walk]; its route survey
*reads* the goal's path, writing `observed` or `unknown`. (iii) A miss is not
"P2-0019 plus a paid survey": the miss case keeps what the survey found for later
sessions; a null search keeps nothing. On the "prepaid accelerant"
demotion: accept the composition, contest the inference — every option is
trigger + store + writer, and the named failure is a *fresh save*, where the
survey is the writer reaching the fact first. The PTC cut is
pre-labeled in my own seams table ("option (d)'s primitive, borrowed");
composition is how acp ships (§5).

**3. (b) library: "survey-first is a permission inversion," and amortization "is unmeasurable in your own row."**

Permission: my opening's "implicitly granted" is below the
repo's bar — permissions must be "explicit, inspectable" (BRIEF.md). Fix: the survey's
terms (budget, read-mostly actions, one-click skip) join the delegation the
player signs; absent that grant, the default is the
route-survey path, never beyond the goal's own path. The survey still
harvests nothing — the inversion was in my wording, not the mechanism's
appetite. Amortization: conceded in round 2 — per-run RAM prototype, every
seed re-surveys (`approach-curriculum.ts`); the final matrix prices the first
save: locked 21.0 vs library-cold 11.3 mean calls (`results/summary.json`).
The cross-session payoff is her warm row's to price; my product
persists to per-save plugin files (§4) in her layer-2 shape —
"the producer/store split is a division of labor inside my three layers" (her
round-1 words).

## Closing position (honest)

**The strongest form, as it ships.** One DSH plugin. Triggers on
`agent/pre-step`: at session start/resume, resolve the adapter-declared save
id, look for `guide/<save-id>/guide.jsonl` — absent or empty opens SURVEY; an
observation naming an uncovered area opens a bounded local survey; a blocked
goal against an unrecorded obstacle opens a route survey.
The directive is a persona prompt section — "go where you haven't
gone; read what can be read; activate what looks interactive once; record
what the world tells you; say when done" — zero game words. Termination
(first wins): model-called `curriculum_done` against the coverage contract;
the turn + game-clock budget in the delegation grant; a no-new-findings
counter over `guide_write`s and new areas. Guide: JSONL entries typed by
`kind` (closure/hazard/affordance/layout/schedule/unknown), `confidence`
(observed/reported/inferred), `asOf` game time; expired entries render as
hypotheses. In WORK, the guide renders as a bounded pinned section
via `dsh-persona` render-time variables; the wiki fires only for `unknown`
entries via the mounted `ctx.web` seam, once per unknown. The guide persists
into (b)'s per-save layer.

**What it does not fix.** Unnoticed absence: no trigger or rendering detects
a gap the survey never saw — (a)'s K=3 signature catches the silent miss,
(b)'s store keeps the recovered fact. Throughput: the survey
pays model turns (locked 21.0 calls, idle 0.339); nothing here moves actions per game minute — (d)'s PTC batching is the
transport, survey legs its ideal workload. Mid-flight wrongness once WORK
begins: my triggers re-open surveys on blocked signals but do not stop a
failing plan between them — (e)'s falsifier-checked re-plans cover that.
Correction, eviction, quotas, the persona layer: (b)'s store mechanics,
conceded in round 1.

**What I would take, and the one refusal.** From (b): per-save identity and
the lesson store as the guide's persistence, plus the `contested`-flag
correction. From (a): the K=3 stuck signature — net under
unnoticed absence, writer into the same store; `combo` (loop + store
+ batching) is the measured stack: 10/10 at 10.2 mean calls on
locked, 8.3 on wall, zero repeated failures (`results/summary.json`). From
(d): PTC for survey legs and goal work. From (e): falsifier-checked re-plans and thresholds counting across re-plans — without the transport. The
one refusal: (e)'s standing async second brain. DSH ships no scheduler,
queue, or mid-turn model interrupt (§4); the bench ran its channel only
synchronously (its round-2 Answer 7); its own concessions —
grinding rehearsed storeless ("conceded entire"), the flash brain "0/20 on
toy2, cap-pinned," safe-hold idle conceded — price the remainder at or below
zero. One session model, one permission surface, a survey that reads the
world before it works it.

---

# round-3-actionrate

# Actionrate (d): round 3 — final answers and closing position

Sources: round-1.md, round-2.md, my prior submissions, BRIEF.md, dsh-facts.md;
no bench run; inferences labeled [reasoning].

## Answers

**1. (b) library — "its mechanism deactivates where this debate is scored."**
Conceded: on locked my 17–24 calls trail library-cold's 10–14 — the knowing scenario is the knowledge layers' to win. Corrections. "Hostile ground → 1-step batches → today's loop" overreaches: wall is hostile by (b)'s own definition ("wall swings always fail"), and batching won it outright — 10/10 at 6–11 calls, repFail 0, with combo's store adding nothing over batching there (7–12). "Cannot buy anything on this round's exchange" is falsified by toy2-locked: successful seeds spent 12–16 calls vs the pure-LLM baseline's 27–30 at the same 7/10 — a larger measured delta than (b)'s warm-vs-cold cross-session saving (9–12 vs 10–14; my round-2 raw-row read, unofficial [reasoning]). No world-fact discovery: conceded, in my opening ledger.

**2. (e) async — "its dividend over my code brain is a rounding error."**
The mean: 12–16 vs 14.1 calls on toy2-locked is a 0–2 call edge; conceded. Tails are not rounding errors: code-brain locked repFail 12.4 (per-seed 5–35) vs my 0.0, wall 6/10 vs my 10/10, flash brain 0/20, cap-pinned at 45. When (e)'s small brain is code it is my executor plus bookkeeping — its own containment framing — and the matrix prices that bookkeeping negative where learning mattered. "No store, no trigger, no plan that survives the turn": store and trigger conceded (opening ledger); plan persistence is plugin file state, the increment I priced in round 1; (e)'s own answers locate its fixes in (b)'s store and a re-plan rule — the channel is what this debate never measured.

**3. (c) curriculum — "(d) attacks my channel while shipping none."**
Conceded: (d) ships no discovery channel — I search nothing (dsh-facts.md §1: one search costs a full model turn), so the wiki race is (c)'s by default. But "shipping none" confuses the writer with the wire. My digest — per-step native outcomes, stop-on-first-failure — is the event stream (c)'s own recovery trigger consumes ("a blocked goal on an unrecorded obstacle re-opens a bounded route survey," its round-2 Answer 1) and (a)'s K=3 detector counts. Its own concession — board author-placed, real save had none — leaves my round-1 point standing: documentation is not discovery. The plan-level-wrongness limit I named first, in my opening ledger.

**4. Two reframes, to close the ledger.**
(b) Answer 6: correct — round-1 skills (0.0 calls, 7.2 s) is (b)'s store riding my executor; conceded in round 2; that is the composition argument. (e) Answer 7: fair — the bench could not run (e)'s async clock (no scheduler, queue, or mid-turn interrupt in the verified seams, dsh-facts.md §3); its rows price (d) plus escalation overhead. Corollary: every measured row in this debate ran my executor, and (e)'s delta over (d) is unmeasured — "an open spike item," its words.

## Closing position (honest)

The strongest form ships as one game-agnostic plugin module on already-mounted seams. A batched plan is model output per session: an ordered list of up to 8 steps, each an opaque (tool, args, until) tuple over the adapter's declared vocabulary, submitted via the fixed-vocabulary `plan_submit`. The executor contract is mechanical: run steps in order; take success/failure only from the body port's native result, never inventing success (the repo's no-local-fallback rule); halt on the first failing step; return a digest, one line per step plus the failing step's native error. While the model thinks, the shipped reflex tier evaluates every tick via `agent/pre-step` and `until`-conditions keep the body executing — call t+1 is composed while batch t runs. The model is re-consulted at four points: a digest returns; an abort escalates with the digest; the goal round driver re-prompts (256-round cap); and the model's own batch-size choice. Skills promote to runtime-learned plugin files only after demonstrated reuse; the shipped `reflexes/stardew-valley.json` migrates to a declaration-derived safety set. Zero new network requests; batches are logged, replayable, player-inspectable artifacts.

What (d) does not fix. No world-fact discovery: the locked closure needs (b)'s store holding an observed fact, (a)'s reflect-and-search, or (c)'s survey — (c) is right that observed beats inferred and that my loop has no read-the-world move. No cross-session memory: (b) owns layers, identity, staleness, demotion — the agreed design; my warm-row attack measured the delta small so far, and combo proved the store composing with batching (10/10, zero repeated failures). No trigger beyond the batch: stop-on-first-failure catches step failure, not plan-level wrongness — a perfectly executed plan toward a closed pass still wastes the morning; (d) makes the waste cheaper, not zero; (a)'s K=3 plus one bounded reflection turn is the cheapest known writer for that class. No async capability: (e)'s uncontested claim — model work while the body acts — the harness could not measure; I do not claim it. Skills inherit round-1's one-shot authoring risk (toy2 0/3).

What I would take, and the one refusal. Take (b)'s three-layer store as the standard schema for everything any loop writes — combo is the measured proof the composition is the product. Take (a)'s K=3 reflect trigger and its hypothesis-until-confirmed discipline, wired to my digest stream. Take (c)'s trigger 3 as another consumer of that stream; its permission warning is fair on any proactive phase. Take (e)'s async clock as a separate spike, contracted only after the synchronous system ships. The refusal: no second model in the body's action path as a standing fixture. The flash small brain was this round's measured null result — 0/20 on toy2, cap-pinned, worst idle ratios recorded — and the design principle does not demand it: the model already holds a priced supervision dial (batch size), and if escalation beyond digests is ever proven necessary, (a)'s bounded reflection turn in the delegated session is the smaller, inspectable path.

---

# round-3-async

# Round 3 — closing: advocate (e), the async split

Sources: round-1/2 transcripts and openings, BRIEF.md, dsh-facts.md,
bench/README.md, final aggregates `results/summary.json` + `metrics.csv-async`
(orchestrator's run). [reasoning] = inference.

## Answers

**1. (a) "the body waits through every stage after the reflection turn."**
Conceded: my 0.383 locked idle includes deliberate safe-hold. But on toy2 — day
one, no store — my code brain posts the matrix's lowest idle and highest
actions-per-game-minute (0.164 / 0.0033): between plan boundaries the body works.
Her round-3 concedes it: "bounded, not optimal," and a documented cadence would
let my channel carry her trigger "without freezing the body."

**2. (b) "raw rows contradict the K=3 bounding defense."** Conceded entire
(round 2): repFail 12.4, wall 6/10 cap-pinned, toy2 seed 6's 84 — storeless
re-planning with per-plan counters. Fixes: (b)'s owner-agreed store,
falsifier-checked re-plans, cross-plan thresholds. Control: combo — this skeleton
plus that store, benched under "(option e)" — 10/10 at 10.2 locked / 8.3 wall
calls, zero repeated failures. The flash brain (0/20 on toy2, cap-pinned)
answered the amendment's own question — "pure code": falsifiability working. (b)
fairly answers my attribution attack — conceded; her store still lacks a write
trigger, P2-0019's defect.

**3. (c) "the ~0-retrieval defense borrows a store it does not ship"; "the
survey is the split's missing first move."** Storelessness conceded; ExpeL's
sediment concern is met by (b)'s library schema. On the missing first move: the
small brain executes from one `plan_submit` call ("up to 8 body-tool calls,"
bench/README.md); toy2 is day one for every seed — a fresh save works its first
plan while the big brain thinks. Her round-3 concedes trigger-1 needed explicit
permission terms and keeps my falsifier-checked re-plans — her triggers "do not
stop a failing plan between them."

**4. (d) "'exempt by construction' is a measured falsehood."** Two corrections
to an otherwise-conceded attack. She quoted my locked 0.0033 actions/game-minute
beside recovery 1593 without comparison: 0.0033 is the matrix maximum in all four
scenarios (hers: 0.0012) — the amendment's named proof metric. Recovery is
computable only for dominant failing signatures that recover — only async rows
have one — and 1593 ticks is floored by the scenario's clock (day 5 starts at
tick 1400, bench/README.md); the defect is the grinding inside that window. Her
round-3 answers mine fairly — mean edge conceded, "the channel is the part of
(e) this debate never measured."

**5. The round-3 refusals (a, b, c; (d) variant).** What they refuse is not what
failed. The bench never ran the async clock — DSH has no scheduler, queue, or
mid-turn model interrupt (dsh-facts.md; my Answer 7) — so every measured row is
my channel run synchronously, priced storeless — a negative remainder; skeleton
plus store is combo, the matrix's best row on three of four scenarios.
Refusing the standing brain on this evidence refuses combo. "No clock in DSH" is
grounds to build the channel from verified seams: an inbox is plugin state, two
tools, zero standing model calls. The triggered split they keep carries its own
bill:

- **(a), triggered:** "During a stuck episode the body is blocked" (round 1);
  both scenarios open stuck (bench/README.md): the freeze sits on every run's
  critical path, plus a full-model-turn search when the gap is not in-world. She
  owes those minutes.
- **(b), no trigger:** "a silent model pays the first bad day whole" (her
  round-3) — the day P2-0019 priced in lost days; a standing escalation channel
  is what interrupts the retry reflex mid-day.
- **(c), triggered surveys:** her triggers re-open surveys but "do not stop a
  failing plan between them" — she owes the mid-flight window; the survey premium
  is measured (21.0 locked calls).
- **(d)** refuses "no second model in the body's action path as a standing
  fixture" — we agree: post-flash, the standing fixture is code plus an inbox.
  Her persistence concession ("one increment on (d)") is the plan inbox; she
  takes the clock as a spike, not a falsehood. [reasoning]

## Closing position (honest)

**The strongest form, as one DSH plugin.** A plan inbox and status outbox as
plugin files keyed by save id; plans carry intent in player words, port-shaped
steps, a falsifier, `maxSteps`/`expiresAtTick`. The small brain is pure code:
step replay, signature ledger (K=3 plus a one-day backstop), safe-hold, expiry
enforcement. The escalation message: planId, failing step, signature, last K
outcomes, a bounded observation excerpt, the falsifier text — asking exactly
repair, replace, or blocked; delivered at pre-step admission. The big brain's
learning writes into (b)'s per-save lesson store — tagged game-generic vs
game-specific, gated on verified outcomes, each lesson carrying its falsifier
hook. Permission: plans only against an active delegated `goalRef`; safe-hold and
reflexes the only self-initiated acts; every plan, escalation, lesson a file the
player can read and reset.

**What it does not fix.** Coverage before failure: nothing reads the world before
K=3 — (c)'s permission-fixed survey is the only mechanism that front-runs
tuition — it belongs here as a big-brain plan, not a rival phase. The store is
(b)'s: my write trigger presumes her schema, quotas, contested-demotion, `asOf` —
her warm toy2-locked 3.7 repeated failures show stores carry errors my falsifier
hooks mitigate but never eliminate. Idle at plan boundaries and safe-hold is real
(0.383 locked, 0.419 wall). Delivery latency stays my unclosed spike item; the
async clock is unproven — the matrix priced only its synchronous shadow.

**What I would take, and the one refusal.** From (b): the store wholesale —
layers, quotas, contested demotion, `asOf`. From (c): the survey, re-issued as an
explicit-permission big-brain plan when a goal is blocked-but-waitable. From (d):
PTC as the in-turn form for computed-argument plans, and stop-on-first-failure
inside the executor. From (a): her six-move reflection directive as the
escalation playbook, and her progress backstop. The one thing I refuse to take:
the blocking turn itself — any rule that makes the body's next move wait on a
model turn, whether (a)'s reflection directive, (d)'s digest freeze, or (c)'s
survey-before-work. The standing inbox keeps intelligence online; give it the
store, the survey, and batching — combo, the static composition the bench files
under this option — and the combined design is the matrix's best-scoring row.

