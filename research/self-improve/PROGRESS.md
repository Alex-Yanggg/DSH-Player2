# Progress log: self-improvement research (round 2)

Task contract: [TASK.md](TASK.md). Shared advocate context: [BRIEF.md](BRIEF.md). Prior round:
`research/behavior-debate` on `origin/behavior-research` (`git show origin/behavior-research:research/behavior-debate/REPORT.md`).
This file tracks what is done, what is in flight, and what remains. Updated by the orchestrator.

## Status checklist

- [x] Setup: bench copied from origin/behavior-research into `bench/`, adapted, committed
- [x] DSH 0.2.0-rc.2 facts (memory / `--profile acp` / web search) with file paths -> `dsh-facts.md`
- [x] Required reading fetched, cited in `transcripts/sources.json`
- [ ] Advocates: openings for options a-e (sub-agents, pairs)
- [ ] Cross-examination: >= 3 rounds assembled
- [ ] Bench: locked-area + repeated-wall scenarios on the sim and toy2; approaches a-e; matrix runs (>= 10 seeds)
- [ ] REPORT.md with findings, arguments, attacks, filled metric table, cross-game cost, risks; no winner
- [ ] Committed and pushed at each milestone

## Log

- 2026-10-24: Read TASK.md. Branch `self-improve-research` verified (based on origin/behavior-layer @ 22aee00).
  Extracted `research/behavior-debate/bench` from origin/behavior-research into `bench/` including the LLM disk
  cache (2.3 MB, 1584 entries; baseline prompts that stay identical replay for free). `npx tsc -p bench/tsconfig.json`
  clean against the current (post-P2-0019) plugin sources; `npx tsx smoke.ts farm` passes (handcoded, no LLM).
  DEEPSEEK_API_KEY present (35 chars). Next: DSH facts + literature fetch, then advocates in pairs.
- 2026-10-24 (cont): Bench extension COMPLETE: `lib/locked.ts` + `lib/wall.ts` (locked-area and repeated-wall scenarios on the unmodified sim-adapter via subclass+wrapper; compressed day clock 350 ticks/day with consistent timeOfDay), `toy2/variants.ts` (Keycraft locked/wall variants, "write another toy game" route), `lib/web-sim.ts` + `lib/corpus/*.json` (deterministic offline wiki; facts discoverable only in-world or via search), `lib/driven.ts` (shared tool loop) + `lib/approach-{reflect,library,curriculum,actionrate,combo}.ts` (options a-e), new metrics in port/harness/runner (task signatures, repeated-failure count, recovery ticks, actions per game minute). `check-scenarios.ts` all pass; 24 option x scenario smokes green on real deepseek-flash calls (BENCH_NO_SLEEP_CACHE for plumbing). Fixes found by smokes: wall goal text now matches ground truth (stand on the bell tile); golem attacks now end the task "interrupted" so the repeat-failure metric sees them; goal latching added to the loop and baseline (no post-success call burn); b/e library stores namespaced per approach. Committed 2f1031c, pushed.
- 2026-10-24 (cont): BRIEF.md written for the self-improve debate. Matrix launched in background (llm,reflect,library,library-cold,curriculum,actionrate,combo x locked,wall,toy2-locked,toy2-wall x seeds 1..10; warm library sequential in seed order). Advocates a+b launched (pair 1).
