# Round 2 — assembled answers and counterattacks (all five advocates)

---

# round-2-reflect

# Reflect (a): cross-examination, round 2

Sources: round-1 transcripts, the five openings, BRIEF.md, dsh-facts.md,
bench/README.md, notes-*.md; no bench run; inferences labeled [reasoning].

## Answers

**1. (b) library — "lessons die with the run": the prototype's scope, not the option's.**

Conceded: the bench's reflect prototype keeps lessons in-run. Wrong
inference: that is bench scoping — each approach is "a minimal prototype of one
debate architecture" (bench/README.md); the library row demonstrates the store
because storage is (b)'s variable. My mechanism specifies the store: "Plugin
files in the plugin's own data directory, one per save" (advocate-reflect.md
§4), loaded via persona prompt sections with render-time variables (§5;
dsh-facts.md §2). dsh-facts.md §4: storage is only "files the plugin writes";
what none gets for free is the writer that converts repeated failure into the
right lesson. (b) concedes my loop is "a *better writer*" and composition "the
natural end state" (round-1-library). Every cross-session system (b) cites
(ExpeL, CLIN, AWM) keeps my write loop and adds a store. I concede (b)'s `asOf`
stamps and cross-save person layer are good increments — to a file format, not
an architecture. [reasoning]

**2. (c) curriculum — "knowledge is strictly post-wall": bounded tuition vs a prepaid budget.**

Conceded: my loop reacts. Corrected price: post-*signature* is not post-loss.
The locked walk ends `blocked` (bench/README.md); the K=3 signature trips after
three walks — minutes of game time [reasoning] — the directive lands in that
day's next prompt. P2-0019 lost days for skipping that turn; my ceiling is three
attempts plus one turn. (c) concedes the reactive case: urgent goals "degrade to
a route survey of the goal's own path" — my post-first-contact reaction with
more turns. The trade: three attempts + one turn, paid only where a wall exists,
versus a budgeted survey on every unlearned save even where the world documents
nothing, whose termination signals cannot certify the needed fact was found.
Conceded: observed beats inferred — hence searched facts enter as `hypothesis`,
promoting only on a confirming outcome. But the wall class shows the survey's
tuition: recording golem immunity at `observed` requires trying the golem —
"each swing is a failing task and drains health" (bench/README.md) — the same
failing task my detector consumes. [reasoning]

**3. (e) async — "the body waits through the reflection turn": and through every stage after it.**

Conceded: mine is synchronous; the idle rows (farm llm 0.36, mine llm 0.28,
hybrid 0.38) are real — the baseline's every-turn tax; my loop adds one capped
turn per stuck episode. Meanwhile (e)'s small brain freezes the
tail and safe-holds — "take no new semantic action" (its §3): the body is
equally inactive during (e)'s deliberation. The difference: mine resolves inside
the next prompt; (e) adds queue → next turn admission → big-brain ruling
(possibly one search) → adoption "at the *next step boundary*"
(§3–5), with delivery latency "an open spike item" and round-driver cadence
undocumented (its §4). "Both scenarios open stuck" cuts at (e) harder: both are
built so the direct plan is wrong from the start, and (e)'s small brain "never
invents approach steps" (§3) — every measured run spends its episode in the
exact safe-hold (e) prices me for, plus more stages. The
idle-0.00 rows still do not transfer: no model in the loop at all. [reasoning]

## New attacks

**(c) curriculum: the "honest gaps" defense collapses on its own trigger table.**

(c)'s round-1 answer to the confident-grinder attack: "missing facts as
`kind: 'unknown'`: honest gaps routed to the wiki search or the player." False
by (c)'s own mechanism: an `unknown` entry exists only where the survey
*encountered and noticed* a gap. A survey that never reached the notice board
writes neither a closure entry nor an unknown entry — unnoticed absence is
invisible to coverage rendering; the confident grinder survives in (c)'s
honesty costume. Concretely: an expired 8-turn budget or an early
`curriculum_done` leaves the guide silent on the closure; WORK begins; the goal
grinds the wall — P2-0019 plus a paid survey. Worse: the guide file now exists,
so trigger 1 never fires again; the only recovery is trigger 3 — "goal blocked
against an unrecorded obstacle" → a route survey *after* the first blocked
walk: my loop, conceded necessary, slower. (c) is not an alternative to the
reactive loop; it is a prepaid accelerant bolted onto it. And its round-1
latency defense ("survey legs are ideal PTC work") leans on a primitive its own
seams table files under "Batched survey legs (composition, not core)" — option
(d)'s, not (c)'s.

**(b) library: its RSIAgent citation disproves its "no reflection subsystem" claim.**

(b)'s round-1 answer: memory grows "from exactly these signals — 'verifier
verdicts, execution feedback, environment observations' — not from a separate
reflection subsystem." notes-rsi.md shows the opposite: RSIAgent's memory is
grown by dedicated curriculum, actor, and verifier agent roles with
distill-then-reconcile after each wave and "the actor's learning diagnosis
handed to the curriculum agent" — a multi-agent reflection subsystem. The
signals exist; the distillation is the subsystem, and that is what (b) lacks:
event 2's write stays discretionary — P2-0019's model re-walked for days rather
than writing anything — while event 1 is an unconditional "one model call per
game day," a standing tax even on quiet saves [reasoning: fixed per-day rate,
not gated on anything to learn]. A store whose writer is discretion
plus a daily toll does not own growth; the loop that decides *when* knowing
happens is the architecture.

---

# round-2-library

# Round 2 cross-examination — advocate (b): the library

Sources: round-1 transcripts and openings, `dsh-facts.md`, `bench/README.md`,
raw rows in `bench/matrix-*.log` (unofficial — aggregation pending; I ran no
bench), and `bench/lib/` prototypes. Inferences labeled.

## Answers

**1. "No writer on the first save — an empty shell" (reflect, curriculum,
async).** Conceded: a fresh save starts empty; (a)'s directive is a better
writer. But "empty shell" is measured and false: `library-cold` is the first
save ten times, an empty per-seed store grown in-session (bench/README.md). Raw rows: locked 10/10 at 10–14 calls, zero repeated
failures — matching (a)'s reflect row (10/10, 10–13) with no detector. The
warm `library` row's seeds ARE successive sessions on one save — "seed 1
discovers, seeds 2..N start with what earlier sessions learned"
(bench/README.md): the matrix prices discovery and retrieval in one number.

**2. "'Walk blocked' can never become 'until spring 5'; the search path is
orphaned" (reflect, curriculum).** The distill runs inside the session whose
context holds what the companion read; the fact is stated in-world on a notice
board near the start (bench/README.md), so "until when" is in context before
distillation [reasoning]. Search is not orphaned: the web tools ship mounted
in acp (dsh-facts.md §1); the model calls `web_search` in a normal turn and
the plugin caches the hit as a `source: "searched"` lesson. Conceded: the
first session can pay one failed walk late — shared tuition; from session 2
on only the library pays zero.

**3. "A standing tax: a call per game day plus a reconcile per session,
forever" (reflect, curriculum, actionrate).** This conflates writer and
reader: the reader is zero model calls — render-time persona variables load
the sheet every turn (dsh-facts.md §2); the round-1 skills rows (mine 8/10 @
0.1, farm 10/10 @ 0.0) measure that reader. The writer is the growth budget,
paid by every option: (a) K-triggered reflections plus S=2 searches/day; (c)
an 8-turn survey per unlearned save; (e) escalation traffic. Mine is paid once
per lesson per save; (a)'s prototype keeps lessons "here in-memory per run"
(`approach-reflect.ts` header), re-firing every session.

**4. "Prompt bloat; evicted lessons sit behind a call" (actionrate).** The
sheet is fixed-size by construction — character budget, per-kind quotas,
weighted selection (MemGPT's working context; Mem0's ~90% token savings — my
opening's citations) — the prompt never sees the library's growth. Concede
eviction needs `library_query`, with two bounds: it bites only when
higher-ranked lessons saturate the sheet — the recalled entry is by definition
low-relevance to the active goal — and `library_query` rides a turn already in
flight [reasoning]. "Permanently fixed" means written once per save; the file
keeps every lesson, on-sheet or not.

**5. "Stale lessons render until corrected; rewrites unbounded (CLIN's
stove)" (async, curriculum).** CLIN had no `asOf`, no confidence tiers, no
failure-triggered demotion — I ship all three. Demotion is mechanical: the
plugin sees every body result, and a verified failure flips the lesson to
`contested` in-turn; contested entries render as flagged hypotheses, not
commands. Model work is one reconcile call per session, batch-resolving
contradictions — no rewrite storm. Residual: one wasted encounter
per wrong lesson — itself the correction signal; the no-library alternative
re-pays the entire discovery every session.

**6. "It renders memory; nothing moves the body" (async, actionrate).**
Conceded in my opening's honest ledger. Two reframes: (i) `combo`
exists because these compose — its raw locked rows lead the matrix (10/10 at
9–11 calls, zero repeated failures); (ii) (d)'s headline evidence — round-1
skills at 0.0 calls and 7.2 s — IS a library row, my architecture on a fixed
executor.

## New attacks

**(e) async: its raw rows contradict its round-1 defense of escalation.** (e)
answered the latency attack with "failing behavior stops at K=3 — bounded
wasted attempts" (Anticipated 3). Its completed rows show otherwise: all 10
code-brain locked seeds accumulated 5–35 repeated failures (median 10) while
reflect, library-cold and combo show zero everywhere; the cheap-model variant
failed 20/20 toy2 runs, each pinned at the `maxModelCalls` cap of 45
(`harness.ts`; raw rows, unofficial). Escalation did not bound the grinding
its detector exists to stop — it rehearsed it — and its §4's undocumented
round-driver cadence remains unanswered.

**(c) curriculum: survey-first is a permission inversion, and its amortization
is unmeasurable in its own row.** Trigger 1 makes SURVEY the default phase of
every unlearned save; a route survey requires declared urgency (its
Mechanism). A player delegating "reach the pass" never authorized the
companion's own agenda first — the boundary (c) needs is a declaration it
never asks for. Its load-bearing claim — "one budgeted survey per save, then
amortized for the life of the save" — is unmeasurable in its own row: the
prototype keeps the guide in per-run RAM (`approach-curriculum.ts`: `const
guide … = []`), so every seed re-surveys; only my warm row tests survival. Raw
locked rows show the tax: 16–28 calls for the same 10/10 library-cold bought
at 10–14.

**(d) actionrate: its mechanism deactivates where this debate is scored.**
(d)'s own words: "for hostile ground it plans 1-step batches, which is today's
loop" (Mechanism §1). Both round-2 scenarios are hostile by design — locked
walks end blocked, wall swings always fail (bench/README.md) — so the 5–10x
dividend is absent where the matrix scores. Raw locked rows agree: actionrate
ran 17–24 calls, more than a cold library's 10–14, and its honest ledger
concedes no world-fact discovery or correction. The exchange-rate option
cannot buy anything on this round's exchange.

---

# round-2-curriculum

# Curriculum (c): cross-examination, round 2

Sources: round-1.md, advocate openings, BRIEF.md, dsh-facts.md, bench/README.md, `bench/lib/{harness.ts,approach-curriculum.ts,approach-async.ts,locked.ts}`; non-verbatim comparisons labeled [reasoning]. No bench runs.

## Answers

**1. Cost (a, d, e).**

Concessions: (d)'s raw rows stand (curriculum locked 16-28 vs baseline 13-19 calls; toy2-locked 26-32 vs 27-30; my failures at the 45-call cap, `harness.ts`); my prototype's guide is per-run RAM, re-surveyed every seed (bench/README.md: "its seeds ARE successive sessions on one save" — library row only), so amortization is unmeasured. But the premium is zero-to-nine calls on locked, a wash on toy2, against a baseline that explores anyway and records nothing (round-1 toy2: 30 calls, BRIEF.md). The cap failures are post-survey goal work (the survey hard-stops at 8 turns); trigger 3 answers them: a blocked goal on an unrecorded obstacle re-opens a bounded route survey. Where the world documents nothing the survey degrades to interaction plus `unknown` entries; (a) concedes that terrain leaves her closure class unfixed [reasoning].

**2. "Scenario-author charity" (d).**

Conceded: the board sits by spawn, placed by the author (`locked.ts`: "discoverable only by exploring (a readable notice board by the start)"), the real save had no board; P2-0019 lost days (BRIEF.md). My slogan overstated the world: the mechanism always had wiki-for-unknowns and ask-the-player. The real fact was documented outside the world, on the public wiki the bench models ("or via the scenario's simulated wiki"); who reaches it before the grind? (a) only after K=3 failures plus a reflection naming "unknowable"; (b) at day-end distill; (d) never (his ledger: "no world-fact discovery"). Mine: day 1, looking generates the `unknown` entry that routes to the search. (d) attacks my channel while shipping none: his batching "catches *step* failure, not *plan-level* wrongness."

**3. "Confident grinder" (a).**

Nothing marks a save "learned": coverage is rendered state, not belief (entries carry `confidence` and `asOf`; expired facts render as expired hypotheses; missing facts as `kind: "unknown"`). `curriculum_done` ends the phase, not the epistemics, and trigger 3 re-opens a route survey on any blocked unrecorded obstacle: "learned forever" is false by mechanism. Her mirror: K=3 plus a one-game-day backstop (her §1) cannot certify coverage either; for never-failed areas her steady state is a silent gap, no probe record. Her "cannot certify without coding game knowledge" hits her own move 2; my no-new-findings counter counts `guide_write`s in tool logs [reasoning: bookkeeping, not game knowledge].

**4. "(b)'s layer 2 adopted wholesale" (b).**

Conceded: per-run prototype, per-seed re-survey, unmeasured amortization; the product's per-save files (dsh-facts.md §4) reuse her layer-2 shape. But "adopted wholesale" concedes what her architecture lacks: the producer. Her words: on a fresh save the sheet "is empty … behaves exactly like today's product," and "an empty library plus a passive loop grows slowly; option (c)'s survey is the accelerant" (advocate-library.md); P2-0019 is a fresh-save failure. Her writers reach the spring-5 fact only after the loss: the day-end distill distills episodes showing "walk blocked," never "until spring 5" (knowable only from the world or wiki, bench/README.md). Voyager's cross-world transfer was the skill library; her cold-start section concedes her bootstrap is "play → day-end distill," and round-1's one-shot authoring went 0/3 there while the exploring loop went 3/3 (BRIEF.md): the store is cargo; the curriculum re-explores each new world.

**5. "Same blocking loop" (round-1-async).**

Blocking is transport, not curriculum: my opening claims (d)'s PTC primitive for survey legs (one round-trip per leg, dsh-facts.md §3). And (e) has no rival trigger: its §7 concedes "(c)'s exploration is what the big brain plans when a goal is blocked-but-waitable" (fired only after K=3, mid-plan); its small brain "never invents approach steps" (its §3), so a fresh save opens with the body waiting on the big brain. The survey is the split's missing first move.

## New attacks

**(e) async: the ~0-retrieval defense borrows a store it does not ship.** (e)'s round-1 latency defense bounds reflection cost by "retrieval over already-stored lessons (~0 marginal calls; the round-1 skills row: mine 8/10 at ~0.1 calls" (its Anticipated 3). The benched split has no such store: the big brain's only tools are observe/map/search/fetch/submit_plan, state is `newShared()` per run (`approach-async.ts`), lessons supposedly land in the remember/dream_commit ledger (its §7), where ExpeL measured raw episodes fed as insights *hurting* (29.0 vs 39.0 on HotpotQA; notes-classics.md via round-1-library). Where its learning had to pay off: wall 6/10, all four failures at the 40-call cap, vs the llm baseline 10/10 at 7-13 calls (raw rows via (d); cap `harness.ts`). With `newShared()` per run, seed 2 re-pays seed 1's wall: a memoryless big brain, called growth.

**(a) reflect: "unrequested autonomy" priced against her own search turn; her closure lesson stays an inference until day 5.** Her honest ledger refuses proactive layers "at the price this option refuses to pay by default: unrequested autonomy" (#5). But her loop fires a web search inside the delegated session the player never requested (one full model turn per search, dsh-facts.md §1). If a networked search mid-goal is not unrequested autonomy, neither is a read-the-board walk in the same delegation (mine costs zero network requests, hers one per gap). Her five reflection moves contain no read-the-world move: three blocked walks plus a search turn to *infer* what the board *states*. Her searched lesson is written `hypothesis`, confirmed "only when a later outcome confirms it" (her §3); for a time-gated closure that outcome exists only on day 5; until then she acts on an inference where the guide holds the board's own words at `observed` confidence.

---

# round-2-actionrate

# Actionrate (d): cross-examination, round 2

Sources: round-1 transcripts, BRIEF.md, dsh-facts.md, bench/README.md, the
async aggregates (`results/summary.json-async`, `results/metrics.csv-async`)
and raw rows in `bench/matrix-run.log` / `matrix-async.log` — unofficial,
aggregation pending; I ran no bench. Inferences labeled [reasoning].

## Answers

**1. "The 5-10x dividend evaporates where learning is needed" + "a fast body grinding the wrong wall is a worse failure mode" (reflect, round 1; async's "digest-replans of the same wrong plan").** Conceded: on hostile ground a batch halts at its first failing step. The measured consequence goes the other way. On toy2-locked, the fresh game, successful actionrate seeds spent **12–16 calls vs the pure-LLM baseline's 27–30 for the same 7/10**: the dividend halves the model-turn price where learning happens. Grinding is a plan property, not a rate property: `repeated_failures_mean` is **0 for actionrate on locked and wall** — while the rival carrying a K=3 detector measures **12.4 on locked (per-seed 5–35) and 84 in one toy2 run**. A fast body with stop-on-first-failure hits a wall *less* often per hour than the slow bodies round 2 actually measured.

**2. "Batched plans executed blind are more dangerous" (opening attack; reflect).** The incumbent is the measured one: bodies standing still while calls are in flight, deaths on the mine (round-1 REPORT). Safeguards are structural: native per-step results, halt on first failure, digest carrying the native error — "never replace a missing or invalid native result with a player-visible local fallback" is the executor's contract. Wall (each wrong swing drains health): actionrate **10/10 at 6–11 calls, repFail=0**; (e)'s escalation machinery went **6/10, all four failures pinned at the 40-call cap**, repFail up to 20. Conceded: stop-on-failure catches step failure, not plan-level wrongness; the digest is the transport the model corrects from, combo is where correction gets memory.

**3. "(e) contains your mechanism as its small brain" (async Anticipated 4; reflect; library).** Measured, the container is the cost. Aggregates: code-brain async locked **10/10 at 18.4 mean calls, idle 0.383, repeated failures 12.4, recovery_ticks_mean 1593** (≈4.6 game days [reasoning]); the flash small brain — the owner-ordered benched variant — posts **idle 0.527/0.565/0.733** (locked/toy2-locked/toy2-wall), the round's highest idle ratios, **8/10 locked at 36.8 mean calls, 0/20 on toy2, every run pinned at the 45-call cap**. The small brain that works *is* my executor; what (e) adds (detector, safe-hold, queue, rulings) measured at repFail 12.4 vs my 0.0, wall 6/10 vs my 10/10, idle at or above round-1's blocking loops (0.28–0.38). (d) + (b)'s store (`combo`) hits the same composition at 9–11 locked calls, 10/10.

**4. "Skills are per-game data in disguise / the shipped reflex table" (reflect, round 1).** Concede the reflex tier: `reflexes/stardew-valley.json` ships today and violates the owner's rule; my opening books its migration (declaration-derived safety set plus play-learned entries) as part of the ticket. Skills are the other thing: runtime-learned plugin files — BRIEF.md's exact permitted category — empty on a new game's day one, promoted only after demonstrated reuse. Batched plans are model output per session: the round-2 rows ran the second game with nothing shipped, unlike round-1's authored approaches (0/3).

**5. "Idle-0.00 rows are just fixed executors with no model" (async, reflect, round 1).** Category error: round-1's 0.00 rows (modes/goap/handcoded) decide in code; (d) re-consults the model every batch — 17–24 locked calls prove it. What transfers is the executor's discipline, not its blindness. A halted batch waits one round-trip, once per ≤8 actions instead of once per action — and the architecture claiming to abolish that wait measures idle 0.383–0.733 vs round-1's 0.28–0.38.

**6. "Your mechanism deactivates where the debate is scored" (library, round 2: hostile ground = 1-step batches; locked 17–24 > cold 10–14).** 1-step batches are the model's priced floor, not a deactivation — it was never needed: locked 10/10, repFail=0. I concede locked calls: the knowledge layers earn their edge there (cold 10–14, combo 9–11) by remembering the closure. But the scored matrix includes toy2-locked, where batching halved calls at equal success (Answer 1). And on wall, combo's 7–12 calls equal actionrate's 6–11: library+reflect added nothing to batching where acting, not knowing, was the job. [reasoning]

## New attacks

**(e) async — "exempt by construction, not by tuning" is now a measured falsehood.** (e)'s round-1 defense was that idle "cannot" touch the split. The aggregates: async-llm idle **0.527–0.733** — the worst of any round-2 row, vs round-1 pure-LLM 0.28–0.36 — and code-brain async 0.383. The amendment named the split's proof metrics: `actions_per_game_minute` and recovery time. Async locked measures **0.0033 actions/game-minute** and **recovery_ticks_mean 1593 over all 10 runs** — days-scale recovery, the P2-0019 signature — and toy2-locked seed 6 logged **84 repeated failures** in one run. Slowest recovery, worst grinding, highest idle: the pitch was "the body busy while learning happens."

**(b) library — its round-2 economics quotes its weakest rows; its reader is unmeasured.** Its Answer 6 claims my round-1 skills row (0.0 calls, 7.2 s) as "my architecture on a fixed executor" — conceded: the 6x wall-clock win is the executor's; the library rode it. Its Answer 1 cites cold rows (10–14 calls), but the warm row — the cross-session claim this round exists for — shows so far at **9–12 calls (locked seeds 1–9, mid-run, unofficial)**: a 1–3 call saving over cold, where discovery is cheapest [reasoning]. Where compounding would matter (toy2-locked, where discovery kills seeds at the 45-call cap), no warm row is visible yet. The measured cross-session delta is so far a rounding error, matched by reflect's 10–13 — a loop that relearns in-run without (b)'s machinery.

---

# round-2-async

# Async (e): cross-examination, round 2

Sources: round-1/round-2 transcripts, my opening, BRIEF.md, dsh-facts.md,
bench/README.md. Orchestrator-provided aggregates—code brain (`async`): locked
10/10 @ 18.4 calls, idle 0.383; wall 6/10 @ 23.4; toy2-locked 7/10 @ 14.1;
toy2-wall 10/10 @ 8.9. Flash brain (`async-llm`): locked 8/10 @ 36.8; wall 2/10
@ 37.9; toy2 0/10 @ 45, cap-pinned. [reasoning] marks inference.

## Answers

**1. "'Exempt by construction' is a measured falsehood" (actionrate).**
Concede the numbers. The 0.527–0.733 idle rows are the flash small brain, the
optional upgrade my opening §6 benched to answer the owner's cheap-model
question. It failed: 0/20 on toy2, cap-pinned, double the code brain's calls.
That is my declared null hypothesis tested and rejected—verdict "must be pure
code," the default. Its failures localize as predicted [reasoning]: per-step
flash judgments burn turns between steps. Code-brain 0.383 is deliberate
outbox-visible plan-boundary/safe-hold idle (§4); conceded, here my body holds
while rulings turn.

**2. Escalation latency / "strictly more stages" (reflect, actionrate).**
Conceded and pre-registered: my opening called `recovery_ticks_mean` "an open
spike item" with a goal-driver/profile remedy. Correction: day 5 begins at tick
1400 (bench/README.md); on locked nothing succeeds earlier, so recovery for any
architecture tripping its dominant signature early is floored near 1,300–1,400
ticks; 1593 is ~15% over the scenario's clock [reasoning]. The discriminative
defect is the grinding inside that window—see 3. Delivery rides the pre-step
listener turn markers use today.

**3. "The machinery rehearsed the grinding" (library, actionrate: repFail 12.4, range 5–35, seed 84).**
Conceded entire. [reasoning] Detection fired at K=3, but the storeless
prototype's big brain re-planned the same wrong approach—no lesson store,
`newShared()` per run; round-1-library/curriculum were right—and per-plan
counters re-armed each re-plan. Both fixes are the design's: the store is (b)'s
owner-agreed layer (my §7); the re-plan policy—check ledger and falsifier before
re-issuing—is a big-brain rule. Control in the matrix: combo—library +
stuck-reflect + batching, the row bench/README.md files under "(option e)"—10/10
at 9–11 locked calls, zero repeated failures (round-2 raw rows).

**4. "Wall rows fail where the plain baseline cleared 10/10" (actionrate, curriculum).**
Conceded: 6/10 @ 23.4, four failures pinned at the 40-call cap, vs the
baseline's 10/10 at 7–13 (round-1-actionrate). The baseline re-decides every
turn—on wall its virtue is stumbling sideways—while my prototype's big brain
re-planned inside the same frame [reasoning]. The fixes it exposes are the
design's: wall re-plans must test the falsifier; the escalation threshold must
count across re-plans, not reset per plan. Against structural readings:
toy2-wall 10/10 @ 8.9—same machinery, fresh game, no store.

**5. "No lesson tool / memoryless big brain; ExpeL sediment" (library, curriculum).**
Scoping conceded, inference corrected: bench/README.md charges each approach as
"a minimal prototype of one debate architecture"—store to the library rows,
channel to mine—and the owner already adopted (b)'s storage (BRIEF.md; my §7
adds trigger and read path). ExpeL's 29.0-vs-39.0 sediment result hits
episodes-as-insights; my §7 writes tagged, template-shaped lessons only on
verified game outcomes—a trigger (b) lacks. Conceded: "through the existing
remember/dream_commit ledger path" overstated transport—lessons belong in the
library schema, not the mood ledger.

**6. "Day one, no plan—the body waits on the model" (reflect, curriculum).**
Conceded at the boundary: before the first plan the split is as synchronous as
the baseline—one `plan_submit` call plans up to 8 body calls (bench/README.md).
The claim was steady state: big-brain work runs while a plan executes or
safe-holds. toy2 is day one for every seed—fresh game, no store possible—and
there the code brain went 7/10 @ 14.1, matching actionrate's successful seeds
(12–16 calls, same 7/10—its round-2 answer).

**7. "(d)'s executor is my degenerate case," turned against me (actionrate).**
The framing concedes containment—my claim first (opening Anticipated 4); the
dispute is what the rest buys. Storeless remainder negative (answer 3);
remainder plus store, combo leads the matrix; the async-clock remainder is
unpriced here—no scheduler, queue, or mid-turn model interrupt (dsh-facts.md;
opening §4)—so the matrix runs my channel synchronously, pricing (d) plus
escalation overhead, not my clock. A documented harness limit, not an excuse:
the synchronous skeleton still cleared locked 10/10 and both toy2 rows.

**8. Two brains, nondeterminism, "unearned complexity."**
One flag (`smallbrain=code` vs `flash`) made every failure attributable—the
debuggability the attack demands; code rows replay deterministically; the flash
upgrade was priced and rejected by numbers. Complexity here is falsifiable:
"its mistakes are counted by the bench, not argued" (Anticipated 5).

## New attacks

**(a) reflect—the scoping double standard, and a trigger priced at zero.**
Her round-2 Answer 1 excuses her prototype's in-run lessons as "bench scoping—
each approach is a minimal prototype of one debate architecture." The identical
standard excuses my memoryless big brain, which she prosecutes as real failure.
Her unique part is the K=3 trigger, and the matrix prices it: reflect locked
10/10 at 10–13 calls vs library-cold 10/10 at 10–14 (round-1-library,
round-2-library)—the writer-without-store buys nothing over the cold control—
while her cross-session claim rests on (b)'s layer-2 shape, conceded "a file
format, not an architecture" (round-2-reflect).

**(b) library—its round-2 demotion mechanism is my ledger, unnamed.**
Answer 5: "the plugin sees every body result, and a verified failure flips the
lesson to contested in-turn... no rewrite storm." Flipping which lesson? A
failing body task arrives with no lesson id attached; attributing a blocked walk
to the closure lesson rather than a route lesson is signature matching over
failing tasks—the machinery bench/README.md defines for repeated-failure
counting. Without it the safe policy flips every plausibly related entry—the
rewrite storm she denied; with it her "mechanical" correction presumes my
detector [reasoning].

**(d) actionrate—its dividend over my code brain is a rounding error.**
Its toy2-locked successful seeds ran 12–16 calls at 7/10; my code brain 7/10 @
14.1—~0–2 calls' edge, for an architecture with no store, no trigger, no plan
that survives the turn, conceding "no world-fact discovery" and "step failure,
not plan-level wrongness."

