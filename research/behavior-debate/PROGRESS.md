# Progress log: behavior-architecture debate

Task contract: [TASK.md](TASK.md). Shared context: [BRIEF.md](BRIEF.md). This file tracks what
is done, what is in flight, and what remains. Updated by the orchestrator throughout.

## Status checklist

- [x] (a) Advocates: 10 sub-agents, transcripts + fetched-citation sources (134 unique URLs in transcripts/sources.json)
- [x] (b) Cross-examination: 3 rounds assembled (round-1/2/3.md) + finalists picked with explicit criteria (finalists.md)
- [x] (c) Bench: sim scenarios (farm + mine wrapper on the unmodified sim-adapter), finalist prototypes,
      toy2 porting, results (runs.json, runs-toy2.json, metrics.csv, loc.json, summary.json)
- [x] (d) REPORT.md with filled metric table, citations, porting, risks
- [x] One local commit on `behavior-research` (no push, no AGENTS.md changes) — see log

## Log

- 2026-10-24: Read TASK.md, repo docs (README, architecture, operating-model), body contracts,
  sim-adapter, navigation/walk helpers, body tools. Wrote BRIEF.md for the advocates. Next:
  launch the 9 advocate sub-agents in parallel, then build the bench harness while they research.
- 2026-10-24 (run 2): Resumed. Verified repo state (branch behavior-research, only research/
  untracked). Read sim-adapter.ts, port.ts, navigation.ts, walk.ts, tools.ts in full; confirmed
  toolchain (node v24.19, npm workspaces, vitest; contracts dist built; `npx -y tsx` usable for
  bench). Found DEEPSEEK_API_KEY in env -> bench will try REAL model calls (deepseek-chat) with a
  disk cache; fall back to scripted stubs if the API is unusable, marking stub numbers clearly.
  Launched 10 advocate sub-agents in parallel (fsm, llm-bt, skills, modes, utility, goap, rl, llm,
  hybrid, model). While they research: building bench harness (scenarios, metrics, model client).
- 2026-10-24 (run 2, cont): All 10 advocate openings COMPLETE (transcripts/advocate-*.md +
  sources-advocate-*.json; 134 unique fetched URLs merged into transcripts/sources.json). Notable:
  llm-bt disproved the brief's PORTAL attribution and found the real one (Xu et al. 2503.13356);
  model found miHoYo's actual paper (GameScaling, arXiv:2610.28698).
  Bench COMPLETE and smoke-tested: 7 prototypes (llm baseline, handcoded FSM, skills, llm-bt,
  modes, goap, hybrid) each passing farm+mine pilots; real DeepSeek calls (deepseek-chat served
  as deepseek-flash) with a disk cache + latency replay. DSH-style goal rounds (goalCheck) wired
  into every approach. toy2 (Keycraft: keys/doors/materials/crafting, keyboard inputs) built with
  same-shape port; ports verified: llm 36 calls SUCCESS, goap 1 call SUCCESS (planner composes
  the door dependency), handcoded SUCCESS (full rewrite); llm-bt/modes/skills/hybrid FAILED
  toy2 authoring within their repair budgets (one-shot authored data could not compose the
  lock-and-key dependency on this model — a key extensibility finding, reported honestly).
  LOC/porting counter (bench/lib/loc.ts -> results/loc.json): llm 83 core/0 port; llm-bt 333/0;
  modes 365/0; skills 217/0; goap 340 core+39 data/213 port; hybrid 207/0; handcoded 115/49.
  Fixed along the way: tool-parameter double-wrap, DONE parsing, latching success, GOAP
  count/effect-verify/reachTile-termination/craft-goal-semantics + BFS taken-set + reachability,
  BT re-author loop, mode/hybrid revision digests with macro tails.
  Round 1 COMPLETE (round1-*.md x10 assembled into round-1.md). Round 2 dispatched.
  Remaining: rounds 2-3, finalists.md, full matrix runs (10 seeds x 2 scenarios x 7 approaches),
  toy2 runs, REPORT.md, bench/README.md, one local commit.
- 2026-10-24 (final): Rounds 2 and 3 COMPLETE (round-2.md, round-3.md; every advocate answered
  every attack on itself each round; round 3 added honest closing positions). finalists.md
  finalized: llm, modes, goap, skills, hybrid (llm-bt + handcoded kept as reference rows).
  Matrix COMPLETE: 140 runs (7 approaches x farm/mine x 10 seeds, real-time sims, real
  deepseek-flash calls) + 21 toy2 runs; results in results/{runs,runs-toy2,summary}.json,
  metrics.csv, loc.json. Key numbers: farm — all of llm/modes/goap/skills/llm-bt/handcoded
  10/10, hybrid 9/10; mine — goap 9/10 @1.2 calls, skills 8/10 @0 (library), handcoded 8/10,
  llm 7/10 @6.1, modes 2/10, llm-bt 1/10, hybrid 2/10; toy2 — llm 3/3 @30 calls, goap 3/3 @1,
  handcoded 3/3 @0 (49 port lines), all four one-shot authored-data approaches 0/3. REPORT.md
  written (per-approach arguments + surviving attacks + filled metric table + porting + risks,
  no winner picked). A stray first matrix run briefly overlapped the recorded one (same code,
  shared cache); the reported artifacts come from the clean single-process rerun
  (bench/matrix-clean.log). Remaining: verify the clean rerun's numbers match the report,
  final audit vs TASK.md, one local commit.
