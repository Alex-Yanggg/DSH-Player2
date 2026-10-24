# Advocate (b): the library — a persona-level memory the companion starts knowing

Round-2 opening statement. Author: advocate for option (b). Sources I fetched
myself are listed in [sources-library.json](sources-library.json); citations
from the shared notes files are reused as permitted by BRIEF.md.

---

## Claim

The companion's growth should live in a **persona-level library shared across
saves and sessions**: lessons (world facts, route lessons, player-preference
facts) and optionally learned skills, persisted per save in the plugin's own
files, keyed by the game's own save identity, and **loaded transparently into
the prompt every session** — the model never "loads memory," it just starts
knowing. Only cross-session persistence makes growth compound: in P2-0019 the
companion lost days to a mine closed until spring day 5; under a library that
failure is **permanently fixed after one bad experience**, because the lesson
is written once and rendered into every later session for free. DSH 0.2.0-rc.2
ships **no memory service** (dsh-facts.md §2, §4 — no store, no cross-save
identity), so the plugin must own persistence, and plugin files + persona
prompt sections + render-time persona variables are exactly the DSH-native
shape for it. Retrieval from a library is also the cheapest architecture in
LLM calls we have ever measured in this repo: in the round-1 bench the skills
approach scored **mine 8/10 at 0.1 mean LLM calls and farm 10/10 at 0.0**
(steady-state library retrieval; real API calls —
`origin/behavior-research:research/behavior-debate/REPORT.md`). Every other
option either re-pays its cost every session (reflect, curriculum) or only
speeds up a mind that still starts empty (actionrate). The library is the only
option whose unit of progress — a written, inspectable, correctable lesson —
survives the session in which it was learned.

## Mechanism

### What lives where (file schema)

The repo already has the pattern: the persona ledger keeps one directory per
person beside the save sessions, with cross-save `person.json` traits and
per-save files under `saves/<save>/`, append-only, capped, with
importance-based forgetting (`packages/dsh-companion-plugin/src/mind/ledger.ts`:
`EPISODES_PER_SAVE = 2_000`, `ACTIVE_TRAIT_LIMIT = 24`; a damaged line is
skipped and counted, a damaged person file is a loud error). The library is the
same shape, one level up — distilled lessons instead of raw episodes:

```text
<ledger root>/                      # per companion person (ledger.ts precedent)
  person.json                       # existing traits; add: game-agnostic play principles
  saves/<save-id>/
    lessons.jsonl                   # one JSON line per lesson, append-only
    skills/                         # optional promoted routines, exposed via dsh-skill
```

Lesson line (extends the ledger's episode schema; every field is inspectable
plain text):

```json
{
  "id": "ls-4f19a2c8",
  "kind": "world-fact | route | approach | player-pref",
  "text": "The mine pass is closed until the morning of day 5 in spring.",
  "confidence": "provisional | verified | contested",
  "support": { "successes": 1, "failures": 0 },
  "asOf": { "gameDay": 3, "season": "spring" },
  "evidence": ["ep-…"],
  "source": "observed | searched",
  "updatedAt": "2026-10-24T18:42:00Z"
}
```

`kind` is game-neutral vocabulary, not game content. Lessons are written in
game words (no coordinates, no project terms — the repo's product rule for
player-visible words); coordinates stay in the evidence refs, which are log
data, not speech.

### Save identity

The save id is **the game's own unique save id, declared by the adapter**. The
mod is a pure raw-state-out adapter (BRIEF.md), so save identity belongs in its
declared state, exactly like any other world fact. In Stardew this id exists
and is readable by mods at runtime: the fetched FamilyPlanning mod source reads
`Game1.uniqueIDForThisGame` and uses it as a deterministic per-save seed
(https://raw.githubusercontent.com/loe2run/FamilyPlanningMod/master/FamilyPlanning/CustomBirthingEvent.cs)
— a working precedent that a SMAPI mod can export the real save id today.
Today the ledger already keys its store by the save segment of the session
directory (`PersonaLedger.forSession` parses `…/projects/<person>/sessions/<save>`;
`SAVE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/` in ledger.ts), and the plugin
config already carries a game id ("Game id episodes are filed under",
`packages/dsh-companion-plugin/src/index.ts`). So: adapter-declared id when the
game exposes one (Stardew does), session-directory segment as the bridge-level
fallback, and **watermarking as the last resort** for games with no readable
id (speculation: on first session the bridge writes a stable random id beside
the save and the adapter echoes it in its state — degraded to one library per
install, but functional). The wrong-save failure mode is structurally the same
as a damaged file: the ledger's policy (skip and count; loud error for identity
files) covers it.

### When entries are written (the events)

Writes are **budgeted and event-gated**, riding events the plugin already sees
(`TurnMarker` kinds `chat | day-start | day-end | resume | world`, index.ts):

1. **`day-end` distill (the main writer).** One model call per game day turns
   the day's verified episodes into candidate lessons. This is Generative
   Agents' threshold-bounded reflection pattern (importance-sum threshold 150
   → only 2–3 reflections per agent-day,
   https://ar5iv.labs.arxiv.org/html/2304.03442) applied at day granularity —
   a fixed, predictable cost, not per-event reflection.
2. **In-turn corrective writes.** The plugin already sees every body-task
   result; a verified failure (the locked-mine walk ends `blocked`) is visible
   without any stuck-detection machinery, and the model may record the lesson
   with a `library_learn` call in the same turn it reacts. RSIAgent's lesson
   unit is exactly this: "reusable causal relationships between actions,
   conditions, and consequences" distilled from environment feedback
   (https://arxiv.org/html/2609.15364v2).
3. **Sourced facts after a search.** When a rare `web_search`/`web_fetch` is
   granted, the fetched fact is cached as a `source: "searched"` world-fact —
   dsh-facts.md's own recommendation ("search sparingly, cache results in
   plugin files"). The search, not the memory, is the expensive part; the
   library makes each search at-most-once.
4. **Reconcile on close/resume.** One call per session: dedupe, merge,
   qualify unsupported claims, resolve contradictions. This is RSIAgent's
   distill-then-reconcile loop
   (https://arxiv.org/html/2609.15364v2) and Mem0's extract-consolidate
   pipeline (https://arxiv.org/abs/2504.19413).
5. **Skill promotion (optional, success-gated).** A routine that succeeded
   repeatedly may be promoted into `saves/<save>/skills/` and exposed through
   the `dsh-skill` catalog. Gate = only verified successes, per AWM's online
   rule (only evaluator-labeled successes induce workflows,
   https://arxiv.org/html/2409.07429v1) and Voyager's self-verification critic
   (https://ar5iv.labs.arxiv.org/html/2305.16291).

Nothing is ever written from the model's claim alone: promotion to `verified`
requires the game's own observable outcome, RSIAgent's verifier discipline
(verifier grounded in environment feedback, isolated from the actor's
reasoning, https://arxiv.org/html/2609.15364v2) — the same standard the repo
already applies to native results.

### How lessons get into the prompt (transparent loading)

Two tiers, both rendered by the plugin on every turn — the model does nothing:

- **Pinned core sheet.** The plugin already injects a `player2` context kind
  before each turn (index.ts `MessageSourceMap`) and binds persona rows into
  the system prompt; `dsh-persona` renders `{{…}}` template variables **at
  render time** (dsh-facts.md §2), so a persona row pointing at the lesson
  sheet is always current. The sheet is a **fixed-size block**: top lessons
  selected by recency × confidence × relevance to the active goal (the
  Generative Agents retrieval score — exponential recency decay 0.995/hour,
  LLM-assigned importance, cosine relevance,
  https://ar5iv.labs.arxiv.org/html/2304.03442 — with relevance v1 computed
  from goal text rather than embeddings; simpler and label: design choice,
  sufficiency untested). This is MemGPT's working context: "a fixed-size
  read/write block" held in main context holding "key facts, preferences, and
  other important information" (https://arxiv.org/html/2310.08560v2), and it
  is the shipped shape of Letta memory blocks: "memory blocks that are
  attached to an agent are in-context (pinned to the system prompt)" and
  agents edit them "via memory tools" (https://docs.letta.com/guides/agents/memory).
- **On-demand tail.** Everything past the sheet is behind a `library_query`
  tool (plain search over the plugin's own JSONL; `ctx.sessionQuery` SQLite
  FTS5 if the one-row FTS-enabling profile patch is applied — dsh-facts.md §2).
  ExpeL's authors flag that "truly lifelong agents" need retrieval over the
  insights themselves (https://ar5iv.labs.arxiv.org/html/2308.10144); the two
  tiers give that without paying it every turn.

Trimming is by construction: character budget on the sheet, per-kind quotas,
confidence- and recency-weighted selection, and ExpeL's importance-count decay
(ADD starts a count; DOWNVOTE decrements; zero removes the insight,
https://ar5iv.labs.arxiv.org/html/2308.10144) plus the ledger's existing
importance-based forgetting as the eviction engine.

### Stale and wrong lessons (the landslide opens)

Staleness is handled by **making time visible and letting play correct the
record** — never by coding game rules (the owner forbids hardcoded game facts):

- Every world-fact carries `asOf` (game day/season). "Mine pass closed until
  spring 5" rendered on spring 5+ reads to the model as an outdated hypothesis,
  and the first successful walk is itself a verified event that updates the
  lesson to verified-and-open. No calendar logic in code — the model reconciles.
- A **verified failure against a lesson** is the strongest write event: it
  demotes the lesson to `contested` in-turn, and the next reconcile rewrites
  or deletes it (ExpeL DOWNVOTE→zero; Mem0's consolidation "resolves
  contradictions against stored memory", https://arxiv.org/abs/2504.19413;
  A-MEM's evolution — "as new memories are integrated, they can trigger
  updates to … existing historical memories",
  https://arxiv.org/abs/2502.12110).
- CLIN's stove-lesson failure (it "repeatedly retrieves" the outdated insight
  and fails the gallium task, https://ar5iv.labs.arxiv.org/html/2310.10134) is
  the cautionary tale, and the difference is that CLIN has no asOf stamp, no
  confidence tier, and no failure-triggered demotion. We ship all three.
- Honest cost accounting: a stale lesson can cost **one wasted encounter** —
  that encounter is the correction signal. That is strictly better than the
  no-memory alternative, which re-pays the *entire* discovery cost every
  session.

### Fresh save vs old save

- **Old save:** the sheet renders on the first turn of the session. The mine
  lesson means the companion routes around the closure (or waits it out with
  the goal's own permission) on day one. Growth from all prior sessions is
  immediately live.
- **Fresh save:** the save sheet is empty — rendered as a two-token "no
  lessons for this save yet" — and the companion behaves exactly like today's
  product, no worse. Person-level principles and player preferences still load
  (the ledger's cross-save `person.json` is precedent). Growth starts with the
  first distill, so a brand-new save pays today's cost **once**, then never
  again for the same lesson.

### What is shared vs what stays per-session

- **Persona-level, cross-save (`person.json`):** player-preference facts and
  game-agnostic play principles ("verify a blocked route before re-walking
  it"). This is the companion's personality growth.
- **Per save (`saves/<save>/`):** world facts and route lessons — mine
  closures, NPC schedules the player taught it, which lever opens which gate.
- **Per session only:** working context — the current goal, today's
  observations, in-flight plans. DSH already covers this (session persistence
  + resume + compaction, dsh-facts.md §2). Raw transcripts are never the
  memory; the lesson is the memory (Reflexion stores reflections, not
  trajectories, https://ar5iv.labs.arxiv.org/html/2303.11366).

### Permission boundary

Library growth rides the **existing delegated-play permission** and adds no
autonomy: writes happen only inside played sessions, there is no background
loop, no scheduled reflection while the player is away, and no behavior the
player cannot read in `remember.md`-style plain files and reset by deleting a
directory. The only egress is the wiki search itself (DeepSeek provider via
the DSH web seam; each search costs a full model turn — dsh-facts.md §1, §4),
which is already the documented, revocable network request, and its results
are cached locally so it is paid at most once per fact.

## How it fits the DSH seams

Verified seams only (dsh-facts.md is the source for every claim in this
section):

| Concern | Seam | What lives where |
| --- | --- | --- |
| Storage | **Own plugin files** | `saves/<save>/lessons.jsonl`, `person.json`, skills — the memory-ledger pattern already shipped in `mind/ledger.ts`. No DSH memory service exists; plugin files are the only cross-session store (§4: "no API to copy learned state between sessions other than files the plugin writes"). |
| Transparent load | **Prompt sections + persona rows + render-time variables** (`dsh-persona` §2; the plugin's existing `systemPrompt` inject and `player2` pre-turn context) | The pinned lesson sheet, rendered per turn from the files. `agent/pre-step` (already used for turn markers) attaches per-turn lesson context. |
| Model-facing write tools | **Plugin-registered tools** (beside existing `remember`/`dream_commit`) | `library_learn` (add/update/challenge a lesson), `library_query` (search the tail). |
| Optional retrieval upgrade | **`ctx.sessionQuery`** (SQLite FTS5 over past sessions) — **only if FTS were enabled** | Cross-session text search is mounted in acp but with `path: ':memory:'` and `openAt: never` — disabled by default; enabling it is a one-row profile patch (§2). v1 does not need it: `library_query` over the plugin's own JSONL needs no DSH change. |
| Skill promotion | **`dsh-skill` + `dsh-skill-filesystem` + `dsh-tool-skill`** (§3, all mounted in acp) | Learned routines as catalog entries discovered from the plugin's skills directory, loaded on demand. |
| Sourced world facts | **`ctx.web` / `tool-web`** (§1, mounted in acp) | Rare, player-visible wiki lookups; results cached into the library. |
| What I deliberately do NOT use | spill store (write-once, no retrieval — wrong shape), goals (goal persistence is not memory), hooks (nothing to block) | — |

Nothing here reaches into Harness internals, patches DSH, or hardcodes a game
fact; the only DSH-adjacent ask is the optional one-row FTS profile patch,
which dsh-facts.md already describes as a shipped configuration change.

## Best evidence

**From this repository (measured, real API calls):**

- Round-1 bench, `origin/behavior-research:research/behavior-debate/REPORT.md`:
  the **skills** approach — a library, retrieved — scored **mine 8/10 at 0.1
  mean LLM calls** and **farm 10/10 at 0.0**, versus the pure-LLM loop's 5/10
  at 6.7 calls on mine. One authoring run paid 1–3 calls; every later session
  retrieved at ~zero. That is the library's economic core demonstrated on this
  repo's own sim. (Round-2 matrix numbers are pending; I quote nothing
  unmeasured.)

**From the shared notes (fetched there; reused per BRIEF):**

- **CLIN** — frozen models, all learning in persistent textual memory; beats
  Reflexion by 23 absolute points on ScienceWorld (abstract,
  https://arxiv.org/abs/2310.10134); **meta-memory** condenses per-episode
  memories into cross-environment/cross-task abstractions — zero-shot +4
  (Gen-Env) and +13 (Gen-Task) points, then +17/+7 more from continued memory
  updates (https://ar5iv.labs.arxiv.org/html/2310.10134). Direct proof that a
  persistent, structured memory is the improvement surface when weights are
  frozen — which is exactly our situation.
- **ExpeL** — insights distilled once from training experience, then applied
  in a **single attempt** ("a student studying for an exam and then taking it
  on a single attempt", https://ar5iv.labs.arxiv.org/html/2308.10144);
  ALFWorld 59.0 vs ReAct 40.0; and the ablation that matters for us: on
  ALFWorld, insights-only 50% / retrieval-only 55% vs **59.0 combined** — the
  library (insights) and retrieval belong together.
- **Voyager** — the skill library persists across the whole run and **transfers
  to fresh worlds**: zero-shot new-world solves 3/3 seeds, and even a
  different base agent given Voyager's library partially succeeds (compass
  2/3) — "a plug-and-play asset" (https://ar5iv.labs.arxiv.org/html/2305.16291).
  The existence proof that game-learned libraries outlive the session, the
  world, and even the policy that made them.
- **Agent Workflow Memory** — workflows induced from earlier tasks improve
  success by 24.6% (Mind2Web) and 51.1% relative (WebArena) **while cutting
  steps from 7.9 to 5.9** (https://arxiv.org/abs/2409.07429v1,
  https://arxiv.org/html/2409.07429v1): the library is not just correctness,
  it is the latency play — learned routines are fewer round-trips, which is
  option (d)'s goal delivered as a side effect of memory.
- **RSIAgent** — the strongest recent RSI result improves **memory only**
  (weights frozen): the loop distills "reusable causal relationships between
  actions, conditions, and consequences" into memory files, reconciles them
  after each wave, and **freezes and hash-checks the memory before test-time
  reuse** (https://arxiv.org/abs/2609.15364, https://arxiv.org/html/2609.15364v2).
  RSI added ~7 points partial on OSWorld. The artifact that carries RSI is a
  library.
- **Generative Agents** — the persona-side retrieval score (recency ×
  importance × relevance) and threshold-bounded reflection that keeps
  reflection to 2–3 per agent-day (https://ar5iv.labs.arxiv.org/html/2304.03442)
  — the ranking and budget for our sheet.

**Fetched for this statement:**

- **MemGPT** — tiered memory where main context = system instructions + a
  fixed-size read/write **working context** + FIFO queue, with recall and
  archival storage behind retrieval; "memory edits and retrieval are entirely
  self-directed" (https://arxiv.org/abs/2310.08560,
  https://arxiv.org/html/2310.08560v2). Its multi-session chat claim — agents
  that "remember, reflect, and evolve dynamically through long-term
  interactions" (https://arxiv.org/abs/2310.08560) — is our feature, in the
  OS-analogy form: pinned core, paged tail.
- **Letta memory blocks** (the production descendant of MemGPT) — "memory
  blocks that are attached to an agent are in-context (pinned to the system
  prompt)," editable by the agent "via memory tools," and state persists "so
  they are never lost, even once evicted from the context window"
  (https://docs.letta.com/guides/agents/memory). A shipped product whose
  memory model is exactly our proposal: transparent pinned blocks + tool-based
  self-editing.
- **A-MEM** — Zettelkasten-style atomic notes where "as new memories are
  integrated, they can trigger updates to … existing historical memories"
  (https://arxiv.org/abs/2502.12110): the reconcile step has literature
  behind it, not just intuition.
- **Mem0** — dynamic "extracting, consolidating, and retrieving salient
  information" beats full-context baselines with **26% relative improvement
  over OpenAI** and, against processing the entire history, **91% lower p95
  latency and >90% token-cost savings** (https://arxiv.org/abs/2504.19413) —
  the quantitative case that curated memory beats ever-growing context on
  both quality and cost. (The paper's ADD/UPDATE/DELETE update operations are
  in its body; I could not verify them verbatim on the fetched abstract page —
  uncertain.)
- **Stardew save identity** — a shipped SMAPI mod reads
  `Game1.uniqueIDForThisGame` at runtime and uses it as a deterministic
  per-save seed (https://raw.githubusercontent.com/loe2run/FamilyPlanningMod/master/FamilyPlanning/CustomBirthingEvent.cs):
  the game's own save id is real, stable, and mod-readable — the adapter can
  export it as declared state. (The official wiki's save pages return HTTP
  403 to automated fetches; this mod source is my fetched evidence.)

## Extensibility across games

The judge weights this above everything, so here is the honest ledger.

**What is game-agnostic by construction.** The entire machinery — the JSONL
schema, the store, the save-id plumbing, the pinned-sheet renderer, the
trimmer, the reconcile pass, the `library_learn`/`library_query` tools —
contains zero game words. `kind` is four game-neutral categories; the save id
comes from the adapter's declaration, not from code that knows Stardew; the
reconcile rules are content-agnostic text operations. On a second game the
plugin's code does not change; a new adapter declares a new save id, and the
same store/loading/trimming machinery runs. The round-2 bench is built this
way: the same `library` approach module runs on the Stardew sim and the toy2
Keycraft variants, keyed by each scenario's save id (bench/README.md). This is
the difference between a library and option (a)'s reflect loop: a lesson
store has no per-game logic to port, because **the game's knowledge lives in
runtime-learned data files, which the owner explicitly permits** — what is
forbidden is shipped per-game tables in code, and the library ships none.

**The cold-start problem, stated plainly.** On a NEW game the library is
empty. Everything the companion knows about the new game must be earned in
play or granted via search; the first session pays today's full cost, and
round-1's toy2 warning stands — the one-shot authoring architectures scored
0/3 on the new game, and nothing in the library thesis contradicts that
finding, because **the library never claims one-shot authoring on an unseen
game; it claims that experience, once paid, is never re-paid.** Bootstrapping
on a new game is therefore the loop itself: play → day-end distill → next
session starts knowing. The accelerants are compositions, not prerequisites:
a bounded exploration survey (option c) is the fastest first-week writer, and
a stuck-reflect step (option a) is the fastest failure writer — but the
library is the substrate both would write into, and it grows usefully without
either (event 1 and event 2 above run on plain verified outcomes). Cross-game
transfer of content is limited and I do not claim it: ExpeL's cross-domain
transfer (HotpotQA → FEVER, 70 vs ReAct 63, https://ar5iv.labs.arxiv.org/html/2308.10144)
needed re-grounding, and Stardew lessons are Stardew facts. What transfers
across games is the machinery, the person-level player preferences, and the
generic principles — which is exactly what a persona-level store should hold.

## Anticipated attacks and my answers

**1. "A library needs something to WRITE into it — alone you have no
stuck-reflection or search, so who fills it?"**
The writes I defined need no stuck detector and no search to start. Event 2
fires from results the plugin already receives: a body task that ends
`blocked` is a verified failure visible without any detection code, and the
model records the lesson in the turn where it reacts — one tool call inside a
turn it was already taking. Event 1 (day-end distill) is one call per game
day over episodes the ledger already stores; Generative Agents ran
threshold-bounded reflection at 2–3 per agent-day, so this is a bounded,
predictable tax, not a second architecture. RSIAgent's memory grew from
exactly these signals — "verifier verdicts, execution feedback, environment
observations" (https://arxiv.org/html/2609.15364v2) — not from a separate
reflection subsystem. And the round-1 datum answers the economics: the
authoring cost was paid once (1–3 calls) and every later session retrieved at
~0.0–0.1 mean calls (`origin/behavior-research` REPORT.md). I will concede the
strong form honestly: option (a)'s reflect loop is a *better writer*, and
composition (library + reflect) is the natural end state. But the store is
the load-bearing half — a reflect loop with nowhere persistent to write is
Reflexion's WebShop run: effort paid per session, gone by the next.

**2. "Lessons go stale (the landslide opens) — wrong lessons are worse than
none."**
Wrong lessons are worse than none *that never get corrected*; mine are
designed to self-correct. Three mechanisms: (i) `asOf` stamps — the lesson
says "closed until spring 5, observed spring 3," so on spring 5 it reads as
an expired hypothesis, and the model re-tests rather than obeying; (ii)
failure-triggered demotion — the first `blocked`-or-success contradiction
flips confidence to `contested` in-turn and the next reconcile rewrites or
deletes it; (iii) confidence tiers mean contested lessons render flagged as
hypotheses, never as commands. The failure mode CLIN demonstrated (stale
stove insight retrieved forever, https://ar5iv.labs.arxiv.org/html/2310.10134)
lacks all three. Residual risk, stated: the *first* encounter after expiry
can waste one walk — bounded, and it is the very signal that fixes the
record. Compare the alternative: with no library, the day-5 discovery is
re-paid every session for the life of the save.

**3. "Cross-save identity: mods can't always read the real save id."**
In the supported game, it can: `Game1.uniqueIDForThisGame` is read by a
shipped mod at runtime as a per-save seed (fetched:
https://raw.githubusercontent.com/loe2run/FamilyPlanningMod/master/FamilyPlanning/CustomBirthingEvent.cs),
so exporting it in the adapter's declared state is an adapter change, not a
game hack. If a future game exposes no id, I degrade gracefully, in order:
session-directory segment (already the ledger's key, ledger.ts
`forSession`), then watermarking (speculation: bridge-written stable id
echoed by the adapter) — costing at most library-per-install granularity.
Identify-wrongly behaves like file damage, which the ledger already handles
by policy (skip and count; loud error for identity files). I accept a
watermarked library per install as a degradation, not a failure.

**4. "Prompt bloat as the library grows."**
The prompt never sees the library; it sees a bounded sheet. The sheet is a
fixed-size block (MemGPT's working-context design,
https://arxiv.org/html/2310.08560v2) with per-kind quotas and
confidence×recency×relevance selection (Generative Agents scoring,
https://ar5iv.labs.arxiv.org/html/2304.03442); eviction is ExpeL's
count-decay-to-zero plus the ledger's existing importance-based forgetting at
`EPISODES_PER_SAVE = 2_000` (ledger.ts). RSIAgent's memory grew to 316,541
bytes without a schema and had to freeze before reuse
(https://arxiv.org/html/2609.15364v2) — we do the opposite and get to keep
growing: structured entries trim mechanically, and the unbounded tail sits
behind `library_query`, loaded on demand exactly as `dsh-tool-skill` loads
catalog entries (dsh-facts.md §3). Mem0's numbers are the context-size proof:
curated memory beat the full-history baseline by ~90% token cost at higher
accuracy (https://arxiv.org/abs/2504.19413).

**5. "Privacy: does anything learned leak between players/saves?"**
Nothing leaves the machine except wiki search queries, which are the one
documented network request, made only on a sourced-fact miss and immediately
cached locally (dsh-facts.md §1: DeepSeek provider via the DSH web seam, one
model turn per search). Between saves of the **same** player: player-preference
facts and generic principles are deliberately shared at persona level — that
is the product promise ("she remembers you"), and `person.json` already does
this today. Between **different** players: there is no channel — the library
is per-person plain files beside that person's save sessions, never synced,
never uploaded; the repo's rule is "player data and credentials stay local by
default," and my design adds zero requests beyond the existing search. Between
**saves**: world facts stay under `saves/<save>/` precisely because a lesson
learned on save A can be wrong on save B (different farm layouts); the schema
keeps them separate by default, and cross-save sharing is a player-visible
choice, not a side effect. Everything is inspectable in a text editor and
resettable by deleting a directory — the AGENTS.md requirements, verbatim.

**6. "The ledger already exists — what is new here?"**
The ledger stores episodes (what happened) and moods; the library stores
distilled, typed, confidence-ranked, asOf-stamped **lessons** with a
correction protocol, rendered into the prompt every session without the model
asking. Episodes are the raw ore; the library is the refinery. Reflexion vs
its own ablation is the case for the refinement step: retries that write
nothing stay at baseline (0.60 vs 0.68 on Rust HumanEval,
https://ar5iv.labs.arxiv.org/html/2303.11366), and ExpeL showed raw
reflections fed as insights actually *hurt* (29.0 vs 39.0 on HotpotQA,
https://ar5iv.labs.arxiv.org/html/2308.10144) — distillation into structured
entries is where the gain lives.

**What this does not fix (round 3 will demand it; here it is early).** The
library fixes *knowledge persistence*, not throughput: a companion that knows
the mine is closed still idles at the round-1 gap ratios while a model call
is in flight — that is option (d)'s PTC/batching work. It does not detect
repeated failure *within* a session faster than its own write events allow —
that is option (a)'s stuck detector, and the honest composition is
library-as-store with reflect-as-writer. It does not *explore* — an empty
library plus a passive loop grows slowly; option (c)'s survey is the
accelerant. And it cannot make the first session on a new game cheap: the
cold-start cost is real and paid in play.

## References

Repository artifacts (verified facts, cited by path/branch):

- `research/self-improve/dsh-facts.md` — DSH 0.2.0-rc.2 seam facts (web seam,
  no memory service, persona variables, skills catalog, sessionQuery/FTS,
  gaps and per-option implications).
- `origin/behavior-research:research/behavior-debate/REPORT.md` — round-1
  metric tables (skills: mine 8/10 @ 0.1 calls, farm 10/10 @ 0.0).
- `research/self-improve/bench/README.md` — round-2 matrix design; the
  `library` approach and `library-cold` control.
- `packages/dsh-companion-plugin/src/mind/ledger.ts` — ledger layout,
  `forSession` save segment, `EPISODES_PER_SAVE`, trait limits, damage policy.
- `packages/dsh-companion-plugin/src/index.ts` — plugin config (`gameId`),
  turn markers, pre-turn `player2` context kind.
- `packages/contracts/src/knobs.ts` — persona constitution bound into the
  system prompt.
- `research/self-improve/transcripts/notes-classics.md` — Reflexion, Voyager,
  ExpeL, AWM, CLIN, Generative Agents (fetched there; URLs reused below).
- `research/self-improve/transcripts/notes-rsi.md` — RSIAgent, HarnessPro.

Fetched URLs (full list with dates in [sources-library.json](sources-library.json)):

- https://arxiv.org/abs/2310.08560 — MemGPT (abs): memory tiers; multi-session chat.
- https://arxiv.org/html/2310.08560v2 — MemGPT (full text): working context, self-directed edits.
- https://docs.letta.com/guides/agents/memory — Letta memory blocks: pinned in-context, agent-editable.
- https://arxiv.org/abs/2502.12110 — A-MEM: Zettelkasten notes, memory evolution.
- https://arxiv.org/abs/2504.19413 — Mem0: extract/consolidate/retrieve; latency and token-cost results.
- https://raw.githubusercontent.com/loe2run/FamilyPlanningMod/master/FamilyPlanning/CustomBirthingEvent.cs — SMAPI mod reading `Game1.uniqueIDForThisGame` at runtime.

Reused from the shared notes (fetched there, per BRIEF.md):

- https://arxiv.org/abs/2609.15364 and https://arxiv.org/html/2609.15364v2 — RSIAgent.
- https://arxiv.org/abs/2310.10134 and https://ar5iv.labs.arxiv.org/html/2310.10134 — CLIN.
- https://arxiv.org/abs/2308.10144 and https://ar5iv.labs.arxiv.org/html/2308.10144 — ExpeL.
- https://arxiv.org/abs/2305.16291 and https://ar5iv.labs.arxiv.org/html/2305.16291 — Voyager.
- https://arxiv.org/abs/2409.07429 and https://arxiv.org/html/2409.07429v1 — Agent Workflow Memory.
- https://arxiv.org/abs/2304.03442 and https://ar5iv.labs.arxiv.org/html/2304.03442 — Generative Agents.
- https://ar5iv.labs.arxiv.org/html/2303.11366 — Reflexion.
