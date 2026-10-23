# Cross-examination round 1 — advocate-llm

## Attack on advocate-modes

Claim under attack: "the pure-tool-calling baseline spends a model round-trip per surprise while the body stands idle" and "zero model round-trips to not die in the mine," justified by a monster "3 tiles out" arriving "in ~0.8 s."

Two problems. The 0.8 s is a toy-sim artifact — from `SimAdapter`'s limits (`SPEED = 4`, `tilePx = 64`, 60 Hz → ~267 ms/tile), not a shipped game. And it misdescribes my loop: the model arms `until: { monsterWithin: r }` *before* entering danger; the adapter evaluates it every tick (`sim-adapter.ts` `playTick`), so the body stops the tick the monster crosses radius `r` — not when the model answers. The radius *is* the latency budget, chosen by judgment — what a fixed `danger_flee` cannot do without per-game tuning. Their ~100–250 ms poll buys nothing for survival the tick-rate interrupt hasn't done; it buys a flee macro whose thresholds (`healthBelowPct: 35`, `minDistanceTiles: 6`) are per-game magic numbers — exactly the fixed logic per game the judge's criterion taxes. Their own scenario ends with "the next model turn... can re-plan": the model still decides; a tuned table sits in between.

## Attack on advocate-skills

Claim under attack: "Pure tool calling pays that per-call tax on every leg of every goal forever."

False about the code. `body_walk_to` is one call under which `walkTo` runs up to 14 legs autonomously — planning, held steps, blocked-tile marking and replanning (`settle()`, `walk.ts`) — zero model calls between legs, honest failure text at the end. A farm chore is a handful of calls, not per-leg. Their steady state ("one model round-trip... runs locally to completion") describes `body_walk_to` plus a per-game folder of model-written code. For THIS product that folder is the wound: they concede the sandbox "do[es] not themselves promise a security boundary," so every skill is code a trust product must review per game — a recurring burden booked as "data." MAST finds agent-system failures concentrate in system-design and coordination categories ([arXiv:2503.13657](https://arxiv.org/abs/2503.13657)); Anthropic says add layers only when they "demonstrably improve outcomes" (fetched).

## Attack on advocate-llm-bt

Claim under attack: "That is the ONLY model call needed for the whole chore" with "the smallest porting cost in this debate by construction."

Their own evidence contradicts the first half: iterative regeneration scored the same 12/17 as one-shot at 7,770 vs 5,075 tokens (LLM-as-BT-Planner, their citation) — authoring is iterative, so calls-per-goal is 1 + re-authors. Their sample trees hard-code tile coordinates (`walkTo {x:4,y:6}`) and button timings — a snapshot plan gone stale when the player tills a tile mid-goal; reactive guards re-check *conditions*, not the stale *structure*. My loop re-reads state at every decision. Debugging gains two more artifacts — tree JSON plus per-tick trace to correlate against DSH's log; I keep one causal chain.

## Attack on advocate-goap

Claim under attack: "LLMs demonstrably cannot reliably do multi-step planning over exact state" (LLM+P: 66% vs 29%).

Those are PDDL string puzzles; on embodied tasks ReAct beat imitation- and RL-trained baselines by +34% absolute on ALFWorld with one-two examples (arXiv:2210.03629, fetched). Our goals are short delegated chores verified in every tool result (inventory diffs, `watered` flags), not IPC-hard search. Their port: a new `domains/<game>.json` plus a per-game grounding extractor — a larger authored artifact than my single declaration.

## Standing answers

- **"Idle while thinking":** the body idles only at decision points; legs and input batches run unattended, danger interrupts are tick-rate. Worst case is bounded by output size (500 tokens ≈ >15 s, ClickHouse); tool outputs are capped (`renderObservation` ≤ 45 objects).
- **"Dithering":** real (WebArena 14.41% vs human 78.24%) but bounded here: delegated goals, verification in every result, `walkTo`'s 14-leg honest give-up, DSH goal rounds, and a persona that asks the player.
- **"No determinism":** the substrate (A*, `pathToSteps`) is deterministic and tested model-free; acceptance is statistical over fixed seeds, per the bench.
- **"Every rival keeps the model":** their seams prove it — `body_run_behavior`, `behavior_run`, `skills_bind`, `body_execute_plan`, `body_skill`, `body_policy`, `modes_set` are all tools *the model calls*. The question is whether per-game artifacts belong between model and body; I say no — the hybrid's fallback, "ship the executor with zero directives (pure baseline, unchanged)," concedes the baseline is everyone's substrate.
