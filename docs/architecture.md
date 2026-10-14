# Architecture

Player2 is a DeepSeek Harness plugin plus a game adapter. DSH already is the agent runtime: it runs the model, the tools, goals, prompt queueing, cancellation, sessions and their logs, and it speaks ACP on stdio in its `acp` profile. Player2 adds only what DSH lacks: a persona, a game body, and a memory ledger. Nothing here re-implements a DSH capability (owner ruling, 2026-10-14: no second harness, strict code budget).

```text
Stardew Valley + SMAPI                         dsh --profile acp (child process, one session per save)
----------------------                         --------------------------------------------------------
ModEntry: day start/end, chat, pause  -- ACP -->  session/prompt "[day-start day=N]" | "[chat day=N] …" |
DshCompanion + AcpClient (stdio)                  "[day-end day=N]" | "[resume]";  session/cancel on pause
  shows agent messages as speech     <-- ACP --  agent_message_chunk, stopReason
GameMcpServer (localhost, token)     <-- HTTP --  Player2 plugin body tools (world_*, body_*, reflex_melee)
  BodyChannel + BodyTaskRunner                    DSH goals (create_goal / update_goal / get_goal)
  BodyAdapter, BodyStateExporter                  Player2 plugin: persona prompt, remember, dream_commit
```

## The mod

- [`DshCompanion`](../stardew-mod/src/DshCompanion.cs) writes `<bridge>/player2.patch.yml` (an overlay on DSH's acp profile: mount the Player2 plugin with the chosen persona and the game endpoint, set the persona prefix, disable coding tools such as shell, file system and subagents) and starts `dsh --profile acp --patch <file>`. The persona is bound per process, so a different companion restarts DSH. The session directory is `<bridge>/projects/<person>/sessions/<saveId>/`; the session id is kept there and resumed with `session/resume`.
- [`AcpClient`](../player2-core/AcpClient.cs) is a minimal ACP client: initialize, new/load session, prompt, cancel; agent message chunks are joined into one spoken line per message; a permission request is answered "allow once" (the player's request is the authorization).
- [`ModEntry`](../stardew-mod/src/ModEntry.cs) sends the prompts, shows what the companion says (above its head, else HUD, always in the chat history), and turns a failed turn or a DSH exit into an in-game error. A frozen world for about three seconds sends `session/cancel`: DSH pauses the active goal instead of failing it, and `[resume]` re-arms it when the world runs again.
- The mod keeps no logs of its own; DSH's session logs are the record.

## The plugin

[`dsh-companion-plugin`](../packages/dsh-companion-plugin/src/index.ts) is one Cordis plugin in DSH's acp profile:

- **Persona.** System-prompt sections: the soul as a constitution, the companion policy (speak plainly, never internal terms or tile coordinates, act on a request at once by creating a goal), the five knobs as tendencies, the response language.
- **Turn markers.** `agent/pre-step` reads the marker of the incoming prompt: chat and day-start get the memory note; day-end becomes the dream (ledger digest plus `dream_commit` instructions); `[resume]` resumes the paused DSH goal through the host goal service and makes no model request; goal rounds (no marker) get this turn's knob dice nudges.
- **Hands.** With a game endpoint configured, the body tools call the mod's MCP endpoint ([`port.ts`](../packages/dsh-companion-plugin/src/body/port.ts)): read state and the location graph, walk with A* over the exported grid ([`navigation.ts`](../packages/dsh-companion-plugin/src/body/navigation.ts), [`walk.ts`](../packages/dsh-companion-plugin/src/body/walk.ts)), press raw buttons, and a closed-loop melee reflex ([`reflex.ts`](../packages/dsh-companion-plugin/src/body/reflex.ts)). Body protocol and goals: [p2-0021-b-line-goal-driven-companion.md](p2-0021-b-line-goal-driven-companion.md).
- **Memory.** The Persona Ledger below; `remember` lets the companion keep one episode, `dream_commit` closes the day's dream.

## Persona Ledger (P2-0016)

The [Mind Core](../packages/dsh-companion-plugin/src/mind/core.ts) keeps one ledger per companion person. It is memory, never a current observation, a capability, or the soul.

```text
<bridge>/projects/<person>/ledger/
  person.json                 traits (cross-save, ≤24 active)
  remember.md                 player-readable export, rewritten after every dream
  saves/<save>/episodes.jsonl append-only experience, ≤2,000 per save, importance-based forgetting
  saves/<save>/mood.json      four decaying scalars: valence, arousal, energy, closeness
  saves/<save>/story.json     "our story so far", ≤600 characters, rewritten by the dream
  saves/<save>/why.jsonl      the episodes each recent reply was given
```

- **Episodes** come only from what the companion chooses to remember (`remember`: utterance, correction, milestone, or shared-event). Ids are content-addressed, so a retried turn never writes twice.
- **Flavor cues, not search.** Heavy recall is DSH's job; Player2 keeps a thin selector: a few recent, salient episodes, nudged by plain word overlap with the turn.
- **MindContext** is one bounded note (≤1,400 characters): mood, the picked episodes, our story, and the top active traits.
- **Mood** moves by fixed rules and decays toward rest; it colours tone only.
- **Dream.** At day end the companion sees the day's episodes, traits and story and may rewrite the story, add or adjust traits with episode evidence, and forget episodes. A new trait is active only with two independent episodes or one player correction.
- **Why did you say that.** A chat line asking why carries the previous reply and the episodes it was given.
- `node scripts/ledger-export.mjs <bridge> [person] [--stdout]` refreshes the export on demand; deleting `ledger/` forgets everything.

## Development Boundary

- Use DSH public contracts only (plugin hooks, tool runtime, system-prompt sections, the goal service, ACP). Requests for DSH changes go to [upstream-requirements.md](upstream-requirements.md).
- Give the companion thinking guidance and light constraints, not behavior trees ([operating model](operating-model.md#design-principle-intelligent-software)).
- The mod stays a pure adapter: raw state out, raw input in, no task semantics.
