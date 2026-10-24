# Advocate (c): the curriculum — learn the world before the goal

Round-2 opening statement. Author: advocate for option (c). Sources I fetched
myself are listed in [sources-curriculum.json](sources-curriculum.json);
citations from the shared notes files (`notes-classics.md`, `notes-rsi.md`) are
reused as permitted by BRIEF.md. The round-2 bench matrix is still running; I
quote no unmeasured numbers — every bench figure below is from the round-1
report or the verified facts files.

---

## Claim

The companion should grow through an **exploration-first automatic curriculum**:
on any save it has not learned yet, it **surveys first** — visits the reachable
areas, reads what the world shows (notices, signs, letters), tries doors and
machines once, and records durable findings in a **field guide** — and only
then works the delegated goal with the guide in hand. This attacks the
P2-0019 failure class at the **root**. Every other option treats the closed
mine *after first contact*: walk to it, get blocked, maybe notice the pattern
(a), file a lesson (b), or escalate to the big brain (e) — three failures and
several lost days are the *entry price* of knowledge. The survey pays once,
up front, in bounded, visible, player-watchable turns, because the fact was in
the world all along: the round-2 locked scenario is built exactly this way, the
closure "is discoverable by exploring (a readable notice board near the start)"
(bench/README.md). It needs **no network**: the wiki (DSH web seam, one full
model turn per search — dsh-facts.md §1) is an optional accelerator for facts
the world does not state, not the source of truth; the world documents itself.
And the field guide is the **natural seed of option (b)'s layers**: a survey is
what *produces* save-level knowledge; the library is what *stores* it. The
library advocate herself concedes "an empty library plus a passive loop grows
slowly" and calls option (c)'s survey "the accelerant"
(transcripts/advocate-library.md) — I am arguing that the producer is the
architecture, the store is its artifact. The cost is bounded and front-loaded:
one budgeted survey per save, then amortized for the life of the save; on every
later session the companion simply starts knowing, which is (b)'s promise,
delivered with a mechanism that actually fills the store.

## Mechanism

### What triggers a survey

Three triggers, all visible to the plugin without new detection machinery:

1. **New save / empty guide.** At the first pre-step of a session, the plugin
   resolves the save's identity and looks for its guide file. No file, or a
   file with no coverage records, means this world is unlearned: the session
   opens in SURVEY phase. (Save identity: the game's own id declared by the
   adapter — the same resolution option (b) needs, and (b)'s advocate already
   established it is mod-readable in Stardew via `Game1.uniqueIDForThisGame`;
   the ledger already keys per-save data by a save segment,
   `mind/ledger.ts` `SAVE_SEGMENT`/`forSession`.)
2. **Uncovered area appears.** The plugin sees `[world day=N]` markers
   (index.ts `TurnMarker` kinds `chat | day-start | day-end | resume | world`).
   A world event or observation naming an area the guide has no entry for can
   open a *bounded local survey* of that area — not a full re-survey.
3. **Goal blocked against an unrecorded obstacle.** `dsh-goal` blocked goals
   "keep a stable policy code + human-readable explanation" (dsh-facts.md §3).
   A blocked goal whose obstacle matches no guide entry triggers one bounded
   route survey of the goal's path — the cheapest possible version of the loop,
   and the direct antivenom for "hits the same wall repeatedly without stepping
   back" (BRIEF.md, the P2-0019 symptom list).

The full survey (trigger 1) runs once per save. Triggers 2 and 3 are
incremental patches, not new phases.

### What the survey directive tells the model

The directive is a **persona prompt section** — a standing policy, not a
behavior tree (the repo's "intelligent software" rule, applied): the model
decides where to go and what counts as worth recording; the plugin only marks
the phase, renders coverage state, and enforces the budget. The bench
prototype's directive (bench/lib/approach-curriculum.ts) is the seed:

> "FIRST follow your standing curriculum policy: learn the world before
> working the goal. … Explore the areas reachable from where you stand …;
> read every notice/sign you find …; try doors and machines you meet; note
> where things are. Record each finding with guide_write(topic, note) —
> durable facts about this world (what is closed until when, what is guarded,
> what opens what). When you have surveyed the reachable world, call
> curriculum_done."

Game words like "notice" and "machine" are the *model's* recognition of
affordances in observations, not code's: the product directive generalizes to
"read what can be read, activate what looks interactive once, record what the
world tells you." No per-game vocabulary ships in code.

The survey is explicitly **read-mostly**: walk, look, read, one press to read a
sign or try a door. It does not farm, collect, sell, craft-for-profit, or
consume resources beyond trivial ones — the line between "learning the world"
and "unattended farming" is drawn in the directive itself and enforced by the
permission boundary below.

### Coverage and termination — when is a survey "done"

Three termination signals, first one wins; all three are game-agnostic:

1. **Model-declared.** The model calls `curriculum_done`, judged against the
   directive's coverage contract ("every area reachable without special tools
   visited; every readable thing read; every distinct interactive thing tried
   once"). This is Voyager's curriculum discipline — tasks proposed by the
   model from its own state, "an in-context form of novelty search"
   (https://voyager.minedojo.org) — with a survey-shaped contract.
2. **Turn budget.** A hard cap on survey model turns, configured with the
   permission grant (bench prototype: 8 turns, `approach-curriculum.ts`;
   the product: a turn count *and* a game-clock budget). The plugin flips the
   phase marker when the budget expires. A lazy or wandering survey cannot
   burn the session.
3. **No-new-findings.** The plugin counts, from its own tool-call log, survey
   turns that produced zero new `guide_write` entries and zero new areas
   observed; K consecutive such turns end the survey. This is code doing
   *bookkeeping*, not decision-making — the model explores, code counts.

Coverage state (areas visited, entries written, budget remaining) is rendered
into each survey turn's context, so the model can see what it has not covered —
the same warm-up/pacing idea as Voyager's drip-fed state schedule (nearby
entities after 5 tasks, biome after 10; notes-classics.md), but shown all at
once as a checklist the model reasons over.

### The field guide schema

One JSONL file per save; entries are the survey's output. `kind` is
**epistemic vocabulary**, not game content:

```json
{
  "id": "fg-4f19a2c8",
  "kind": "closure | hazard | affordance | layout | schedule | unknown",
  "area": "north pass",
  "text": "The north pass is closed until the morning of day 5.",
  "confidence": "observed | reported | inferred",
  "asOf": { "gameDay": 3, "season": "spring" },
  "evidence": ["turn-12: read the notice board"],
  "updatedAt": "2026-10-24T18:42:00Z"
}
```

- `confidence: observed` means the world *showed* it — a sign's text is an
  observation, not a guess. `reported` means a letter or character said it.
  `inferred` means the model concluded it (lowest trust; first to be demoted).
- `kind: "unknown"` is deliberate: "the west gate never opened; reason unknown"
  is a valid entry. The guide records what the companion *does not know* —
  honest gaps that direct a later wiki search or a question to the player,
  instead of silent overconfidence.
- Guide text is written in game words with no coordinates and no project terms
  (the repo's player-visible-words rule); area tags are the model's own names
  for places; evidence refs are log data.

The bench prototype ships exactly this shape at survey scale (`guide_write`
with `topic` + 300-char `note`, deduplicated by note text,
approach-curriculum.ts).

### How the guide is injected for the goal phase

On `curriculum_done` or budget expiry the phase flips to WORK, and the guide
becomes a **pinned prompt section** for every goal turn — the model never
"loads memory", it starts knowing. The bench prototype does the minimal
version: the guide is appended to the WORK system prompt
(`approach-curriculum.ts`: `guideSection` — "- [topic] note" lines). In the
product this rides the seams the plugin already uses: the pre-turn `player2`
context kind and `dsh-persona` rows whose `{{…}}` variables resolve **at render
time** (dsh-facts.md §2), so the section is always current without a model
call. Injection is bounded: a character budget with confidence-and-relevance
selection (design choice, untested sufficiency — labeled speculation), and the
long tail behind a `guide_query` tool, mirroring `dsh-tool-skill`'s on-demand
catalog loading (dsh-facts.md §3). `wait_minutes`-style informed waiting is a
first-class goal-phase behavior: "closed until day 5" converts an impossible
goal into a *scheduled* one.

### How findings survive and get re-verified (stale entries)

The guide persists in the plugin's own files keyed by save id — the only
cross-session store DSH leaves a plugin ("no API to copy learned state between
sessions other than files the plugin writes", dsh-facts.md §4) — in the same
per-save directory shape the ledger already uses (`saves/<save-id>/`,
`mind/ledger.ts`). Survival and correction:

- **Staleness is stamped, not scheduled.** Every entry carries `asOf` game
  time. A "closed until spring 5" entry rendered on spring 5+ reads as an
  expired hypothesis; the model re-tests rather than obeying. No calendar code
  — the plugin stamps and renders, the model reconciles.
- **Contradiction is the correction signal.** The plugin already sees every
  body-task result. The first verified failure against an entry ("open" route
  ends `blocked`) demotes it in-turn to contested; the first success against a
  "closed" entry upgrades it to verified-and-open. This is the verifier
  discipline RSIAgent formalizes — verdicts grounded in **environment
  feedback**, isolated from the actor's own reasoning
  (https://arxiv.org/html/2609.15364v2) — and the same standard the repo
  applies to native results (never paper over a missing signal).
- **Survey entries start more trustworthy than lesson entries.** A lesson
  written after a blocked walk is an inference from a failure; a guide entry
  copied from a notice board is an observation of the world's own statement.
  The confidence tiers encode exactly this difference, and it is why the
  survey produces fewer wrong facts per unit of knowledge than any
  failure-first writer (attack 3 below).
- **Re-verification happens at the boundary, not on a timer.** Entries are
  re-checked when play contradicts them, when their `asOf` window lapses and a
  goal touches that area, or when a new session opens and the plugin flags
  expired hypotheses. There is no background loop, ever.

### Where this sits in the DSH turn flow

- **Phase marking on `agent/pre-step`.** The plugin already listens on
  `agent/pre-step` and parses `[chat|day-start|day-end|resume|world]` markers
  (index.ts, `readMarker`, the pre-step handler at `ctx.on("agent/pre-step")`).
  At session start and on `[resume]` it resolves save id → guide file → phase;
  the phase marker and coverage state are attached to the turn as pre-step
  context. `[resume]` already re-arms a paused goal without a model call
  (index.ts) — the guide load rides the same moment, so a resumed session
  starts knowing with zero extra turns.
- **Model-facing tools.** `guide_write` and `curriculum_done` are
  plugin-registered tools beside the existing `remember`/`dream_commit`
  (index.ts registers tools the same way).
- **Own files.** `<plugin data>/guide/<save-id>/guide.jsonl` plus a small
  coverage record. Inspectable in a text editor; resettable by deleting a
  file. Nothing ships per-game.
- **Survey-as-goal (optional).** For long saves the survey can be held as a
  bounded `dsh-goal` so it survives restarts like any delegated objective —
  including its blocked-goal policy codes as a re-survey trigger. Not required
  for v1.

### Permission boundary: who pays, when it ends, why this is not a bot

- **Who pays:** the player's own delegated session pays, visibly — survey
  turns happen inside a played session, between the player and the game, not
  in an unattended background loop. The player watches it happen and can
  interrupt it like any delegated plan (the delegation contract is
  player-revocable at all times; the paused game holds a goal — index.ts:
  "A paused game is the player stepping away, not a failure: stop and wait").
- **When it ends:** at the bounded termination criteria above — model-declared,
  turn budget, or no-new-findings. Whichever comes first. There is no
  "explore forever" mode; the open-ended, never-terminating part of Voyager is
  deliberately *not* transferred.
- **Why this is not unattended farming:** the survey's action vocabulary is
  read-mostly (walk, look, read, one activation press), it stores rather than
  harvests, it runs under the same explicit, inspectable permission grant as
  delegated play, and its budget is part of that grant. A player who grants
  "work this goal" has implicitly granted "walk around and read signs while
  doing it"; nothing in the survey exceeds the body actions delegated play
  already uses. The player-visible framing is a feature: "she's learning the
  farm" is legible, bounded, and one click to skip.

### Composition with a delegated goal

Default order is survey-then-goal on an unlearned save, because the delegated
goal itself is the thing that grinds blind. Two modifiers keep it honest:
(i) an **urgent goal** (deadline stated in the goal text or by the player)
shrinks the survey to a *route survey* — only what the goal's path crosses,
read on the way (attack 2 below); (ii) on a learned save there is no survey at
all — the guide loads and the goal starts immediately. The survey never
replaces the goal; it front-loads the knowledge the goal needs.

## How it fits the DSH seams

Verified seams only; every claim sourced to dsh-facts.md sections:

| Concern | Seam (verified) | What lives where |
| --- | --- | --- |
| Phase trigger | `agent/pre-step` listener; turn markers `chat/day-start/day-end/resume/world` — the plugin already mounts exactly this (index.ts; `dsh-agent-loop` owns pre-step admission, dsh-facts.md §3) | Save-id + guide-file check at session start and `[resume]`; phase marker + coverage state attached to the turn |
| Survey directive | Persona prompt sections + `dsh-persona` render-time variables (§2) | A standing policy section; coverage state rendered per survey turn |
| Survey tasks / blocked-goal trigger | `dsh-goal` (§3): objectives persist across turns, resume, restarts; blocked goals keep a stable policy code + explanation | Optional survey-as-goal; blocked-policy-code → bounded route survey |
| Recording | Plugin-registered tools beside `remember`/`dream_commit` (index.ts) | `guide_write(kind, area, text, confidence, …)`, `curriculum_done` |
| Storage | **Plugin files** — the only cross-session store (§4: "no API to copy learned state between sessions other than files the plugin writes"); ledger per-save directory precedent (`mind/ledger.ts`) | `guide/<save-id>/guide.jsonl` + coverage record; inspectable, deletable |
| Goal-phase injection | Pre-turn `player2` context kind + `dsh-persona` render-time variables (§2) | Pinned bounded guide section; tail behind a `guide_query` tool like `dsh-tool-skill` (§3) |
| Optional wiki accelerator | `ctx.web` + `web_search`/`web_fetch` via `dsh-tool-web`, mounted in acp (§1); DeepSeek provider, **one full model turn per search** (§1, §4) | Only for `kind: "unknown"` entries the world could not answer; result cached into the guide as `confidence: reported`; searched sparingly, at most once per unknown |
| Batched survey legs (composition, not core) | PTC, `dsh-ptc-runtime-node` mounted in acp (§3) | A survey leg (walk → face → read → record) is an ideal one-program batch; option (d)'s primitive, borrowed |
| Deliberately NOT used | `ctx.spillStore` (write-once, no retrieval — wrong shape, §2); hooks (nothing to block, §3); `dsh-tool-ralph` (human-requested only, §3); auto-review (web profile only, §3) | — |

Zero hardcoded game facts: the directive, schema, kinds, termination criteria,
and file layout contain no game vocabulary; the only game-adjacent input is the
adapter-declared save id, which (b)'s advocate already established is
legitimately exportable (transcripts/advocate-library.md).

## Best evidence

**From this repository (measured or verified):**

- **The failure class the survey fixes is confirmed at the root.** P2-0019: the
  companion "did not know the mine is closed until spring day 5 and lost days
  to it" and "hits the same wall repeatedly without stepping back"
  (BRIEF.md/TASK.md). The round-2 locked scenario reproduces it, and its fact
  "is discoverable by exploring (a readable notice board near the start) or
  via the scenario's simulated wiki" (bench/README.md) — the knowledge was one
  look away from the entire grind. No other option reads the board before the
  first failure.
- **Exploration bootstraps where authored knowledge cannot.** Round-1 toy2
  port: the one-shot authored-data approaches scored **0/3** while the
  interactive tool-loop — the model exploring a new game with its tools —
  scored **3/3 at ~27 LLM calls**
  (`origin/behavior-research:research/behavior-debate/REPORT.md`). On a world
  nothing has authored data for, *looking* is what works; the survey is that
  looking, organized.
- **The library's own economics depend on a producer.** Round-1: the skills
  approach (library retrieval) hit mine 8/10 at 0.1 mean calls, farm 10/10 at
  0.0 — but only after an authoring run paid the discovery cost once
  (same REPORT.md). Retrieval is cheap; *filling* the store is the hard part,
  and the survey is the fastest filler we can build from verified seams.

**From the shared notes (fetched there; reused per BRIEF.md):**

- **Voyager's automatic curriculum — the core result.** The model proposes its
  own next exploration task from agent state and completed/failed lists, "an
  in-context form of novelty search"
  (https://ar5iv.labs.arxiv.org/html/2305.16291; project page
  https://voyager.minedojo.org). Headline: **3.3x more unique items** (63 items
  in 160 prompting iterations), 2.3x longer travel, tech-tree milestones up to
  **15.3x faster** than prior SOTA. The ablation that decides the argument:
  **a random curriculum dropped discovered items by 93%** — the curriculum, not
  raw compute, drives the growth curve. And removing self-verification cost
  −73%, which is why my guide entries carry confidence tiers (attack 3).
- **CLIN's exploration bottleneck — the root-cause witness against passive
  memory.** "Insights come only from self-experience; if the agent never
  reaches the relevant area (art studio example), it never forms the needed
  memory and keeps failing" (https://ar5iv.labs.arxiv.org/html/2310.10134).
  This is option (b)'s structural failure mode on an unlearned save, stated by
  the literature: a store with no explorer stays empty exactly where it is
  needed most.
- **RSIAgent — broad-then-deep exploration is the current RSI state of the
  art.** Stage 1 Broad Recursive Self-exploration (parallel exploration waves),
  Stage 2 Deep (corner cases, hidden constraints, boundary conditions); the
  curriculum agent "selects prerequisite skills, informative variants,
  failure-driven practice" and **decides when to stop** — an explicit stopping
  policy (https://arxiv.org/html/2609.15364v2). Ablation on four tasks: full
  RSI 74.54%, broad-only 65.52%, deep-only 56.50% — **both stages contribute,
  and deep-only fell below baseline on two tasks**: exploration-first, with
  breadth before drilling, is the measured order. Its memory (the artifact RSI
  improved, ~7 points partial on OSWorld) grew from ~110 kB to 316,541 bytes
  *of exploration findings* before being frozen for reuse.
- **Generative Agents — budgeted, threshold-gated reflection.** Reflection
  fires when accumulated importance exceeds a threshold (150), yielding only
  2–3 reflections per agent-day (https://ar5iv.labs.arxiv.org/html/2304.03442)
  — the budgeting pattern behind my turn-budget + no-new-findings termination,
  and the evidence that phase-based cognitive work can be cheap, predictable,
  and bounded.
- **Reflexion's WebShop failure — the caution against reactive-only
  growth.** Reflexion "is unable to solve tasks that require a significant
  amount of diversity and exploration" — it gave up after 4 trials with no
  improvement (https://ar5iv.labs.arxiv.org/html/2303.11366). A growth loop
  that waits for failure to teach it (options a and, in its reactive-writer
  form, b) inherits this ceiling on exactly the saves that need it most.

**Fetched for this statement:**

- **Go-Explore** (Ecoffet et al., arXiv:1901.10995,
  https://arxiv.org/abs/1901.10995) — the hardest-exploration games are won by
  **"remember previously visited states"** and **"first return to a promising
  state (without exploration), then explore from it"**: mean score over 43,000
  on Montezuma's Revenge, roughly 4x the prior state of the art. The field
  guide is the LLM-native archive: remember what the world showed, return with
  it, act from knowledge instead of search. Even a time-pressured arcade game
  rewards archiving before grinding — evidence against the "only sandboxes
  reward exploration" attack.
- **Curiosity-driven exploration** (Pathak et al., ICML 2017,
  https://arxiv.org/abs/1705.05363) — prediction-error curiosity alone, with
  **no extrinsic reward**, learns navigation and combat behaviors ("curiosity
  pushes the agent to explore more efficiently"), and with sparse rewards
  "curiosity allows for far fewer interactions with the environment to reach
  the goal". Exploration is not a luxury bolted onto the goal loop; it is the
  mechanism that makes the goal loop cheap.
- **Open-Ended Learning in XLand** (DeepMind, arXiv:2107.12808,
  https://arxiv.org/abs/2107.12808) — dynamically changing "the training task
  distributions and training objectives" so that "the agent never stops
  learning" produced agents that "score reward in every one of our humanly
  solvable evaluation levels" and generalized zero-shot to held-out games,
  with emergent "trial-and-error experimentation, simple tool use". Dynamic
  task generation is the field's proven route to cross-game generality — the
  judge's weighted criterion — and it is precisely what my survey directive
  is, in miniature and in-context.
- **Pangu-Agent** (arXiv:2312.14878, https://arxiv.org/abs/2312.14878) —
  agents "perform and adapt far better when organised reasoning and prior
  knowledge are embedded": the survey directive is organised reasoning with
  *no game facts in it* — the legitimate kind of prior, embedded as policy
  rather than table.
- **Voyager project page** (https://voyager.minedojo.org) — the curriculum
  "takes into account the exploration progress and the agent's state to
  maximize exploration"; "3.3x more unique items"; tech tree "up to 15.3x
  faster". Cross-checked against notes-classics.md.

*(Honesty note: I could not fetch the Stardew Valley wiki for the real game's
landslide/letter detail — stardewvalleywiki.com, its raw-action route, and the
fandom mirror all returned HTTP 403 to automated fetches, three attempts each.
The spring-5 closure fact I argue from is the verified repo record (BRIEF.md,
TASK.md) and the locked scenario's in-world notice board (bench/README.md);
any real-game wiki detail is background, not a citation.)*

## Extensibility across games

The judge weights this above everything, so here is the honest ledger.

**Game-agnostic by construction.** The three load-bearing pieces contain zero
game words:

- **The survey directive** is a policy about *epistemics*, not about Stardew:
  "go where you haven't gone; read what can be read; activate what looks
  interactive once; write down what the world tells you; say when done."
  Recognizing that a pixel pattern is a "notice" or a "door" is the model's
  perceptual job — the same job it already does every turn with
  `world_observe`. Voyager needed no Minecraft table to propose tasks
  (https://voyager.minedojo.org: GPT-4 proposes from raw state, "an in-context
  form of novelty search"); RSIAgent ran one curriculum agent across OSWorld,
  ALE, and GameCraft-Bench with no per-benchmark tables
  (https://arxiv.org/html/2609.15364v2). In-context curricula are the
  owner's "no per-game rule tables" rule, satisfied by design rather than by
  discipline.
- **The guide schema** — kinds are epistemic categories (closure, hazard,
  affordance, layout, schedule, unknown), the confidence tiers are about
  *how the fact was obtained*, `asOf` is the game's own clock as declared by
  the adapter. Nothing is game content; every field would survive a port to a
  second game untouched.
- **Termination** references no game concept: a model declaration, a turn
  budget, a no-new-findings count. Porting to a new game changes zero lines of
  the curriculum machinery; only the adapter's declared state (save id, areas,
  observations) differs. The round-2 bench is built this way — the same
  `curriculum` approach module runs on the Stardew sim and the toy2 Keycraft
  variants unchanged (bench/README.md).

**Where it honestly degrades.** On games that document nothing in-world —
abstract or grid puzzles with no signs, no letters, no readable world — the
"read the world" channel is empty. The survey does not disappear; it degrades
to mechanical interaction: try the moves, record outcomes, build the guide
from behavior (RSIAgent's deep stage — "corner cases, hidden constraints, and
boundary conditions" — is exactly this, and it worked on OSWorld/ALE,
https://arxiv.org/html/2609.15364v2). Two fallbacks cover what interaction
cannot reveal: the `kind: "unknown"` entry routes to the documented wiki seam
(one model turn per search, at most once per unknown), and the player remains
the cheapest, most trustworthy source ("ask the player" is an entry kind too).
What I do **not** claim: that every game's world states its gating facts
legibly. I claim the survey guarantees the companion has read *everything
readable* before grinding — and in the failure class this round exists to fix,
the fact was readable (bench/README.md's notice board; P2-0019's lost days
were spent not reading it).

## Anticipated attacks and my answers

**1. "Exploration burns LLM calls and game time while the player waits — the
cost is visible in the metric table."**
It will be, and I will defend the total, not the phase. The survey is bounded
(bench: an 8-turn budget; product: a turn + game-clock budget agreed in the
permission grant) and paid **once per save**; every later session loads the
guide at zero survey cost. Compare the alternative's amortized bill: without
the survey, the discovery cost is paid in *failed goal work* — P2-0019 lost
days, the round-1 baseline burned 6.7 mean calls on mine without knowing why
it was blocked (round-1 REPORT.md), and the round-1 toy2 baseline spent ~27
calls *exploring anyway* — the pure-LLM loop explored too, just without
recording, so its knowledge evaporated at session end. The survey is not
extra exploration; it is the exploration that was already happening,
**captured**. And survey turns are cheap, batchable work (PTC legs — option
d's own primitive) with high actions-per-minute: walking and reading are done
body tasks, not idle time. Concession, stated: for a five-minute goal on a
save the player will never revisit, survey-first is the wrong size — which is
why the trigger conditions (persistent save id, empty guide) and the route-
survey degradation exist. The metric table should show cost per *save*, not
cost per session; on that axis the survey's curve only bends down.

**2. "The delegated goal may need action NOW (an event window) — surveying
first can miss it."**
The survey is a bounded, interruptible prefix with a priority rule, not a
fixed prologue. If the goal carries urgency (deadline in its text, or the
player says so), the full survey is skipped and replaced by a **route
survey**: read what the goal's own path crosses — which in the locked
scenario is precisely the notice board near the start, the cheapest possible
survey that still converts "grind into a wall" into "wait informed". Note the
asymmetry the attacker's own scenario implies: an uninformed sprint into an
unknown closure does not make the window either — it spends the window
failing against the gate (P2-0019's actual behavior: lost days, not saved
ones). The informed runner uses `wait_minutes`-style deliberate waiting or
reroutes *because* the survey read the board. And on any save with a guide,
this attack is moot: no survey runs at all, the goal starts immediately.

**3. "Surveys without verification store wrong facts (the verifier
problem)."**
Agreed — which is why confidence is part of the schema, not an afterthought.
Survey entries are classified by *how they were obtained*: `observed` (the
world showed it — a sign's text is an observation), `reported` (a letter or
character said it), `inferred` (the model concluded it — lowest trust, first
demoted). Promotion to trusted requires the game's own observable
confirmation, per RSIAgent's verifier discipline: verdicts grounded in
environment feedback, isolated from the actor's reasoning
(https://arxiv.org/html/2609.15364v2); Voyager's ablation is the cost of
skipping this — removing self-verification cost **−73%** of discovered items
(notes-classics.md). Wrong entries then meet the correction path: `asOf`
stamps make time-limited facts read as expired hypotheses, and the first
contradicting game outcome demotes them in-turn. The residual risk — one
wasted encounter before correction — is bounded and is itself the correction
signal; the same residual every memory option carries. The difference is the
error *rate at source*: a copied sign beats an inference from a blocked walk,
so the survey writes fewer wrong facts per unit of knowledge than any
failure-first writer. And `kind: "unknown"` means the guide can be honestly
empty where the world was silent, instead of confidently wrong.

**4. "Voyager's curriculum worked in Minecraft because the game is a sandbox
— Stardew goals are time-boxed."**
The transfer is the curriculum *principle*, not the sandbox ethos — and I
drop Voyager's open-endedness deliberately: no unbounded wandering, three
hard termination criteria, a survey shaped like a phase rather than a
lifestyle. The evidence that this principle is not Minecraft-specific:
RSIAgent's broad-then-deep curriculum ran on OSWorld and ALE — desktop and
web-agent benchmarks with deadlines and fixed tasks, not sandboxes — and its
ablation shows the exploration stages carried real points (74.54 full vs
56.50 deep-only; https://arxiv.org/html/2609.15364v2). Go-Explore's
headline result is **Montezuma's Revenge** — a time-pressured arcade game,
the opposite of a sandbox — where "remember previously visited states" and
"first return to a promising state" beat pure grinding at roughly 4x prior
SOTA (https://arxiv.org/abs/1901.10995). And Stardew's time-boxing *helps*
the survey: a deadline makes unknowns expensive, and the survey is the
cheapest de-unknowning available — it converts "closed until spring 5" from
a discovered catastrophe into a scheduled wait before any deadline is spent.
The one-survey-per-save cost lands in days the goal would otherwise lose to
blocked walks.

**5. "This is just option (b) with extra steps — the guide has the same
content the library would."**
The content overlaps; the architecture does not. (b) is a **store with no
producer**: its write events fire on verified failure or day-end distill
(transcripts/advocate-library.md), so on an unlearned save it learns
*reactively* — the mine closure enters the library only after the companion
has lost days to it once. The survey learns *preventively*: the same fact
enters the guide on day 1, copied from the notice board, at `observed`
confidence, with zero failures. The literature states (b)'s gap exactly:
CLIN's insights "come only from self-experience; if the agent never reaches
the relevant area … it never forms the needed memory and keeps failing"
(https://ar5iv.labs.arxiv.org/html/2310.10134). (b)'s own advocate concedes
the point twice: on a fresh save the sheet "is empty — rendered as a
two-token 'no lessons for this save yet' — and the companion behaves exactly
like today's product," and "an empty library plus a passive loop grows
slowly; option (c)'s survey is the accelerant"
(transcripts/advocate-library.md). I am the accelerant she concedes she
needs. The correct ordering: the curriculum is the **producer**, the library
is the **storage** — my survey output is exactly what (b)'s layer-2 save
memory should hold, and I will happily write it into her schema. Calling the
warehouse the architecture is how this round ends up measuring how fast we
store lessons about failures we could have prevented. Where (b) genuinely
deserves credit: its per-save identity resolution, confidence tiers, and
correction protocol are right, and I reuse them for the guide.

**6. "The permission boundary — isn't autonomous exploring exactly the road
to unattended farming?"**
No, and the design draws the line explicitly. The survey runs inside a
delegated, player-revocable session; it is read-mostly (walk, look, read,
one activation press); it stores rather than harvests — it never sells,
ships, or accumulates; it terminates on bounded criteria that are part of
the permission grant; and it never runs unattended — a paused game holds a
goal and waits (index.ts persona text). The unattended-farming failure mode
is *unbounded autonomous production over time*; the survey is *bounded
epistemic work inside an existing delegation*, with its budget, action
vocabulary, and termination written into the grant the player can read and
revoke. Every survey turn is explainable from the log: the phase marker,
the budget counter, and each `guide_write` entry are all inspectable, and
the whole learned state is one deletable file.

**7. "Model round-trips make surveys glacial — your phase doubles the idle
ratio."**
Survey legs are the ideal PTC workload: one model turn can program
walk-look-read-record as a single batched program (dsh-ptc-runtime, mounted
in acp — dsh-facts.md §3), so a survey leg costs closer to one round-trip
than four. The idle-ratio complaint is real but it indicts the transport,
not the curriculum — option (d)'s batching helps any phase equally, and I
claim it for mine. And the game-time argument inverts: survey days are
dense with done body tasks (walking to, facing, and reading things), while
the unsurveyed alternative's days are dense with `blocked` retries — the
exact repeated-failure metric this round was built to catch.

## References

Repository artifacts (verified facts, cited by path/branch):

- `research/self-improve/BRIEF.md`, `research/self-improve/TASK.md` — the
  P2-0019 failure record (mine closed until spring day 5; lost days; repeated
  walls; sparse actions).
- `research/self-improve/dsh-facts.md` — verified DSH 0.2.0-rc.2 seams: web
  seam and its one-turn-per-search cost (§1), persona render-time variables
  (§2), goals/blocked policy codes, skills, PTC (§3), no memory service and
  the plugin-files rule (§4).
- `research/self-improve/bench/README.md` — locked/wall scenarios; the locked
  fact discoverable by exploring ("a readable notice board near the start")
  or the simulated wiki; the round-2 `curriculum` approach; same module runs
  on sim and toy2.
- `research/self-improve/bench/lib/approach-curriculum.ts` — the bench
  prototype this statement's mechanism mirrors (survey phase, `guide_write`,
  `curriculum_done`, 8-turn budget, guide injected into the goal phase).
- `packages/dsh-companion-plugin/src/index.ts` — turn markers
  (`chat|day-start|day-end|resume|world`), the `agent/pre-step` handler,
  `[resume]` goal re-arm, tool registration pattern, paused-game persona text.
- `packages/dsh-companion-plugin/src/mind/ledger.ts` — per-save keying
  (`SAVE_SEGMENT`, `forSession`), `EPISODES_PER_SAVE`, damage policy.
- `origin/behavior-research:research/behavior-debate/REPORT.md` — round-1
  results: toy2 one-shot authored-data 0/3 vs pure-LLM 3/3 at ~27 calls;
  skills library mine 8/10 @ 0.1 calls; baseline mine 5/10 @ 6.7 calls.
- `research/self-improve/transcripts/notes-classics.md` — Voyager, Reflexion,
  CLIN, ExpeL, AWM, Generative Agents (fetched there; URLs reused below).
- `research/self-improve/transcripts/notes-rsi.md` — RSIAgent, HarnessPro
  (fetched there; URLs reused below).
- `research/self-improve/transcripts/advocate-library.md` — option (b)'s
  opening (its concessions and save-id findings, quoted).

Fetched URLs (full list with dates in [sources-curriculum.json](sources-curriculum.json)):

- https://voyager.minedojo.org — Voyager project page: automatic curriculum,
  "in-context form of novelty search", 3.3x items / 15.3x tech tree.
- https://arxiv.org/abs/1901.10995 — Go-Explore: remember / return-then-
  explore; Montezuma mean >43,000 (~4x prior SOTA).
- https://arxiv.org/abs/1705.05363 — Curiosity-driven exploration
  (Pathak et al., ICML 2017): prediction-error curiosity; no-reward and
  sparse-reward results.
- https://arxiv.org/abs/2107.12808 — Open-Ended Learning Leads to Generally
  Capable Agents (DeepMind XLand): dynamic task distributions, zero-shot
  generalization to held-out games.
- https://arxiv.org/abs/2312.14878 — Pangu-Agent: agents "perform and adapt
  far better when organised reasoning and prior knowledge are embedded".

Reused from the shared notes (fetched there, per BRIEF.md):

- https://arxiv.org/abs/2305.16291 and https://ar5iv.labs.arxiv.org/html/2305.16291 —
  Voyager (abs + full text): curriculum, skill library, 3.3x, random-curriculum
  −93%, self-verification −73%, warm-up schedule, new-world transfer.
- https://arxiv.org/abs/2609.15364 and https://arxiv.org/html/2609.15364v2 —
  RSIAgent: broad/deep self-exploration stages, curriculum agent with stopping
  policy, verifier grounded in environment feedback, memory growth, ablations.
- https://ar5iv.labs.arxiv.org/html/2310.10134 — CLIN: exploration bottleneck
  (art studio), stale-memory retrieval, threshold-bounded reflection evidence.
- https://ar5iv.labs.arxiv.org/html/2304.03442 — Generative Agents: importance-
  threshold reflection (150), 2–3 reflections per agent-day.
- https://ar5iv.labs.arxiv.org/html/2303.11366 — Reflexion: WebShop surrender
  without diversity/exploration; reflections-not-trajectories.
