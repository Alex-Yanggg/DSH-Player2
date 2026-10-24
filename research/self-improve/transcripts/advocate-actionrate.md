# Advocate (d): actionrate — no growth without a fast body

Opening statement, round 2 of the self-improvement debate. Author: the actionrate
advocate. Files I fetched myself are listed in
[sources-actionrate.json](sources-actionrate.json); notes-*.md citations are reused
as permitted by BRIEF.md.

## Claim

Learning is downstream of acting. Every growth architecture on the table —
reflections (a), a lesson library (b), an exploration curriculum (c), an async
big-brain/small-brain split (e) — is made of model turns spent on top of a body that,
in the measured baseline, mostly stands still: the real-play e2e baseline shows
**G1 idle ~0.9** (90% of wall-clock the body has nothing to do while the model is in
flight) and **G2 skill-gap p95 ~20 s** between actions (TASK.md, problem statement).
Round 1's bench measured the same shape on real model calls: the model-in-the-loop
rows paid idle-while-thinking (farm llm idle 0.36 at 18.9 calls and 44.5 s; mine llm
idle 0.28; mine hybrid idle 0.38) while **every fixed executor showed idle 0.00**
(`git show origin/behavior-research:research/behavior-debate/REPORT.md`, cross-cutting
finding 1). A companion that idles at ~0.9 cannot explore, cannot accumulate the
repeated failures a stuck detector needs, cannot run the trials that fill any library;
throughput is the substrate every other option silently assumes. So the first growth
investment must be **action rate**: batched plans — the model plans several body
actions in one call and a plugin-side executor runs them (the shipped DSH PTC seam,
`dsh-ptc-runtime`, is exactly this primitive) — plus the existing reflex tier keeping
the body busy between turns, plus skills amortizing repeated procedures. I concede
outright: this fixes throughput, not knowledge. That is precisely why it must come
first: options (a), (b), (c) and (e) all multiply round-trips — reflections, web
searches, distillation passes, escalation traffic — and on an idle-heavy substrate
they make the latency problem worse before they make the companion smarter. Fix the
exchange rate between wall-clock and attempts first; then every learning loop bought
with those attempts gets 5-10x more of them for free.

## Mechanism

The loop has three layers, all driven by the adapter's declared vocabulary. No layer
introduces a game fact into code.

### 1. Batched plans (the core)

**What a batched plan contains.** A `plan_submit` call from the model carries an
ordered list of up to 8 steps (the round-2 bench prototype's bound; bench/README.md).
Each step names **one declared body primitive with its arguments** — the same tools
the model already has today (`world_observe/find/map/locations`,
`body_walk_to/controls/input`, plus `skill_run` and a deliberate-wait tool). A step may
carry an `until`-condition in the same observable vocabulary the product's `walkTo`
helper already uses for interrupts (arrived / blocked / see round-1 REPORT, llm
section: "the repo's own `walkTo` helper already amortizes navigation (up to 14 legs
per call) with `until`-condition interrupts as the reactive substrate"). The primitive
vocabulary **is** the adapter's declaration; the executor knows nothing about Stardew.

**How the executor stops on failure and returns a digest.** The executor is
plugin-side, mechanical, and dumb on purpose: it runs steps in order; per-step
success/failure comes from the body port's native result — it never invents success
(the engineering rule "never replace a missing or invalid native result with a
player-visible local fallback" is structural here). On the **first failing step it
stops the whole batch** — so a batch can produce at most one instance of any repeated
failure, structurally capping the "same wall hit again and again" behavior inside a
plan. It returns a **digest, not raw state**: one line per step (tool, status,
duration, compact outcome such as arrival flag or observed delta) plus the failing
step's native error. This is the filtering pattern Anthropic documents for code
execution — "The agent sees five rows instead of 10,000"
(https://www.anthropic.com/engineering/code-execution-with-mcp) — applied at plan
granularity: eight actions' outcomes arrive in one bounded message instead of eight
full observation turns.

**What the reflex tier does while the model thinks.** The plugin's already-shipped
fixed reflex tier (`reflexes/*.json` + engine, BRIEF.md product facts) keeps evaluating
its conditions every tick and runs its interrupts and continuations regardless of
model state — the Krafton PUBG Ally boundary, shipped: "Reflex-level actions never
have to wait for the model"
(https://developer.nvidia.com/blog/how-krafton-built-pubg-ally-a-co-playable-character-powered-by-nvidia-ace).
On top of that, the plan's `until`-conditions give the body *planned* work between
turns: call t+1 is composed while the executor is still running batch t. The body is
never idle waiting for the model unless the plan itself says "stop and wait".

**When the model is re-consulted.** Exactly four points: (1) a batch digest returns
(success or first-failure); (2) a reflex interrupt or `until`-condition aborts the
batch early — the executor escalates with the digest; (3) the delegated goal's round
driver ends or re-prompts (DSH goal rounds, 256-round cap, dsh-facts.md); (4) the
model's own choice of batch size — for hostile ground it plans 1-step batches, which
is today's loop; for safe chores it plans 8. The model prices its own supervision per
situation instead of paying a full round-trip per button press.

**What skills add.** A procedure the model has demonstrated repeatedly collapses into
one catalog entry (`skill_save`/`skill_run` already shipped; DSH `dsh-skill` catalog,
dsh-facts.md) or one reusable plan template, retrieved at zero extra model calls.
Round 1 priced the steady state: the skills approach ran farm at **0.0 calls, 7.2 s,
10/10** and mine at **0.1 calls, 8/10** (round-1 REPORT table). AWM is the literature's
version: workflows cut WebArena steps from **7.9 to 5.9 per example** (BrowserGym
baseline 7.9 steps / 15.0% success → AWM 5.9 steps / 35.5% success; 46.7 steps for
AutoEval) — fewer steps *and* higher success
(https://arxiv.org/html/2409.07429v1, also notes-classics.md).

### 2. Why this is not "scripting the companion"

The design principle says fixed logic needs a stated reason the model cannot do it.
Here it is: sequencing eight decided steps and stopping on the first failure is not a
decision — it is execution plumbing, the same class as the shipped `walkTo` helper the
round-1 report already records as the reactive substrate. Every *decision* stays with
the model: which steps, how many, what conditions, what to do with each digest. The
reflex tier is pre-existing shipped logic whose reason is tick rate (a model call
cannot respond within a game tick; PUBG Ally's whole latency argument). Nothing in (d)
moves a decision from model to code that was not already there.

### 3. Permission boundary

A batch is not new authority: the executor can invoke only the body tools the model
could already invoke, under the same delegated-goal permission, with the same goal
rounds capping continuation. The batch plan itself is a player-inspectable artifact —
model-written, logged, replayable (PTC returns "ordered per-channel logs", see below).
Growth by (d) cannot exceed the permission the player gave, because the executor has
no capability the model lacks.

### 4. Network requests

Zero new ones. (d) makes no web searches at all (contrast: in this stack "one search
costs a full model turn", dsh-facts.md §1 — a cost the knowledge options add). It
strictly reduces model API turns and adds no external service.

## How it fits the DSH seams

All verified against dsh-facts.md and the installed package READMEs:

- **`dsh-ptc-runtime` (`ctx.ptcRuntime`)** — the shipped batching primitive. Its
  README: "run one model-written program against host-provided asynchronous functions
  through a configured backend"; a run "returns a lossless-JSON value, ordered
  per-channel logs, or a structured error"; "Each run is isolated from prior runs, and
  the runtime has no knowledge of tools or sessions"
  (`$DSH\dsh-ptc-runtime\README.md`). `dsh-ptc-runtime-node` "executes erasable
  TypeScript in a fresh managed Node process under the resolved sandbox policy".
  `acp` mounts `dsh-ptc-runtime-node`, `dsh-workflow-ptc`, `dsh-tool-workflow`
  (dsh-facts.md §3). (d) uses it in two shapes: (i) the bench prototype's
  fixed-vocabulary `plan_submit` — most inspectable, ships first; (ii) the general
  model-written program over body-tool bindings via `dsh-workflow-ptc` — same
  batching, richer control flow, and the shape Anthropic shows saving **98.7% of
  tokens (150,000 → 2,000)** on a multi-tool task because "every intermediate result
  must pass through the model" no longer holds
  (https://www.anthropic.com/engineering/code-execution-with-mcp).
- **Reflex layer** — already in the plugin (`reflexes/*.json` + engine); enters the
  turn flow through the existing `agent/pre-step` listener (`dsh-agent-loop` owns
  pre-step admission, dsh-facts.md §3). No new seam needed.
- **Skills** — `dsh-skill` + `dsh-skill-filesystem` + `dsh-tool-skill`, all mounted in
  `acp` (dsh-facts.md §3): the catalog for plan templates and learned procedures.
- **Goals** — `dsh-goal` + round driver (persisting across turns/resume, 256-round
  cap): the driver that asks for the next batch and keeps the delegation inspectable.
- **Code/data placement.** Executor, digest builder, reflex engine: game-agnostic
  plugin code written once. Plan batches: model output at runtime (not shipped data).
  Skills and plan templates: runtime-learned data in plugin files — explicitly allowed
  by BRIEF.md ("runtime-learned data in plugin files is fine, shipped per-game tables
  are not").

## Best evidence

1. **Round-1 bench, real model calls — the idle table.** Quoted exactly from
   `git show origin/behavior-research:research/behavior-debate/REPORT.md`:
   "Every architecture that leaves the model as the only decision-maker pays
   idle-while-thinking on the farm (llm 0.36, hybrid 0.35 — hybrid's revisions
   reintroduce it) and pays in deaths on the mine (llm's failed runs). Every fixed
   executor (modes, goap, skills, handcoded, llm-bt) shows idle 0.00." The table rows:
   farm llm 10/10 at **18.9 calls, 44.5 s wall, idle 0.36**; mine llm **5/10 at 6.7
   calls, idle 0.28**; mine hybrid idle **0.38**. The real-play baseline is worse
   still: **G1 idle ~0.9, G2 skill-gap p95 ~20 s** (TASK.md). This is the measured
   claim that acting, not thinking, is the bottleneck — and the mine rows show the
   cost of idling is not just slowness, it is deaths.
2. **AWM — fewer steps, higher success.** WebArena: BrowserGym_ax-tree **7.9 steps /
   15.0% success** vs AWM **5.9 steps / 35.5% success** (AutoEval 46.7 steps);
   "AWM obtains high success rates while maintaining efficient trajectories"
   (https://arxiv.org/html/2409.07429v1). The knowledge options' own best precedent
   for compounding memory is simultaneously the best evidence that step-count
   reduction and success go together — rate and quality are not a trade.
3. **Anthropic, code execution with MCP — batching is the industry's own direction.**
   Presenting tools as code APIs and letting the model write one program that loops
   and branches took a representative multi-tool task from **150,000 to 2,000 tokens
   ("a time and cost saving of 98.7%")**; conditionals in code avoid per-if model
   latency; a polling loop in code "is more efficient than alternating between MCP
   tool calls and sleep commands through the agent loop"
   (https://www.anthropic.com/engineering/code-execution-with-mcp). DSH's PTC seam is
   the same primitive, already shipped and mounted in `acp`.
4. **SayCan — the division of labor precedent.** The LLM supplies semantic knowledge;
   pretrained skills ground it; "the robot can act as the language model's 'hands and
   eyes'" (https://arxiv.org/abs/2204.01691). Honest note: SayCan re-scores the next
   skill after each execution rather than emitting one open-loop plan — which matches
   (d)'s stop-on-first-failure executor, not a fire-and-forget plan.
5. **PUBG Ally — the reflex boundary, shipped at product scale.** "Reflex-level
   actions never have to wait for the model"; System 1 is a behavior tree at game tick
   rate, System 2 is the language model
   (https://developer.nvidia.com/blog/how-krafton-built-pubg-ally-a-co-playable-character-powered-by-nvidia-ace).
   Krafton's own engineering lesson: deciding the model/not-model boundary was the
   hard part — which is why it should be spent on rate (mechanical), not on decisions.
6. **Round-1 amortization and the model loop's extensibility.** Skills steady state:
   farm **0.0 calls / 7.2 s / 10-10**, mine **0.1 calls / 8-10** (round-1 REPORT); the
   pure-LLM loop was the only LLM approach to solve toy2 interactively (**3/3 at 26.7
   calls** table; ~30 in prose). (d) is exactly these two combined: keep the
   interactive loop's freedom, cut its per-action call price.
7. **RSI literature prices rate too (notes-rsi.md, reusable).** RSIAgent lists
   "substantial test-time compute cost" as limitation #1
   (https://arxiv.org/abs/2609.15364); HarnessPro's entire contribution is making each
   self-improvement epoch *cheaper* (Pareto selection over performance AND cost; media
   headline: agent self-evolution cost cut 53%; RHO's baseline +42.6% cost is named as
   the trap) (https://arxiv.org/abs/2610.26770,
   https://github.com/pzs19/HarnessPro). The field's newest result treats cost-per-
   epoch as first-class; throughput is growth's exchange rate, not its enemy.

## Extensibility across games

The judge's weighted criterion. (d)'s per-game surface is the smallest of any option
that changes behavior:

- **Game-agnostic code, written once:** the plan executor (ordered runner, stop-on-
  first-failure, digest builder), the reflex engine, the skill/plan catalog plumbing.
  None of it mentions a game; steps are opaque `(tool, args, until)` tuples over the
  adapter's declared vocabulary.
- **The adapter's declaration drives everything:** the primitive list the model plans
  against and the `until`-condition vocabulary are exactly what the port already
  declares (raw state out, raw button tasks in). A new game brings a new adapter —
  which **every** option needs, because it is the port, not an architecture cost.
- **What is data, and where it comes from:** plan batches are model output at runtime,
  per game, never shipped. Skills and plan templates accrue as runtime-learned plugin
  files, empty on a new game's day one. Honest flag: the reflex tier's current
  `reflexes/stardew-valley.json` is shipped per-game data; the rule-compliant target
  is a minimal declaration-derived safety set (interrupt conditions the port already
  exposes) plus reflex entries learned during play. That migration is part of (d)'s
  ticket, and I claim it rather than hide it.
- **What a new game actually needs, concretely:** (1) the adapter; (2) a small
  initial reflex/safety declaration derived from the adapter's own declarations —
  no game facts beyond what the adapter already states; (3) nothing else. The model
  writes that game's plans from live context in session one.
- **Why batching ports better than authored artifacts:** round-1's toy2 row is the
  caution — every one-shot authored-data approach failed to author for the new game
  (skills, modes, llm-bt, hybrid all 0/3), while the interactive model loop went 3/3.
  Batched plans keep the interactive loop's repair freedom (a plan is re-written from
  a digest, not gate-kept by a one-shot artifact) while cutting its call count. Rate
  fixes that do not depend on one-shot authoring are the ones that survive the second
  game.

## Anticipated attacks and my answers

**"This fixes throughput, not knowledge — the companion will efficiently do the WRONG
thing for 5 days."**
Correct, and I said so in the claim: (d) alone does not discover that the mine opens
on spring day 5. Three answers. First, the knowledge options are *made of actions*:
(a)'s stuck detector consumes repeated failing body tasks — the body must attempt in
order to fail; (b)'s library fills from sessions that do things (CLIN's own stated
limitation: if the agent never reaches the relevant area, it never forms the needed
memory — notes-classics.md, https://ar5iv.labs.arxiv.org/html/2310.10134); (c)'s
curriculum tasks must be executed to verify anything; (e)'s escalation detector needs
failure events to detect. At idle ~0.9 there are almost no attempts for any of them
to consume. Second, the knowledge options multiply round-trips on the worst substrate:
a reflection is model turns (CLIN adds a memory-generator call after *every* trial;
Generative Agents needed an importance threshold of 150 to hold reflection to 2-3 per
day — notes-classics.md), a web search is a full model turn (dsh-facts.md), distils
are more turns. Layering those onto idle 0.28-0.9 makes latency worse before lessons
exist. Third, the "wrong thing for 5 days" scenario costs one discoverable fact; the
substrate decides how soon the loop can afford the attempts and the search that
discover it. Efficiently wrong is one scenario; inefficiently everything is every
scenario. (d) plus (a)/(b) is the composition; (d) is the part that has to exist
first.

**"Batched plans executed blind are MORE dangerous (no mid-course correction)."**
They are not blind, by construction. (1) Stop-on-first-failure: the batch halts at the
first failing step and returns — failure is caught per step, not per batch, and a
batch cannot repeat a failing step. (2) `until`-conditions and the shipped reflex tier
run during execution; interrupts abort the batch and escalate with a digest (the
product's `walkTo` already does exactly this within navigation). (3) The model chooses
batch size, so it prices its own supervision: one step on hostile ground, eight on a
safe chore — SayCan's re-score-after-each-skill discipline at the granularity the
model picks (https://arxiv.org/abs/2204.01691). (4) The digest is fresh, compact
grounding for the next decision — better correction, not less, than eight stale
full-state turns. And the danger comparison is not against a hypothetical attentive
loop; it is against the measured status quo, a body standing still while the model
thinks — which is how the mine's llm runs died (round-1 REPORT: "pays in deaths on the
mine"). A condition-guarded plan is strictly more attended than an idle body.

**"The async option (e) already contains your mechanism as its small brain — why is
standalone (d) better?"**
Because (d) is (e)'s load-bearing subset, and the rest of (e) is machinery that must
earn its keep. (e) = (d) + an escalation detector + a second brain + an async channel.
The detector ("same wall three times") is exactly the fixed decision code the design
principle says needs a stated reason — and the reason only becomes valid once plain
batching measurably fails to surface failures, which the digest+stop design already
does: every failure reaches the model at the next digest, no detector needed. Round-1
evidence says a *fixed executor with no second brain* already reaches idle 0.00 — the
body does not need a brain to keep working; it needs a plan that outlives the turn.
(e)'s small-brain-as-cheap-model variant also adds model calls back into the gap (a
minimal-prompt loop is still model turns); (d) spends zero model calls between
batches. Sequencing: (d) ships entirely on seams already mounted in `acp` (PTC, the
existing reflex tier, `dsh-skill`, `dsh-goal`) with one new plugin module; (e)'s async
split is an upgrade that would *reuse* (d)'s executor as its small brain, so nothing
is discarded. If (d) + library + reflect — the bench's `combo` reference row —
measures sufficient recovery, (e)'s extra machinery is unearned complexity. Until
escalation is proven necessary by measurement, the simpler sufficient thing is the
right first growth investment.

**"Skills are per-game authored data by another name."**
No — and the brief draws the line explicitly: "runtime-learned data in plugin files is
fine, shipped per-game tables are not." Skills are runtime-learned data files written
during play; a new game's catalog is empty on day one and fills from that game's own
sessions; nothing skill-shaped ships in code. The pattern is mainstream, not a dodge:
Anthropic's code-execution design has agents "save reusable code as skills"
(https://www.anthropic.com/engineering/code-execution-with-mcp). The honest part:
round-1 toy2 showed one-shot skill *authoring* can fail outright (0/3 within the
repair budget) — which is exactly why skills are (d)'s third layer, not its first.
Batched plans need no authoring (model-written from live context each time); a
procedure is promoted to a skill only after it has demonstrated reuse, matching the
commit gates in the literature (Voyager commits only self-verified skills; AWM induces
workflows only from judged-successful trajectories — notes-classics.md).

**"Latency is a product concern, not a growth concern — the judge asked about
growth."**
Rate is a growth concern because every learning loop in the required reading is
rate-limited by trials per wall-clock hour, and every one of them says so in its own
cost accounting: Reflexion needed up to 12 trials per task and its WebShop run gave up
after 4 (notes-classics.md, https://ar5iv.labs.arxiv.org/html/2303.11366); CLIN
averaged 3.3 trials to success per task (https://ar5iv.labs.arxiv.org/html/2310.10134);
Voyager's learning was "15x more expensive than GPT-3.5" per its own limitation
section (notes-classics.md, https://ar5iv.labs.arxiv.org/html/2305.16291); RSIAgent's
limitation #1 is "substantial test-time compute cost" (notes-rsi.md,
https://arxiv.org/abs/2609.15364); Generative Agents capped reflection at 2-3 per day
because reflection is expensive
(https://ar5iv.labs.arxiv.org/html/2304.03442); and the newest RSI result,
HarnessPro, made cheaper epochs its whole contribution
(https://arxiv.org/abs/2610.26770). A harness whose body idles at ~0.9 runs roughly a
tenth of the trials of a busy body in the same wall-clock — you cannot out-reflect a
10x throughput deficit, because the reflections themselves are the expensive turns.
The bench agrees rate is a growth metric: round 2 measures `actions_per_game_minute`
and `recovery_ticks_mean` per option (bench/README.md). The growth question is not
"should the companion learn" — everyone agrees — it is "what does an hour of play
buy"; (d) is the option that answers that question first.

## Honest ledger (for round 3)

What (d) does not fix, stated now: no world-fact discovery (the locked scenario's
missing fact needs (a)/(b) or the wiki), no lesson correction or staleness handling,
no curriculum, no cross-save identity; skills inherit the authoring-failure risk round
1 measured; the executor's stop-on-failure catches *step* failure, not *plan-level*
wrongness (a perfectly executed 8-step plan toward a closed pass still wastes the
morning — (d) makes the waste cheaper, not zero). The claim is narrower than the
other options': it is the substrate claim, and it is load-bearing for all of them.

## References

- Round-1 debate report (bench tables, cross-cutting findings): retrieved via
  `git show origin/behavior-research:research/behavior-debate/REPORT.md` (repo
  artifact on `origin/behavior-research`, not a URL).
- Round-2 task and brief: TASK.md, BRIEF.md (repo, `research/self-improve/`).
- Verified DSH facts: dsh-facts.md (repo, `research/self-improve/`); PTC README read
  at the installed package root given there: `$DSH\dsh-ptc-runtime\README.md`.
- Bench prototype and metrics: bench/README.md (repo, `research/self-improve/bench/`).
- Round-2 research notes (citations reused as-is): transcripts/notes-rsi.md,
  transcripts/notes-classics.md.
- Fetched by me this round (see sources-actionrate.json):
  - https://www.anthropic.com/engineering/code-execution-with-mcp
  - https://arxiv.org/abs/2204.01691
  - https://arxiv.org/html/2409.07429v1
  - https://developer.nvidia.com/blog/how-krafton-built-pubg-ally-a-co-playable-character-powered-by-nvidia-ace
- Reused from notes-classics.md: https://arxiv.org/abs/2409.07429 ,
  https://ar5iv.labs.arxiv.org/html/2303.11366 ,
  https://ar5iv.labs.arxiv.org/html/2305.16291 ,
  https://ar5iv.labs.arxiv.org/html/2310.10134 ,
  https://ar5iv.labs.arxiv.org/html/2304.03442 ,
  https://arxiv.org/abs/2308.10144
- Reused from notes-rsi.md: https://arxiv.org/abs/2609.15364 ,
  https://arxiv.org/abs/2610.26770 , https://github.com/pzs19/HarnessPro
