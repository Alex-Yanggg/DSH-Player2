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
