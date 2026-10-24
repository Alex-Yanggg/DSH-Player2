# Advocate (e): async — the big-brain/small-brain split

Advocate for option (e), the owner's amendment design: a big brain (the DSH session
model) that plans, reflects and searches asynchronously, and a small brain (plugin-side)
that keeps the body acting on the current plan and escalates repeated failure. Date:
2026-10-24. Sources I fetched myself: [sources-async.json](sources-async.json);
notes-*.md citations are reused as the brief permits.

## Claim

The companion's growth loop should be owned by an **asynchronous big-brain/small-brain
split**, because the two failures we must fix — knowledge gaps and a starved action rate —
have one shared cause: today the same model turn owns deciding, learning, and the body's
next move, so every decision pauses the body (round 1: every model-in-the-loop architecture
paid idle-while-thinking, farm idle 0.36, mine failures "are bodies standing still while a
call was in flight", while every fixed executor shows idle 0.00 — round-1 REPORT,
cross-cutting finding 1) and every learning moment is squeezed into the same blocking turn.
The split decouples them: the **big brain** is the DSH session model — it plans, reflects,
web-searches and writes lessons *without the body waiting for it*; the **small brain** is
fast plugin code (optionally upgraded with a flash-tier model) that executes the current
plan, keeps reflexes armed, detects repeated failure itself from task-outcome signatures,
and escalates. Plans flow down; structured status flows up; everything passes through
plugin-owned state, all inside one DSH plugin, zero hardcoded game facts. This is the
composition the other options assemble implicitly — batching (d), a stuck detector (a),
a lesson store (b), exploration (c) — made explicit, inspectable, and non-blocking.
No other option keeps the body busy while learning happens, and none of them can:
a blocking turn architecture pays for thinking with stillness, and the bench's headline
metric (idle ratio) is precisely the tax it cannot avoid. The split is also the only option
where the fix for knowledge (search, reflect) and the fix for rate (plans, skills, reflexes)
*cannot* interfere with each other, because they run on different clocks.

## Mechanism

### 0. The split in one picture

- **Big brain** = the one DSH session model, running in its normal agent loop (turns,
  goal rounds). It owns: plan authorship, reflection, web search, lesson writing, skill
  authoring, rulings on escalations. It never touches the controller directly.
- **Small brain** = plugin code living in the same process position as today's reflex
  tier — evaluated "between and during body calls" through the same body port
  (`packages/dsh-companion-plugin/src/body/reflex.ts` states exactly this position). It
  owns: plan replay, signature counting, safe-hold behavior, status bookkeeping, and
  (optionally, benched separately) per-step judgments delegated to a cheap model.
- **Channel** = plugin-owned state: a plan inbox (big brain writes), a status outbox
  (small brain appends). Rendered into prompts via the plugin's existing turn-marker /
  MindContext path; written to the plugin's own files so plans and lessons survive
  restarts.

### 1. What exactly is a "plan"

The hand-down artifact is JSON in the bench's own shape (the bench's `plan_submit`
already plans "up to 8 body-tool calls" run in order by a plugin-side executor —
bench/README.md), generalized to survive turn boundaries:

```json
{
  "planId": "p-0042",
  "goalRef": "active DSH goal id this plan serves",
  "intent": "reach the pass and open the gate (plain words, no coordinates — player-visible)",
  "steps": [
    { "kind": "walk-to-tile", "x": 11, "y": 1 },
    { "kind": "face-and-press", "face": "down", "button": "<game button id>", "ms": 200 },
    { "kind": "run-skill", "skillId": "<stored skill id>", "args": { } },
    { "kind": "wait-until", "condition": { "gameDay": 5, "timeOfDay": "morning" } }
  ],
  "completion": { "kind": "task-status", "step": 3, "expect": "succeeded" },
  "falsifier": "if the pass is still closed after day 5 begins, this plan's premise is wrong",
  "maxSteps": 40,
  "expiresAtTick": 2800
}
```

The step vocabulary is fixed, small, and **game-agnostic by construction**: it is the body
port's own vocabulary — `walk-to-tile` (the existing A* + walk-legs helper, up to 14 legs
per call with `until` interrupts), `face-and-press` and `raw-input-steps` (the port's
`BodyInputStep` press/hold/release shape), `run-skill` (a stored skill via `skill_run`),
`wait-until` (conditions the adapter itself exports — tick, timeOfDay, flags), and
`observe` (a world read pushed into the status stream). Every argument is a coordinate or
target from the plugin's own observation layer, a button id from the adapter's declaration,
or a stored skill id. The executor knows no game semantics; it cannot, because it only
ever sees port-shaped values. A plan also carries a `falsifier` — the big brain's own
written statement of what observation would prove the plan wrong — and hard bounds
(`maxSteps`, `expiresAtTick`) so no plan can run unattended forever.

### 2. Small-brain failure detection: task-outcome signatures

The detector is deliberately dumb, matching the bench's reflect prototype ("consecutive
failing body tasks with the same first-press/first-hold signature" — bench/README.md):

> signature = (task kind, first press — else first hold — plus the arrive/warp target)

The small brain hashes this per failing body task into a ledger. **Escalate** when either:

- **Signature trigger:** K consecutive failures share one signature (K=3 — the owner's
  "same wall 3 times"; a plugin config number, not a game fact), or
- **Progress backstop:** no newly completed subtask and no new area reached for one full
  game-day window (config).

Why fixed code here, per the repo's "intelligent software" rule: the model cannot reliably
notice its own repetition from inside a bounded turn context — cosmetic variation makes
attempt #4 look novel, which is the documented reason the plugin already reads raw state
between and during body calls for reflexes. The listener sees across turns what no single
model turn can. Reflexion's WebShop run is the cautionary tale: blind retries silently
ground for 4 trials and surrender without a step back
([Reflexion full text](https://ar5iv.labs.arxiv.org/html/2303.11366), notes-classics).

### 3. What escalation does to the current plan, and what the message contains

Escalation **does not tear the plan down mid-action**. Semantics:

1. The current step finishes or hits an `until`/reflex interrupt (the reflex tier stays
   armed the whole time — it is part of the small brain).
2. The plan is marked **suspect** from the failing step index: the tail is *frozen*, not
   executed. The executor stops advancing.
3. The small brain switches to **safe-hold**: keep position, keep defensive reflexes armed,
   take no new semantic action. It never invents approach steps — that is the big brain's
   job. In the wall scenario this is the difference that matters: the starter-weapon
   swings *stop*, so the health drain stops, at K=3 failures instead of grinding.
4. One immediate retry budget per step (config) absorbs transient interrupts so the
   detector escalates on *pattern*, not on one bad tick.

The escalation message to the big brain (queued in plugin state, delivered at the next
turn admission — see 4): `planId`, failing step index, the repeated signature, the last K
structured outcomes from the ledger, a bounded recent-observation excerpt (the plugin's
own `renderObservation` output), plan progress so far, and the plan's own `falsifier`
text. It asks for exactly one of three rulings: **repair** the plan, **replace** it, or
**rule the goal blocked** (with a human-readable reason — DSH goals keep "a stable policy
code + human-readable explanation" when blocked, dsh-facts.md). The small brain does not
interpret any of this; it only collects.

### 4. What the small brain does while the big brain thinks

It **keeps the body busy on the current plan — that is the whole point.** The executor is
plugin code holding the body port; a model turn ending does not pause it. Concretely:

- While a plan runs, the body works: walk legs execute, skills run, `wait-until` waits
  deliberately. Model turn latency (round-1 baseline G2 skill-gap p95 ~20 s per BRIEF.md;
  the round-1 advocate's honest ~1–5 s for short calls) no longer idles anyone, because
  the next decision point is a step boundary in the plan, not the next model reply.
- If the plan is **exhausted** (all steps done, or the tail frozen after escalation), the
  small brain idles *deliberately*: safe-hold, reflexes armed, status reports "plan
  exhausted — awaiting ruling". Deliberate idle is bounded, visible in the status outbox,
  and attributable; the incumbent's idle is an accident of a blocked turn. The bench's
  idle-ratio metric will show the difference: idle only at plan boundaries, never
  mid-plan.
- **Escalation delivery, honestly.** DSH turns are sequential per session; the verified
  seams give no mid-turn model-interrupt. The small brain therefore queues the escalation
  and it is delivered at the next turn admission — the `agent/pre-step` listener the
  plugin already uses for turn markers — and the goal round driver (verified: goals
  persist across turns with automatic continuation bounded by a round cap, dsh-facts.md)
  is the mechanism that makes "next turn" soon rather than "whenever the player next
  chats". What dsh-facts.md does *not* document is the round driver's continuation trigger
  timing; escalation-delivery latency is an explicit bench measurement
  (`recovery_ticks_mean`) and an open spike item. This is the honest cost of the split
  (see attacks, #3).

### 5. Plan replacement mid-flight, safely

- **Steps are atomic.** The executor runs a step to completion or until an `until`
  condition or reflex interrupt fires. Between steps it checks the plan's generation
  counter.
- **A new plan (or repair) bumps the generation.** The executor adopts it at the *next
  step boundary*. Mid-step cancellation is reserved for safety interrupts only (game
  paused, reflex burst) — never for a mere plan update. Worst-case lag after a ruling is
  one short step (one walk leg, one input burst), which is the same discipline SayCan
  uses: a low-level skill runs to completion before the next step is grounded
  ([SayCan](https://arxiv.org/abs/2204.01691)).
- **Partial progress reports back up:** which steps completed, which failed with which
  signatures — so the big brain reasons from real state, not its own memory of the old
  plan. Replaced plans are archived in the plugin's files (the memory-ledger pattern),
  giving a full replay trail.
- Expiry (`maxSteps`, `expiresAtTick`) kills zombie plans even if the big brain never
  rules; the small brain then reports "plan expired" and safe-holds.

### 6. Must the small brain be pure code, or can it be a cheap model?

Both — with a hard boundary, and the bench is specified to measure it (the owner's
amendment: "whether the small brain can be a cheap model (DSH flash model or a subagent —
benched as a minimal-prompt model loop) or must be pure code").

- **Must be fixed code** (stated reasons the model cannot do it): plan replay/execution
  (determinism and loggability — a misbehaving companion must be explainable from plans +
  outcomes alone), signature counting and escalation (see 2), safe-hold and generation
  swaps (safety), expiry enforcement.
- **May be a cheap model** (flash tier — the bench already runs `deepseek-chat` served as
  `deepseek-flash`, bench/README.md — or a subagent child, see seams): *per-step
  adaptation only* — choosing which stored skill fits the current step, micro-adjusting a
  target (which tile, which slot among observation-offered alternatives), classifying
  whether a frozen step kind is still plausible, wording the status digest. It never
  writes plans (big brain owns authorship), never resets escalation counters, never
  declares success (the game's own task status is the verifier — RSIAgent's rule that the
  verifier trusts only environment feedback, never the actor's reasoning,
  [notes-rsi.md](notes-rsi.md)).
- **What the bench measures about this:** the same matrix with `smallbrain=code` vs
  `smallbrain=flash` — success rate, `repeated_failures_mean`, `recovery_ticks_mean`,
  `actions_per_game_minute`, llm calls split small/big, and a small-brain-mistake count
  (steps the cheap model selected that failed or that the executor rejected, vs the fixed
  executor on the same seeds). The prior that a cheap model + good harness helps is
  favorable: RSIAgent's GameCraft-Bench row shows a GLM-5.3-Flash generator going 30.55 →
  48.72 with the harness's support ([notes-rsi.md](notes-rsi.md),
  https://arxiv.org/html/2609.15364v2).

### 7. How this composes with learning

The escalation is the reflection trigger — the difference from option (a) is that
reflection runs in the big brain *while the body holds safely or keeps working*, not as a
blocking directive before the next body action:

1. Big brain receives the escalation evidence (structured; no narration to trust).
2. It checks the lesson/skill store first (retrieval, near-zero cost — round-1 skills
   row: mine 8/10 at ~0.1 calls from library retrieval; round-1 REPORT).
3. Only if the missing item is world knowledge beyond observation does it search —
   via the acp-mounted `web_search`/`web_fetch` (dsh-facts.md §1). Searches are rationed
   by policy (default ≤ 1 per escalation, deduped against a cached-query file in plugin
   storage), because one search costs a full model turn (dsh-facts.md).
4. A confirmed lesson (evidence + source URL) is written through the existing
   `remember`/`dream_commit` ledger path; verified-successful plans are promoted into the
   skill store via `skill_save` — Voyager's commit-only-after-verification gate
   ([Voyager](https://arxiv.org/abs/2305.16291), notes-classics).
5. The ruling comes back down as a plan (repair/replace) or a blocked-goal ruling.

Where the library fits (without claiming option (b)): the persona library is the agreed
*storage* design (owner-amended: agreed three-layer memory); my protocol contributes the
*write trigger* (escalation, gated on the game's own verified outcomes — never on the
model's claim) and the *read path* (lessons injected into the big brain's escalation
context and persona render). Lessons get tagged game-generic vs game-specific at write
time so the cross-save layer stays generic — CLIN's causal-abstraction shape ("X is
NECESSARY to Y") is the entry template that survived its own ablation
([CLIN](https://ar5iv.labs.arxiv.org/html/2310.10134), notes-classics), and every plan's
`falsifier` note is the invalidation hook CLIN lacked when it kept retrieving the outdated
stove insight ([CLIN](https://ar5iv.labs.arxiv.org/html/2310.10134), notes-classics).

### 8. Permission boundary, network and data

- Plans execute only against a `goalRef` pointing at an active, player-delegated DSH
  goal; safe-hold and the reflex tier are the only self-initiated behaviors; plans carry
  hard expiry. A paused game holds a goal — it never ends one (repo rule). Escalation and
  reflection are inspectable: every plan (with intent, falsifier, bounds), every
  escalation, every lesson is a plugin file the player can read and reset.
- **Network requests:** only the big brain searches, only on escalation, only through the
  already-mounted DeepSeek search provider (`DEEPSEEK_API_KEY`), rationed and cached per
  8; plain page fetches need no credential (dsh-facts.md §1). No other network traffic is
  added by the split. The small brain makes none.

### 9. Why this fixes both problems at once

The two observed failures share one cause — the blocking turn — and every rival option
treats one symptom inside that turn. (d) shortens the turn but the turn still blocks (the
bench's actionrate executor "stops on the first failure" and returns a digest — the plan
dies with the turn). (a) reflects but the reflection directive consumes turn time while
the body waits. (b) stores lessons nothing would write mid-play without a trigger. (c)
explores but must still act through the same blocking loop. The split is the only design
where **knowledge work (big brain) and action rate (small brain) are on different clocks**,
so improving one cannot starve the other: plans give the body minutes of work per model
turn (AWM's workflow evidence: 5.9 vs 7.9 steps per task while *raising* success —
[AWM](https://arxiv.org/html/2409.07429v1), notes-classics), and escalations give
reflection a trigger that costs the body nothing.

## How it fits the DSH seams

Verified seams only (dsh-facts.md unless noted):

- **Big brain = the DSH session/agent loop itself.** The session model keeps its turn
  loop; `dsh-goal` + `dsh-goal-round-driver` hold the delegated objective, persist across
  turns/resume/restarts (256-round cap), and give the blocked-goal ruling a stable policy
  code + human-readable explanation. Compaction keeps long sessions alive.
- **Small brain = plugin code between turns, the reflex-tier position.** The plugin
  already reads raw state and takes controller bursts "between and during body calls"
  through the same body port (`src/body/reflex.ts`); the plan executor and signature
  ledger live exactly there. The `agent/pre-step` listener (`dsh-agent-loop` owns pre-step
  admission) is where turn markers are written today and where the small brain's status
  digest and pending escalations enter the next prompt — the same attach-context shape
  `dsh-hook-protocol` gives hooks, but via the Cordis-native listener the product already
  uses.
- **`defineTool`:** the big brain gets `plan_submit` / `plan_repair` (write the plan
  inbox) and `plan_status` (read the outbox); the body tools (`world_*`, `body_*`) and
  `remember`/`dream_commit`/`skill_save`/`skill_run` are unchanged. The bench's
  `plan_submit` is this tool's prototype.
- **PTC (`dsh-ptc-runtime`, mounted in acp)** is the shipped batching primitive and the
  plan executor's in-turn form: when a plan's arguments must be *computed* (loop over
  tiles, conditional steps), the big brain writes it as a PTC program whose host functions
  are the same primitives. For linear plans, the JSON plan shape suffices — and unlike a
  PTC run ("isolated per run"), the plan inbox persists in plugin files across turns,
  which is the generalization PTC alone cannot give.
- **`ctx.web`:** big brain only, on escalation, rationed (8).
- **Subagents (verified today in the global install):** `@deepseek-ai/dsh-subagent` is a
  public delegation seam — "delegate work to named child agents, collect their results,
  and continue supported child conversations across turns", one-shot or continuable
  children, with `ctx.subagents` as the service and backends `dsh-subagent-spawn-in-process`
  / `dsh-subagent-fork-in-process` plus the `dsh-tool-subagent` tool
  (`$DSH\dsh-subagent\README.md`, `lib\types\index.d.ts`). This is the natural host for a
  cheap-model small brain if the bench shows one is needed. **Honesty:** dsh-facts.md does
  not list subagent rows among the acp profile's mounts, and my own grep of the acp
  package found the strings but no confirmed default row — enabling it is a one-row
  composition change, the same pattern dsh-facts.md documents for the sessionQuery FTS
  patch. The bench's minimal-prompt model loop does not depend on it.
- **What DSH does NOT give (and what the plugin therefore owns).** No built-in async task
  queue, no scheduler, no mid-turn model interrupt: dsh-facts.md's verified surface lists
  no queue or scheduler service, and its gap section names the closest misses ("no
  lesson/insight store, no reflection scheduler"). Turns are sequential per session, and
  the goal round driver's continuation trigger timing is not documented. The plugin
  therefore owns: the plan store and executor, the signature ledger, generation counters,
  the safe-hold policy, escalation queueing and delivery, expiry enforcement, and the
  search-rationing cache. That is a bounded, inspectable surface — all of it ordinary
  plugin files plus two tools — which is the honest price of "intelligence stays online"
  on today's runtime.

## Best evidence

- **Round-1 bench, the problem measured.** Every model-in-the-loop architecture pays
  idle-while-thinking (farm: llm 0.36, hybrid 0.35; mine: llm 0.28) and every fixed
  executor shows 0.00; the mine's model-in-the-loop failures "are bodies standing still
  while a call was in flight"; llm mine success moved 50–70% between replicas purely on
  wall-clock interleaving, while fixed-executor rows were identical
  (`origin/behavior-research:research/behavior-debate/REPORT.md`). G2 skill-gap p95
  ~20 s and G1 idle ~0.9 in the baseline (BRIEF.md). The split is the architecture that
  takes the fixed executor's 0.00 idle and *keeps* the model's learning — the two rows of
  round 1's table are its two halves.
- **SwiftSage — the dual-system result.** System 1 ("Swift", a small LM fine-tuned on
  oracle trajectories) handles fast acting; System 2 ("Sage", a large LLM) does "subgoal
  planning and grounding"; a "heuristic method" integrates the two; on 30 ScienceWorld
  tasks it "significantly outperforms other methods such as SayCan, ReAct, and Reflexion";
  NeurIPS 2023 spotlight, design goal "a more efficient and robust problem-solving
  process" ([abs](https://arxiv.org/abs/2305.17390)). My default System 1 is fixed code —
  cheaper and fully deterministic — with the cheap-model upgrade benched separately; the
  paper is the existence proof the split beats monolithic loops on interactive tasks.
- **SayCan — division of labor as grounding.** The LLM supplies high-level semantic
  knowledge and proposes candidate steps; affordance/value functions of pretrained skills
  score feasibility in the current physical context; the robot acts "as the LLM's hands
  and eyes" ([abs](https://arxiv.org/abs/2204.01691)). The small brain is exactly the
  affordance layer: it rejects/holds what the body cannot do and runs what it can, while
  the big brain owns semantics.
- **Inner Monologue — the escalation loop.** Closed-loop language feedback from success
  detection, scene description and human interaction "significantly improves high-level
  instruction completion" across simulated/real tabletop rearrangement and long-horizon
  mobile manipulation; plans must account for how and when, with answers that change as
  actions execute ([abs](https://arxiv.org/abs/2207.05608)). My status outbox is that
  feedback channel; escalation is its failure branch.
- **PUBG Ally (Krafton × NVIDIA ACE) — shipped at product scale.** "A System 1 layer,
  implemented as a behavior tree, handles fast, reactive gameplay … at game tick rate";
  the language model handles intent, coordination and speech; "**Reflex-level actions
  never have to wait for the model**"; game actions are "handed to the game side, where a
  behavior tree executes them"; and the team's hardest problem was "defining the boundary
  between those two layers" ([NVIDIA developer blog](https://developer.nvidia.com/blog/how-krafton-built-pubg-ally-a-co-playable-character-powered-by-nvidia-ace),
  fetched 2026-10-24). My protocol *is* that boundary, written down — with the honesty
  that Ally's System 1 is a behavior tree and its decision model is one on-device SLM
  (the large LLM was an offline distillation teacher), which matches my default of fixed
  code under a deliberative model.
- **CLIN — the controller/executor split measured.** CLIN's controller generates goals
  and selects memory; its executor turns goals into admissible actions; ablating the
  controller costs **−18.1 points** ([full text](https://ar5iv.labs.arxiv.org/html/2310.10134),
  notes-classics). The split is not overhead; it is the load-bearing tier.
- **RSIAgent — the roles separated over one memory.** Curriculum, actor and verifier
  agents over actor-authored, verified memory; the verifier trusts only environment
  feedback ([notes-rsi.md](notes-rsi.md), https://arxiv.org/abs/2609.15364). My split is
  that separation in time: small brain = actor on verified plans; big brain = curriculum +
  verifier + memory, invoked by escalation.
- **HarnessPro — improve the harness, keep cost first-class.** RSI that evolves the
  harness (instructions, tools, hooks, verification) beat single fixes that were
  "Pareto-dominated by fully evolved harnesses — the loop's synergy, not any one trick"
  ([notes-rsi.md](notes-rsi.md), https://arxiv.org/abs/2610.26770). The plan protocol is
  harness; the two-brain split is the synergy other options assemble one trick at a time.
- **Generative Agents — budgeted background reflection.** Reflection triggers when the
  importance sum of recent events crosses a threshold (150), yielding ~2–3 reflections per
  agent-day, and plans are re-planned on reactions — reflection is *scheduled*, not
  per-event ([full text](https://ar5iv.labs.arxiv.org/html/2304.03442), notes-classics).
  My escalation ledger is exactly such a threshold trigger, and it fires in the big brain
  without stopping the world.
- **Voyager — the library as small-brain ammo.** The skill library ("an ever-growing
  skill library of executable code for storing and retrieving complex behaviors" — repo
  README, [github.com/MineDojo/Voyager](https://github.com/MineDojo/Voyager), ~7.3k stars,
  fetched 2026-10-24) is retrieved per task (top-5 by embedding) and committed only after
  self-verification; it transferred plug-and-play to fresh worlds and drove 3.3× more
  unique items and 15.3× faster tech-tree milestones (notes-classics). In my architecture
  `run-skill` steps are how that library reaches the body *between* model turns.

## Extensibility across games

The judge's weighted criterion, addressed directly:

- **The plan vocabulary is the body port's vocabulary.** `walk-to-tile`,
  `face-and-press`, `raw-input-steps`, `wait-until`, `run-skill`, `observe` — all are
  port-shaped primitives the adapter already declares (`BodyInputStep`, role buttons,
  until conditions). A new game's adapter exports new buttons and facts through the same
  port; the executor, signature counter, generation logic and safe-hold policy are
  untouched. Round 1 measured this class of claim: zero-code ports are real (llm 3/3 on
  toy2 at 0 port lines), while authored fixed logic 0/3 (modes, llm-bt, hybrid all failed
  one-shot authoring on the new game) — my executor ships *no* authored tactics, so there
  is nothing to fail at authoring time.
- **The small brain ships no game facts.** Reflex rows are per-game *data files* loaded at
  runtime (the existing `reflexes/stardew-valley.json` pattern — data, not code); skills
  and lessons are learned data. The only constants in small-brain code (K=3, one-day
  backstop window, retry budget) are game-agnostic config, not game knowledge.
- **What the big brain must learn per game, and where it lives.** Which buttons mean what
  (learned into lessons/skills as data), when to wait vs re-route (the `falsifier` and
  `wait-until` vocabulary make this expressible), the mapping from goal language to plan
  shapes. All of it lives in plugin-owned files (ledger, skill store, lesson store) keyed
  by the game/save identity option (b) defines — never in code. The bench's `loc.json`
  will show it: the split's machinery is shared `loc_core`; per-game content is model-
  written data files, and the game-specific line count stays near zero.

## Anticipated attacks and your answers

**1. "Two brains = two places to debug; nondeterminism — a misbehaving companion must be
explainable from logs."**
There is exactly one place where *semantics* are decided (big brain) and one where
*execution* is deterministic (small brain) — that is fewer confounds than the incumbent,
where one turn mixes both and timing interleavings moved mine success 50–70% between
replicas while fixed-executor rows held identical (round-1 REPORT). The replay trail is
complete by construction: every plan is a logged artifact (id, intent, falsifier, bounds,
generation), every escalation is a ledger line (signature + K outcomes), every step outcome
is the game's own task status. A misbehavior is explained by: which plan, which step, which
outcome, which ruling. If the cheap-model small brain is enabled, its decision space is
deliberately tiny (skill selection, target adjustment) and it degrades to fixed replay when
uncertain — the nondeterministic surface grows only if the bench shows it earns its keep.

**2. "Plan replacement mid-flight can yank the body around mid-action — safety."**
Replacement happens only at step boundaries; steps are atomic and short (one walk leg, one
burst); the current step always completes or ends on a safety `until`/reflex interrupt.
Mid-step cancellation is reserved for safety (game paused, reflex burst), never for plan
updates — worst-case lag after a ruling is one step, the same run-to-completion discipline
SayCan's skills follow between grounding steps
([SayCan](https://arxiv.org/abs/2204.01691)). The frozen-tail rule means a suspect plan
cannot execute *more* risky steps while awaiting its ruling; the body goes to safe-hold.
And `expiresAtTick`/`maxSteps` bound any plan's life so nothing runs unattended.

**3. "Escalation latency: while the big brain thinks the body still fails — how is that
bounded?"**
Three bounds. (i) *Detection:* failing behavior stops at K=3 — bounded wasted attempts —
and the frozen tail stops the costly pattern entirely (wall scenario: swings stop, health
drain stops). (ii) *Reflection cost:* the first move on escalation is retrieval over
already-stored lessons (~0 marginal calls — the round-1 skills row ran mine at ~0.1 calls
from library retrieval), search is rationed to ≤1 per escalation and cached; short-call
turns are honestly ~1–5 s (round-1 concession), not the ~20 s authoring p95. (iii) *The
body is not idle during it:* safe-hold is deliberate, visible, and cheap. The honest
residual: if the plan is exhausted, the body waits for the ruling — that delay is bounded
by turn latency plus the round driver's continuation cadence, which dsh-facts.md does not
document precisely; `recovery_ticks_mean` in the bench measures exactly this, and if the
cadence proves slow, the fix is a profile/composition change (goal driver tuning), not a
redesign.

**4. "This is just option (d) batching plus a stuck detector — why is the async split more
than its parts?"**
Because (d) as benched is still synchronous: the executor "stops on the first failure" and
returns a digest *inside the same blocking turn* — the plan dies when the turn ends, and
the reflection (a) appends still consumes the turn the body waits on. HarnessPro's own
ablation is the general answer: single fixes are "Pareto-dominated by fully evolved
harnesses — the loop's synergy, not any one trick"
([notes-rsi.md](notes-rsi.md), https://arxiv.org/abs/2610.26770). The split is the
composition the others assemble implicitly, made explicit and non-blocking: (d)'s batching
is my executor's degenerate case (a plan of 8 steps that never escalates); (a)'s detector
is my signature ledger, running concurrently instead of pausing the body; (b)'s library is
where my verified lessons land; (c)'s exploration is what the big brain plans when a goal
is blocked-but-waitable (`wait-until` plans). Only the split keeps the body moving *while
learning happens* — round 1's finding 1 says every model-in-the-loop option pays idle;
the split is exempt by construction, not by tuning.

**5. "A cheap-model small brain makes game-specific mistakes a fixed executor would not."**
Two answers. First, the default is fixed code; the cheap model is an optional upgrade, and
the owner's bench spec already demands the head-to-head (`smallbrain=code` vs
`smallbrain=flash` per the amendment), measured on success, `repeated_failures_mean`,
`recovery_ticks_mean`, `actions_per_game_minute`, and a small-brain-mistake count vs the
fixed executor on the same seeds. Second, the fixed executor's own failure mode is
documented: round 1's toy2 port — authored fixed logic (modes, llm-bt, hybrid) went 0/3
because one-shot authoring of game-specific tables failed, and handcoded needed a rewrite
per game — which the owner's no-game-facts rule forbids anyway. A cheap model bound to my
boundary (no plan authorship, no counter resets, no success claims) can only err within a
step, and the game's own task status — not the model — decides whether the step worked
(RSIAgent's verifier rule, notes-rsi.md). Its mistakes are counted by the bench, not
argued.

## References

Fetched by me (in [sources-async.json](sources-async.json)):
- SayCan — Do As I Can, Not As I Say: https://arxiv.org/abs/2204.01691
- Inner Monologue: https://arxiv.org/abs/2207.05608
- Voyager repo: https://github.com/MineDojo/Voyager
- SwiftSage: https://arxiv.org/abs/2305.17390
- Krafton PUBG Ally on NVIDIA ACE: https://developer.nvidia.com/blog/how-krafton-built-pubg-ally-a-co-playable-character-powered-by-nvidia-ace

Reused from notes-rsi.md (fetched there, not refetched):
- RSIAgent: https://arxiv.org/abs/2609.15364 ; https://arxiv.org/html/2609.15364v2
- HarnessPro: https://arxiv.org/abs/2610.26770

Reused from notes-classics.md (fetched there, not refetched):
- Reflexion: https://arxiv.org/abs/2303.11366 ; https://ar5iv.labs.arxiv.org/html/2303.11366
- Voyager: https://arxiv.org/abs/2305.16291 ; https://ar5iv.labs.arxiv.org/html/2305.16291
- ExpeL: https://arxiv.org/abs/2308.10144
- AWM: https://arxiv.org/abs/2409.07429 ; https://arxiv.org/html/2409.07429v1
- CLIN: https://arxiv.org/abs/2310.10134 ; https://ar5iv.labs.arxiv.org/html/2310.10134
- Generative Agents: https://arxiv.org/abs/2304.03442 ; https://ar5iv.labs.arxiv.org/html/2304.03442

Repository facts (no URL):
- dsh-facts.md — verified DSH 0.2.0-rc.2 seams: ctx.web, web_search cost, goals + round
  driver, PTC, pre-step admission, no memory/scheduler/queue service, sessionQuery FTS
  patch pattern.
- bench/README.md — round-2 scenarios, metrics (signatures, repeated_failures_mean,
  recovery_ticks_mean, actions_per_game_minute), actionrate's plan_submit executor, model
  `deepseek-chat` served as `deepseek-flash`.
- Round-1 report (`git show origin/behavior-research:research/behavior-debate/REPORT.md`)
  — idle-ratio table, mine failure mode, toy2 authoring results, ~1–5 s short-call
  concession.
- Plugin sources: `packages/dsh-companion-plugin/src/body/reflex.ts` (reflex-tier
  position), `src/index.ts` (turn markers, defineTool, goals), `src/body/port.ts`
  (BodyPort/BodyInputStep), `src/mind/` (ledger, MindContext).
- Subagent seam verified in the global install: `$DSH\dsh-subagent\README.md`,
  `$DSH\dsh-subagent\lib\types\index.d.ts` (`ctx.subagents`).
