# Upstream DSH requirements

Concrete requirements against DeepSeek Harness (DSH) itself. They are recorded
here — with their own rationale and acceptance shape — because the contributor
rules forbid changing Harness as incidental support for this application. Each
requirement names the in-boundary workaround Player2 ships today, so the
workaround can be retired cleanly if the requirement lands upstream.

## UR-1 Agent preset composition (`agentPresets.mount()`)

**Status: resolved by P2-0013 (2026-09-05).** Player2 now depends on the
published `@deepseek-ai/dsh-agent-presets@0.1.1-rc.2` and
`@deepseek-ai/dsh-persona@0.1.1-rc.2`, mounts both decision and social agents
through `ctx.agentPresets`, and records the content-addressed preset id in
`CreateAgentOptions.meta.agentPreset` / `SessionHeader.agentPreset`. No Harness
source was changed.

**What Player2 needs:** the ability to compose an agent from a named preset
directory that durably carries the companion's identity — persona rows, voice,
and the autonomy tier the preset recommends — instead of receiving all of it
through per-turn turn envelopes or host config slots.

**Why:** the companion's soul layer is stable identity. Today Player2 binds the
persona constitution at composition time from the first turn's envelope and
derives the durable session id from that identity, which works but has three
consequences a preset service would remove:

1. The identity must arrive inside turn data before any agent exists, so the
   first turn carries a bootstrapping burden that is not really turn data.
2. `presetAutonomy` is a Player2-invented shadow slot: a preset-shaped input
   that Player2 resolves itself because no preset service exists to resolve it.
3. `SessionHeader.agentPreset` is never populated, so DSH-side tooling cannot
   see which persona a session was composed from.

**Resolved implementation:** Soul rows still travel on every bridge turn beside
`companion.name`/`companion.role` as the Player-owned bootstrap and compatibility
contract. The DSH host content-addresses that identity, materializes a
persona-only user preset through the official roster authoring seam, mounts it
before lane-local policy, and starts a fresh durable session when the identity
changes.

The Player2-only `presetAutonomy` shadow slot was removed. Autonomy remains a
separate host policy because identity answers who the companion is while
autonomy answers whose consent is required; it defaults to `consult`.

**Evidence:** focused host tests cover content addressing, persona-only
composition, idempotent reuse, and conflicting-content refusal. The host setup
calls `agentPresets.mount()` before lane plugins and writes `meta.agentPreset`;
the dual-end reflect replay remains green across receipt → reflection → growth.
