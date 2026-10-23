# Task: behavior-architecture debate + experiments

Branch: `behavior-research` (already checked out). Work only under `research/behavior-debate/`.
Do not edit product code in `packages/`, do not edit or commit `AGENTS.md`, do not touch any Stardew Valley save,
do not push, do not change `pnpm-lock.yaml` (put any extra deps in a nested package.json under this folder only if unavoidable).

## Goal

Decide, with evidence, the best behavior architecture for the Player2 companion: how it turns a player goal
("plant and water the parsnips", "get to the ladder") into in-game actions. Player2 is a DeepSeek Harness (DSH)
plugin; every candidate must be implementable as a DSH plugin (tools, prompt sections, turn-flow events, setup
callback; see README.md and docs/architecture.md, docs/operating-model.md "design principle"). No second harness.

## (a) Advocates — at least 6

Run each advocate as a separate GLM sub-agent (use ZCode's own sub-agent/Task tool or workflow mode; there is no
GLM API key in the environment, so the GLM you are running on IS the model). Each researches with web search/fetch
and defends ONE approach. Not limited to, but at least covering:
1. Hand-written behavior trees / state machines.
2. Behavior trees as data, authored and edited by the LLM (e.g. PORTAL, Code-BT, LLM-BT papers).
3. LLM-written code skills + skill library (Voyager, Mindcraft, DSH's own PTC / run_code mode).
4. Data-driven reflex/modes layer under an LLM (Mindcraft modes, PUBG Ally / "system 1 + system 2").
5. Utility AI; and GOAP/HTN planners with LLM-produced goals/domains.
6. RL or small learned policies.
7. Pure LLM tool calling (today's baseline in this repo).
8. Hybrids (advocates may propose their own).
9. Model-level game-playing agents: miHoYo's recently announced game-playing model that figures out new games on its
   own, generalist agents such as Google DeepMind SIMA, Lumine-style vision-language-action models. This advocate must
   first research what these actually are (architecture, inputs/outputs, latency, availability), then argue how one
   could fit — or could not fit — behind a DSH plugin (e.g. as a "body" tool or a perception/action model the LLM calls).
The judge will weight extensibility across many games while staying a DSH plugin, so every advocate must address it.
Each advocate writes `transcripts/advocate-<name>.md`: claim, mechanism, how it fits DSH seams, best evidence,
citations as URLs it actually fetched (list them in `sources.json` with fetch date and a one-line note).

## (b) Cross-examination — at least 3 rounds

Each round every advocate attacks at least two rivals' concrete claims and answers attacks on itself, with evidence.
Save `transcripts/round-<n>.md`. After the rounds pick up to 5 finalists by explicit criteria written down in
`transcripts/finalists.md` (the advocates do not pick a single winner).

## (c) Experiments

Build `research/behavior-debate/bench/` (TypeScript, run with the repo's existing toolchain, e.g. `npx tsx` or vitest):
- Reuse the plugin's body simulator `packages/dsh-companion-plugin/src/body/sim-adapter.ts` (import it; do not modify it).
- Scenarios, each with fixed seeds and at least 10 runs per approach:
  - farm: till/plant/water parsnips on a small plot;
  - mine-like: reach a goal tile with hostile monsters and low health (extend via a wrapper in bench/, not by editing sim-adapter).
- A minimal prototype for each finalist. Where an approach needs a "model", use a real GLM call if you can make one from
  the script; otherwise use a recorded/scripted model stub and say so clearly in the report (record which numbers come from a stub).
- Metrics per approach x scenario: success rate, LLM calls per task, wall-clock time, idle ratio (body idle while waiting
  on the model), stuck/recovery count, product lines of code (count non-test lines in the prototype), porting cost.
- Porting cost: write a tiny second toy game in `bench/toy2/` with a different state and input vocabulary (e.g. a
  top-down grid crafting game with keys instead of tiles/tools), port each prototype, and count changed/added lines.
- Raw results to `results/*.json` and `results/metrics.csv`; one command reruns everything: document it in `bench/README.md`.

## (d) Report

`research/behavior-debate/REPORT.md`: per approach its strongest arguments and the strongest attacks that survived,
citations (only URLs actually fetched), the metric table (filled, with stub-vs-real marked), porting results, open risks.
Do NOT pick a winner; a separate judge will.

## Done when

REPORT.md exists with a fully filled metric table, the bench rerun command passes, and all transcripts/raw data are files
under `research/behavior-debate/`. Then make one local commit on `behavior-research` (do not push).
