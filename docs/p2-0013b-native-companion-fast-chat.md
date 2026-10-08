# P2-0013B: Native companion and responsive chat

Outcome: replace the three-second presence drawing with a persistent game actor;
connect explicit come/follow/stay chat requests to native movement; make social
replies independent of slow decision turns and avoid a skill-loading model round trip.

Owner scope: requested in the current conversation. L2 for the bounded movement
contract. Game engine owns collision, pathfinding and farmer appearance. DSH owns
the validated reply; explicit player movement commands are the only movement grant.

Non-goals: farming, inventory changes, multiplayer support, Harness changes,
new providers, public release, CI or dependency lockfile edits.

Allowed files: stardew-mod, player2-core and tests, contracts, companion and host
plugins and tests, fixtures, documentation. Commands: local git, npm, dotnet,
read-only local game/API inspection and local deployment after verification.

Acceptance: actor remains after three seconds; no custom screen-overlay actor;
come reaches a nearby walkable tile, follow uses native paths, stay cancels;
blocked paths fail honestly; unrelated/negative chat cannot authorize movement;
chat proceeds while decisions wait; fast social requests disable reasoning and
do not load a skill through another model step; Chinese lines wrap without a
speaker-only line and refresh beyond 50 entries. Core tests, TS checks, mod build,
and documented in-game checks; report any manual check unavailable in this session.

Stop after this vertical slice and its evidence. No merge or public write.

Architecture context: [architecture](architecture.md),
[development-mode](development-mode.md). This task changes the former actionless
social boundary only for explicit bounded movement grants, never arbitrary work.

## Diagnosis and verification evidence

- Original actor was a fake event farmer drawn from `RenderedWorld`, expiring after
  three seconds. Original social composition advertised no action executor.
- The four reported native social turns took 15.007 / 7.475 / 15.539 / 5.537 seconds
  inside DSH. Request headers selected `deepseek-v4-flash`, `reasoningEffort: high`,
  and `maxTokens: 256000`. JSON repair reflections displaced the player's question
  as the latest user message. The final repair answer, not the initial answer,
  became the text displayed in the screenshot.
- The new real native DSH smoke produced three validated replies in 2334 / 1509 /
  1510 ms, including a come command and an honest uncertainty reply when no actual
  game arrival observation was available. This was an isolated temporary bridge,
  using the existing local provider and native preset/session APIs. These timings
  exclude DSH process boot and are measurements, not a latency SLA.
- TypeScript checks/build, all workspace suites (90 tests after focused reruns),
  C# core tests (88), presence replay, docs verification and diff checks pass.
- Mod Release build succeeds against the installed game. Existing CS9057 warning:
  the SMAPI analyzer targets a newer Roslyn version than the installed .NET 6 SDK.

## Manual game check (still required)

1. Restart SMAPI and check for the `P2-0013B` startup line. Choose/customize a
   companion if necessary. Accept the native presence proposal; confirm the actor
   remains after three seconds with correct native clothing, animation and depth.
2. On a previously settled save, send `立刻来我面前` (or `/come`) in F2. After the
   validated reply, close F2: single-player menus pause native movement. Confirm
   the actor walks to a nearby open tile and reports arrival only on reaching it.
3. Send `跟着我`, close F2, walk around obstacles, enter/leave the farmhouse. Within
   one location paths use the engine; cross-map follow/summon currently relocates
   the actor near the player, it does not simulate walking an entire inter-map route.
4. Send `停下`; confirm movement stops. Say `不要来我面前`, a quoted command, or a
   question about following; confirm no new movement is granted. Block all routes
   and confirm a failure rather than crop/object destruction or a false arrival.
5. Chat during movement or a slow decision. Confirm replies keep flowing and
   questions about presence use the new game-authored companion observations.
6. Fill/scroll 50+ transcript entries; test Chinese line wrapping and resizing.
   Sleep/save/reload and return to title; confirm no unknown-NPC serialization error
   or duplicate actor. Runtime actors are detached during vanilla save serialization.

No claim of in-game visual/pathfinding verification is made until these checks
are observed. No game save was modified by the diagnostic smoke.
