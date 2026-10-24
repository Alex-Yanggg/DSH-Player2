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
