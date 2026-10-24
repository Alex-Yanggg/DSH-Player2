# P2-0020 A Companion That Grows: Build Plan

Judge ruling on research round 2 (`research/self-improve/REPORT.md` on branch `self-improve-research`, commit d16c59b), plus the build plan for ZCode goal mode. It builds on P2-0019 ([p2-0019-behavior-layer-plan.md](p2-0019-behavior-layer-plan.md)) on the same branch.

## Ruling

Winner: **three-layer library plus reflect, with an async body.** All inside the DSH plugin, zero game facts in code or prompt.

- **Three-layer memory (owner-agreed).** Persona library (lessons and skills, shared by every save of that persona), save memory keyed by the game's own save id (facts and progress about that world), and a session per sitting that loads both at start and distils new lessons back at the end. Evidence: calls on the locked scenario fell from 19.0 to 10.9, and later sittings needed about 40% fewer calls than the first. DSH 0.2 has no cross-session memory service, so this is ours; reuse the existing ledger and dream code instead of adding a parallel store.
- **Reflect.** A generic stuck detector: the same action signature (tool plus target) repeated with no change in the observed state counts as one wall; on the third hit the body stops and the mind gets a stuck fact with the recent attempts. The mind then steps back: re-reads the world, may use DSH's own `web_search`, and writes a lesson. A lesson is only promoted to the persona library after the approach it suggests succeeded once.
- **Async body (owner's big/small brain).** The DSH session is the big brain: it plans, reflects and searches without blocking. The small brain is plain code in the plugin: it keeps executing the current plan steps (body tools, skills, reflexes) while a model turn runs. A cheap model as the small brain is ruled out (0/20 on toy2, hit the call cap every time). The small brain must include the stuck detector; without it async had 12 to 15 repeated failures per run and only 0.6 success on the wall scenario.
- **Stale plans:** a plan step whose expected change does not happen is the same signal as a wall. No game-specific rules.

Out of scope this round: computer-use vision (backlog, fallback for games without a mod), cross-persona sharing.

## Build plan (ZCode goal mode)

Branch: `behavior-layer`, on top of P2-0019. Never commit `AGENTS.md`. Never touch the owner's own Stardew saves; use test saves only. Lean code, fail loudly, no internal terms or coordinates in companion speech, no game facts in code or prompt.

Code budget: P2-0019 plus P2-0020 together at most about 700 new non-test lines. P2-0019 is already about 800, so T0 must cut first. Report the real count by file.

### T0 Trim P2-0019

- Remove duplication and dead paths in `reflex.ts`, `skills.ts`, `sim-adapter.ts` and the plugin index; keep behavior and tests green.
- Rerun `npm run accept`.

### T1 Three-layer memory

- Persona library under the persona's user data folder: `lessons.md` plus saved skills. Save memory keyed by `uniqueIDForThisGame`. Session-end distil folded into the existing day-end dream step.
- Prompt section at session start: persona lessons and save facts, short, newest and most-used first, with a hard size cap.

### T2 Stuck detector and reflect

- Generic signature in the plugin (tool, target, observed state digest before and after). Three hits with no change: stop the body, send a stuck fact to the mind.
- Guidance text, not rules: step back, look again, search when the world does not explain itself, write a lesson.
- Unit tests on the sim with the locked and wall scenarios from the research bench.

### T3 Async small brain

- A `plan_set` tool: the mind hands over an ordered list of steps (body tool calls or skill runs, each with the change it expects). The small brain runs them in code between and during model turns, reporting progress as facts.
- Any step whose expected change fails to show feeds the stuck detector. Reflexes still preempt.
- Measure idle ratio and actions per game minute on the sim against the round-2 numbers.

### T4 Real game

- Parsnip e2e still green, with G1 to G3 after numbers next to the P2-0019 baseline (idle 0.898, gap P95 20.7 s, 3.91 stuck per hour).
- Mine e2e from a fresh spring day 1 save with no unlock edit: the companion has to find out by itself that the mine opens later, use the waiting days well, then get 10 copper ore within the day cap. Two loops.
- Run it a second time on a new test save of the same persona and report whether the persona library cut the calls or days.
- In-game results confirmed by screenshots and the SMAPI console, never by log files alone.

### Done means

- All above with numbers in the PR body; open the PR from `behavior-layer` to `main` once the parsnip e2e is green and the mine e2e has a result, with failures explained.
