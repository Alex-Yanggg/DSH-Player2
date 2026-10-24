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
