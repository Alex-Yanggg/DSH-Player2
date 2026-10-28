# Upstream DSH requirements

Concrete requirements against DeepSeek Harness (DSH) itself. They are recorded
here — with their own rationale and acceptance shape — because the contributor
rules forbid changing Harness as incidental support for this application. Each
requirement names the in-boundary workaround Player2 ships today, so the
workaround can be retired cleanly if the requirement lands upstream.

Since the move to DSH's `acp` profile (2026-10-14) Player2 mounts one plugin
and uses no agent presets; UR-1 below is kept as history.

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

## UR-2 A wake service for a sleeping agent

**Status: open; recorded by P2-0019c.**

**What Player2 needs:** a session-scoped way to wake an idle agent with a few
queued facts — once, coalescing repeats — without inventing a prompt the
session would not otherwise have.

**Why:** the P2-0019c small brain sleeps the mind while the body works a plan.
The mind must wake exactly when the plan finishes, the stuck detector fires, a
reflex fires, or a world event or chat arrives. Player2 composes this today
from public DSH surface: `goals.disarm` sleeps the goal round driver,
`goals.resume` re-arms it (an active→active re-arm is legal), and
`agent.followup` opens a turn when no goal stands; wakes that land on a
running turn are retried when it ends. The choreography works, but the
pause/resume cycle and its retry belong in the runtime that owns the round
driver.

**In-boundary workaround shipped:** the plugin owns disarm on `plan_set`,
resume-or-follow-up on wake, and a one-shot retry on the next idle edge.

**Acceptance shape:** a wake service that queues facts for an idle agent,
opens exactly one turn carrying them, coalesces wakes that arrive while a turn
runs, and never fires while the agent is disposed. Player2's goal sleep/resume
cycle and its follow-up fallback retire when it lands.

## Game facts that cannot be exported

The body protocol exports what the game holds as data: map tiles, tile
properties, objects, warps, and (P2-0019c) every tile `Action`/`TouchAction`
string, plus mine-floor tiles as raw `sheet#index`. Two gates in the P2-0019c
mine scenario are code, not data, and stay outside any honest raw export.

### GF-1 The mine's opening gate is an event, not map data

The Mountain → Mine walk warp at (54,4) is exported. Until spring day 5 the
game blocks it with a landslide implemented as code (a `DaysPlayed` gate and
the spring-5 removal event), never as a tile property, object, or warp flag.
The exported state shows the warp and the tiles, but nothing says the way is
shut or when it opens. No vanilla data source carries the pairing, so no
export can be honest about it; the companion has to learn it the way a player
does (try, ask, search) and write a lesson.

### GF-2 What a tile action does is code, not a property

The mine floors answer by tilesheet index in `MineShaft.checkAction`
(112 elevator, 115 exit ladder, 173 ladder down, 174 shaft), and the dynamic
ladder is written into the map layer at runtime. The exporter ships those
tiles raw (`mine#173`); what using one does lives in game code. A
meaning-annotated export would be a game fact in this repository's code,
which its rules forbid — the raw identifier plus the companion's own
experiment, lessons and web search is the honest ceiling.
