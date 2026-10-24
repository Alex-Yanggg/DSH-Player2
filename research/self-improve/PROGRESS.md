# Progress log: self-improvement research (round 2)

Task contract: [TASK.md](TASK.md). Shared advocate context: [BRIEF.md](BRIEF.md). Prior round:
`research/behavior-debate` on `origin/behavior-research` (`git show origin/behavior-research:research/behavior-debate/REPORT.md`).
This file tracks what is done, what is in flight, and what remains. Updated by the orchestrator.

## Status checklist

- [ ] Setup: bench copied from origin/behavior-research into `bench/`, adapted, committed
- [ ] DSH 0.2.0-rc.2 facts (memory / `--profile acp` / web search) with file paths -> `dsh-facts.md`
- [ ] Required reading fetched, cited in `transcripts/sources.json`
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
