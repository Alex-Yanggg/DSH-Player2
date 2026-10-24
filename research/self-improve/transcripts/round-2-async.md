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
