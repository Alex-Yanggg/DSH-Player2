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
