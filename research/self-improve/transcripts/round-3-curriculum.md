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
