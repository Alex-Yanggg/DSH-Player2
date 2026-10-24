# Task: research round 2 — a companion that grows on its own

Branch: `self-improve-research` (based on origin/behavior-layer). Work only under `research/self-improve/`.
Do not edit product code in `packages/` or `e2e/`, never commit `AGENTS.md`, never touch the owner's Stardew saves,
do not change `pnpm-lock.yaml`. Commit and push to `origin self-improve-research` at each milestone.
Progress log (outside the repo): `C:\Users\user\Desktop\self-improve-progress.md`, one line per finished step.

## Problem seen in real play (P2-0019 mine e2e, see C:\Users\user\Desktop\p2-0019-progress.md and e2e/artifacts/2026102413*)

1. World knowledge gap: the companion did not know the mine is closed early in the game (spring-5 landslide) and lost days to it.
2. It hits the same wall repeatedly without stepping back and changing approach.
3. It does very little per in-game day.
4. Its action rate is low (long gaps between actions; G2 skill-gap p95 ~20 s, G1 idle ~0.9 in the baseline).

The owner rules out writing game content into code (no hardcoded game facts, no per-game rule tables for knowledge).
They want the companion to grow by itself: web search + RSI-style (recursive self-improvement) learning.

## Required reading (fetch, cite real URLs in sources.json)

- arXiv 2609.15364 (RSIAgent) and Zhipu's open-source agent RSI work released this week (find it).
- Reflexion, Voyager, ExpeL, and similar (Agent Workflow Memory, CLIN, Generative Agents reflection, etc.).
- DSH 0.2.0-rc.2 published packages (installed globally, see `dsh --version`, the global pnpm node_modules
  `@deepseek-ai/dsh-*` READMEs and .d.ts): does it have any built-in cross-session or project memory, and what is
  available under `dsh --profile acp`? Does it ship a web search tool a plugin can use? Report facts with file paths.

## Options to debate (one advocate sub-agent each, plus any others they propose)

a. Stuck detector + reflect-and-search step that writes lessons (Reflexion/ExpeL style), with web search for world facts.
b. Persona-level library shared across saves (lessons + skills), one DSH session per save; how a save is identified
   (the game's own unique save id vs. any watermarking), how memory is loaded transparently, and what is shared.
c. Exploration-first curricula (Voyager-style automatic curriculum; "learn the world before the goal").
d. Action-rate fixes: fewer model round-trips per action (batched plans, skills, reflex tier, streaming tool calls).
e. Combinations.
Every option must be a DSH plugin (no second harness, no hardcoded game facts). Run >= 3 cross-examination rounds as in
research/behavior-debate (on origin/behavior-research; `git show origin/behavior-research:research/behavior-debate/...`).

## Bench

Copy what you need of `research/behavior-debate/bench` from origin/behavior-research into `research/self-improve/bench`
and extend it:
- A "locked area" scenario: the goal is behind an area that is closed until a condition (time/day/event) the agent does
  not know; the fact is discoverable only via a (simulated, deterministic, offline) web-search tool or by exploration.
- A repeated-wall scenario: one approach always fails; success needs a different approach.
- Run on the plugin's sim and on a second toy game (reuse toy2 or write another).
- Metrics per option x scenario (>= 10 seeds): success rate, repeated-failure count (same failing action/approach
  retried), time to recover, actions per game minute, lines of code per game (game-specific lines), LLM calls.
- Real model calls via DEEPSEEK_API_KEY with a disk cache, as before; mark any stub numbers.

## Report

`research/self-improve/REPORT.md`: findings on DSH memory/search facilities, each option's best arguments and surviving
attacks, the metric table, cross-game cost, open risks. Do not pick a winner. Then commit and push.
