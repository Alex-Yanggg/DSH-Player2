# P2-0013 task contract: native persona runtime

Status: implemented and focused acceptance passed (2026-09-05)
Risk: L1 — changes agent composition and the durable session identity, but adds no game authority or network route.

## Outcome

Move each Player-authored companion identity onto DeepSeek Harness' native Agent Preset plane. The DSH host materializes one immutable persona preset per identity, mounts it before the decision and social lane plugins, and records its id in the DSH session header. The companion's stable Soul then belongs to the kernel composition rather than a Player2-only prompt section copied into every lane.

## Non-goals

- No DeepSeek Harness source change, subagent, Dream workflow, skill authoring, game capability, or permission expansion.
- No in-game Soul editor or DSH settings UI.
- Do not remove the Soul from the wire yet; it remains the Player-authored bootstrap and cross-version compatibility value.
- Do not mutate an existing persona preset in place. A changed identity gets a new content-addressed preset and session id.

## Acceptance checks

1. The host depends on and injects `@deepseek-ai/dsh-agent-presets`; every created/resumed lane mounts a content-addressed Player2 preset during `setup()` and stores the preset id in `meta.agentPreset`.
2. The materialized preset contains only `@deepseek-ai/dsh-persona`, using the validated Player-authored name, role, and Soul. Existing identical content is reused; conflicting content fails loudly.
3. The old `presetAutonomy` shadow slot is removed. Autonomy remains the separately configured Player2 policy and defaults to `consult`.
4. Focused host/plugin tests, workspace typecheck, and one dual-end reflect replay pass. Documentation records the new ownership boundary and UR-1 is closed.

## Allowed files and commands

Player2 package manifests/lockfile; `packages/dsh-host-plugin/`; `packages/dsh-companion-plugin/`; fixtures; README, CHANGELOG, and `docs/`. Run npm install, focused Vitest, typecheck/build, the dual-end reflect replay, and Git checks.

## Stop condition

Stop after the native preset is visible in the durable session header, both lanes compose through it, the focused checks pass, and the docs agree. Do not broaden this ticket into Dream mode or subagents.
