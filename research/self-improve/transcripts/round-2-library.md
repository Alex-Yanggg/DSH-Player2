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
