# P2-0019 Behavior Layer and Mine Goal: Build Plan

Judge ruling on the behavior debate (`research/behavior-debate/REPORT.md` on branch `behavior-research`), plus the build plan for ZCode goal mode.

## Ruling

Winner: **learn-as-you-play**, three tiers, all inside the DSH plugin. No second harness, no side process.

1. **Mind (unchanged, the default path).** The DSH session's tool loop stays the brain. It is the only approach that ported to toy2 with zero lines and solved it interactively, so any new game works on day one.
2. **Skills (amortization).** When the mind finishes a sub-task through tools, it may save the steps as a skill: a small JS script run through DSH's own PTC `run_code` seam against the body tools. Saved skills are listed by name and one-line purpose in the prompt; calling one costs one tool call instead of ~19. Fixing the bench's main weakness: skills are **distilled from a successful trace and replayed once before being saved**, never authored one-shot from a declaration. A skill that fails at run time is reported back to the mind with the error and marked stale; the mind decides whether to repair or drop it.
3. **Reflexes (safety, sub-second).** A tiny per-game data table of interrupts (`when` predicate over the raw state, `do` a raw input burst through the existing `until` substrate), evaluated in the plugin between and during body calls. It fixes the mine failure mode (llm 5/10 on mine, death and stalls while waiting for the model). Stardew ships a hand-checked table of a few rows (low health -> eat best food, monster adjacent -> swing weapon or step away, stuck -> unstick). The mind may propose rows, but a row is only accepted after a generic schema validator passes it. Reflexes always tell the mind what fired.

Rejected, with reason:
- GOAP/HTN planner: best mine score (9/10) but every new game needs planner code and a domain model (213 lines for toy2). That is the per-game debt the owner fears.
- BT (hand or LLM-authored): converged to the modes shape with a heavier artifact, and one-shot authoring failed on toy2.
- Hand-coded FSM: full rewrite per game.
- Model-level agents (miHoYo GameScaling, SIMA): a model, not a plugin. Revisit later only as a swappable vision/control tool behind the same body tools.

Why this one: per-game cost is data only (a reflex table plus skills the companion writes itself), the zero-code path is always the fallback, and every tier is thinking guidance plus light constraints, not a fixed behavior tree.

## Build plan (ZCode goal mode)

Branch: `behavior-layer` (this branch). Never commit `AGENTS.md`. Never touch the owner's own Stardew saves; use test saves only. Lean code, fail loudly, no internal terms or coordinates in companion speech. Code budget for T1 to T3: about 400 new non-test lines in total; report the real count.

### T0 Measure first (G1 to G3)

- Add run metrics to the existing e2e harness: idle ratio (G1, target at most 10%), skill-gap P95 in ms between body actions (G2, target at most 200 ms), stuck events per game hour and recovery time (G3, at most 1 per hour, recovered within 5 s).
- Record the baseline on the current parsnip e2e before changing behavior. Metrics come from DSH's own logs plus the mod's state export; no new request logs of our own.

### T1 Reflex tier

- `packages/dsh-companion-plugin/src/body/reflex.ts`: load `reflexes.json` per game, validate it, evaluate rows on each fast state frame during body calls, fire one raw input burst, emit a world fact to the mind.
- `stardew-mod`: if needed, export any extra raw fields the rows read (health, stamina, nearest monster distance). Raw facts only, no behavior in C#.
- Unit tests with the existing fixtures and SimAdapter.

### T2 Skill tier

- Tools `skill_save(name, purpose, code)` and `skill_run(name, args)`; skills stored as files under the per-save data folder. `skill_save` replays the code once and refuses to save on failure.
- Prompt section listing saved skills (name plus purpose only). Use DSH's PTC `run_code` if it works under `--profile acp`; check that first and, if it does not, run the script with the plugin's own body client in-process. Write down which path was used.
- Unit tests: save/replay/stale cycle on SimAdapter.

### T3 Mine goal

- The goal "给我挖 10 块铜矿" (any season): the companion picks up a pickaxe and a weapon, walks to the mine, goes down, mines copper, fights or avoids monsters (reflexes), eats when hurt, comes home before 2 a.m. or passing out, and puts the ore in a chest or keeps it.
- e2e `e2e/test_16_mine.py` from a fresh test character with a native save edit for the scenario (mine unlocked). Two loops are enough.

### T4 Second-game smoke

- Port the toy2 game from `research/behavior-debate/bench` as a minimal in-repo sim adapter only if it costs under 60 lines; the reflex table plus zero code must run its goal through the same plugin. Report the port cost.

### T5 Release 0.2.0

- Add `LICENSE` (MIT, holder Alex-Yanggg), set the README license badge and status lines, bump versions, update `CHANGELOG.md`, and build the mod zip.
- `npm run accept` and `node scripts/verify-docs.mjs` green.

### Done means

- G1 to G3 measured before and after, with numbers in the PR body.
- Parsnip e2e still green; mine e2e green on at least one of two loops, with failures explained.
- In-game behavior confirmed from screenshots and the SMAPI console, never from log files alone.
- PR opened from `behavior-layer` to `main` with metrics, line counts, and the open risks.
