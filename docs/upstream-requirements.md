# Upstream DSH requirements

Concrete requirements against DeepSeek Harness (DSH) itself. They are recorded
here — with their own rationale and acceptance shape — because the contributor
rules forbid changing Harness as incidental support for this application. Each
requirement names the in-boundary workaround Player2 ships today, so the
workaround can be retired cleanly if the requirement lands upstream.

## UR-1 Agent preset composition (`agentPresets.mount()`)

**Status:** the service is not present in the Player2 dependency tree
(`@deepseek-ai/*` 0.1.1-rc.2 as installed). Re-verified on 2026-09-03: the
upstream package `@deepseek-ai/dsh-agent-presets@0.1.1-rc.2` **is published on
npm** on the same version line as the installed set (with the related
`@deepseek-ai/dsh-persona`), so the requirement is now known to be solvable
strictly in-boundary — one official dependency addition, no Harness change.
Adopting it still requires the owner to approve the `package.json` +
lockfile change, because contributor rules do not let an agent touch the
dependency lockfile. Grep across every shipped `.d.ts` in the current tree
finds no `agentPresets` service; `agentPreset` exists only as passive metadata
(`CreateAgentOptions.meta.agentPreset`, `SessionHeader.agentPreset`).

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

**In-boundary workaround shipped today:** soul rows travel on every bridge turn
beside `companion.name`/`companion.role` (`companionIdentitySchema`), the
companion plugin binds them as a `player2:companion-soul` system-prompt section
at mount, and lane session ids hash the identity so a persona change starts a
fresh durable session.

**Migration when delivered:** bind the persona constitution from the preset at
composition; resolve autonomy through the real agent → preset → global chain
and delete the `presetAutonomy` shadow slot; set `meta.agentPreset` when
creating lane sessions.

**Acceptance shape:** a DSH-side test that an agent composed via
`agentPresets.mount("<preset>")` (a) exposes the preset's persona rows to its
system-prompt assembly, (b) records the preset id on its session header, and
(c) fails the mount loudly when the preset does not exist — the same
fail-loud contract Player2's autonomy resolution already follows.
