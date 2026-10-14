# Architecture

DSH-Player2 separates a game-independent safety runtime from a DeepSeek Harness companion composition. Harness owns model-session orchestration, procedural skills, prompt policy, and model-facing tool enforcement; Player owns world semantics, grounding validation, permissions, receipts, and game presentation. Game adapters do not depend on a model process.

## TypeScript Core

The cross-game core is TypeScript and is split into two packages:

- `@dsh-player2/contracts` defines versioned observations, capabilities, proposals, permission grants, receipts, and the `GameAdapter` interface.
- `@dsh-player2/runtime` coordinates a turn. A decision policy can create a proposal, but only a matching unexpired player grant can reach an adapter's `execute` method.

The core receives semantic facts and capability descriptors. It never receives game objects, filesystem paths, unrestricted commands, or raw input-device ownership.

```text
decision provider (optional DSH plugin, local model, rules)
                         |
                    Proposal only
                         v
TypeScript runtime -- PermissionGrant --> GameAdapter.execute()
       |                                      |
       +-- observations, capabilities <-- receipt and presentation
```

## Text Social Turn (0.0.2)

The text loop is a separate, deliberately actionless path. A `ConversationPolicy` receives a player message, current semantic observations, at most one immediately prior shared outcome, and an optional latest receipt. It can return a reply, question, disagreement, suggestion, or explicit uncertainty. It does not receive `GameAdapter.execute`, a permission grant, input primitives, or a filesystem handle.

```text
player text + semantic observations + yesterday's receipt memory
                           |
                    ConversationPolicy
                           |
                     SocialResponse only
                           |
                 game-host presentation + trace
```

`SocialTurnCoordinator` validates every cited observation and memory id. A model/provider error, invented fact reference, stale memory reference, or attempt to retain a non-result receipt produces an explicit uncertainty response. Only a completed or failed receipt may be reduced to the one memory record visible on the next game day. The committed [`rainy-suggestion` fixture](../fixtures/social-turn/rainy-suggestion.json) exercises this loop through `npm run replay`, without a game install or model credential.

[`@dsh-player2/dsh-companion-plugin`](../packages/dsh-companion-plugin/src/index.ts) is the cognitive composition for this loop. It registers the `companion-grounded-deliberation` skill through DSH's public skill registry, contributes the stable companion policy through the system-prompt registry, and installs a monotonic tool guard that permits only the DSH `skill` loader. Persona and procedural technique therefore live in the Harness composition instead of inside a game-side adapter.

[`DshConversationPolicy`](../packages/runtime/src/dsh-conversation-policy.ts) now serializes only a bounded `PLAYER_SOCIAL_TURN` data envelope and validates the returned JSON. In production the envelope never leaves DSH through an external client: [`@dsh-player2/dsh-host-plugin`](../packages/dsh-host-plugin/src/index.ts) runs inside the user's DSH profile, drains `social-inbox/`, and answers on a durable social lane session. The DSH session records the user envelope, skill catalog/load, and final assistant response; Player's versioned trace independently records the semantic observations, validated response, fallback, and retained result memory. Deployment must mount the Companion plugin with `dsh-skill` and `dsh-tool-skill` in a dedicated native-tool composition. It is not a fallback for the deterministic replay baseline. The first game-host bridge remains asynchronous: a SMAPI callback may present an already-available response, but must not wait for a model or Node process.

The distinction between Harness concepts is deliberate: persona is stable identity, a skill is loadable procedural knowledge, memory is a projection of receipt-backed Player events, and a power that changes the world must become a typed capability plus enforceable permission and execution policy. Putting all four into skill text would make authority and facts unauditable.

## Permission-Seeking Decision Lane (0.0.3)

The decision lane uses DSH tools as a typed cognitive workflow, not as a game executor. Player writes `inbox/turn-<sequence>.json`; the Companion plugin reads that fixed path, validates cited observations and advertised capabilities, writes a deterministic proposal once, then writes `outbox/request-<sequence>.json` with status `awaiting-player`. Existing files are returned only when byte-equivalent after parsing; conflicting retries fail instead of overwriting history.

```text
Player immutable turn envelope
       |
       v
game_observe -> companion_propose -> game_request_action
                                      |
                                      v
                         immutable awaiting-player request
                                      |
                            future Player bridge
                                      v
                  PermissionGrant -> TurnCoordinator -> adapter
```

`social` mode permits only `skill`. `decision` mode permits `skill` plus the three decision tools. Both modes install a monotonic tool guard, so mounting a shell or general filesystem tool elsewhere in the composition does not increase Player authority. Tool schemas, calls, and results are retained by the DSH session log; cross-day relationship memory remains the Player-owned projection of a completed or failed receipt, never the DSH transcript.

The committed [`rainy-marker` fixture](../fixtures/decision-turn/rainy-marker.json) and `npm run replay:decision` assemble the real DSH skill/system-prompt/tool registries, execute all three tools without a model or game, and compare the immutable request with the golden output. The next implementation boundary is an asynchronous Player host that consumes the request and asks for consent; until then, no request is executable.

## Stardew Consent Host (0.0.4)

The optional SMAPI bridge now implements that boundary. `DecisionBridgeHost` is pure C# orchestration over fixed-path bounded storage: it recovers a prior receipt, publishes one turn, polls at a bounded cadence, times out to a local fallback, and persists grant before receipt. It owns Tasks and cancellation but no game objects. `ModEntry` captures immutable DTOs and consumes completed updates on SMAPI's main thread; only that thread opens dialogue, touches `Farmer.modData`, or adds a temporary sprite.

Targets are location-qualified (`stardew-location:<NameOrUniqueName>:tile:<x>,<y>`). The host accepts only the exact target advertised by the current world observation, and `TryShowWorldReceipt` rechecks that the player is still in that location. Moving while DSH deliberates therefore produces a `failed` receipt instead of drawing the marker in the wrong map. The next day's DSH turn may include one `action-result` observation derived from the immediately prior `SharedOutcome`; this is receipt-backed relationship memory, not retained model transcript.

The same [`stardew-visual-receipt` golden fixture](../fixtures/decision-turn/stardew-visual-receipt.json) is executed by the DSH tool replay and deserialized by .NET tests. This detects field, target, enum, and permission drift across the process/language boundary. The Mod remains disabled-by-default: an empty bridge directory preserves the deterministic local behavior.

## Auto-Dispatch Loop (0.0.5)

Player2 is a DSH plugin, not a DSH client: it never spawns or bundles a Harness runtime. The 0.0.5 SDK sidecar (a resident process driving `DeepSeekHarness.run`) was removed when the project moved to DSH 0.2, because the 0.2 SDK client carries the whole `dsh` CLI as a dependency. Dispatch now happens in-process: [`@dsh-player2/dsh-host-plugin`](../packages/dsh-host-plugin/src/index.ts) scans `inbox/turn-<sequence>.json`, wakes one durable decision lane agent, and requires `outbox/request-<sequence>.json` to exist and validate against the action request schema. The model's final message is never completion evidence. Every `@deepseek-ai/*` package is a peer dependency supplied by the host DSH profile.

The keyless dual-end replays play the DSH role directly in `scripts/dual-end-model.mjs`; the old standalone dispatcher package was removed because production never used it.

```text
Mod publishes turn -> host plugin wakes lane agent -> skill/tool pipeline -> request file
                                                       ^ deduplicated by session id
grant/receipt/consent files: written only by the Player (SMAPI) host
```

The dedicated session id is stable per bridge, so Harness' durable session log accumulates the relationship history across days. That log is replayable audit context; the receipt-backed projection remains the only fact source, and no memory index may grant authority. A failed turn gets one `outbox/error-<sequence>.json` and is not retried; the Mod's existing timeout falls back deterministically. Restarts are idempotent because any persisted request marks the sequence answered, and the write-once bridge refuses conflicting rewrites.

## Receipt Memory (0.0.6)

Memory in this project is a projection of receipt-backed Player events, never retained model transcript. The 0.0.6 decision mode turns that projection into a model-facing tool: `companion_recall` reads the bridge's persisted `receipts/receipt-<sequence>.json` files and returns a bounded, newest-first digest of shared outcomes (completed, failed, declined, expired) with an honest `skipped` count for damaged files. The digest is read-only and replaceable — the receipt files stay the fact source, and a proposal still cites only current-turn observation ids, so recalled history cannot fabricate evidence or authorize action. The digest reports `skipped` only for unreadable files inside its scanned window (newest first, eight valid entries maximum). The decision skill teaches the ordering `game_observe → companion_recall → companion_propose → game_request_action`.

## Adapter Modes

Every adapter declares one access mode instead of pretending that all game integrations have equal guarantees.

| Mode | Typical integration | What it can claim |
| --- | --- | --- |
| `semantic` | Mod or official game API | Facts and actions have game-defined identifiers and results. |
| `network` | Supported multiplayer client or server plugin | A real network player/session carries the action. |
| `vision` | Screenshots plus keyboard/mouse | The runtime sees pixels and requests input primitives; it cannot claim semantic certainty. |

The current Stardew SMAPI implementation remains a C# adapter because SMAPI is a .NET host. It is intentionally thin and does not make C# the platform core. After the P0 desktop validation passes, it can exchange versioned JSON with the TypeScript runtime asynchronously; the game thread must never wait for a model or Node process.

## Development Boundary

The TypeScript packages are testable in public CI. The SMAPI adapter is built locally against a legally installed copy of Stardew Valley. A second adapter must demonstrate the same contract need before a capability is treated as stable public API.

Run the TypeScript checks with:

```powershell
npm install
npm run typecheck
npm run build
npm test
```

## Project/Session Layout (0.1.1)

Every turn, grant, receipt, and social file lives under `<bridge>/projects/<person>/sessions/<saveId>/` — one project directory is one companion person, and each save is one session inside it. This is the engineering file system that keeps conversations and receipt-backed memories from leaking across saves, keys each durable DSH lane session to one person on one save, and leaves a future real-time social transport free to replace the file read/write ends without moving anything. Only `development-logs/` and the `runtime/` readiness heartbeat live at the bridge root. A pre-layout flat bridge migrates once into `projects/legacy/sessions/legacy` at SMAPI startup, before DSH starts; the host scans sessions and never flat lanes.

The social lane hardening accompanies it: bounded 64 KiB reads, full result validation (version, status, response shape, kinds, citation grounding, memory consistency), typed world/self facts at the C# writer, consumed-file cleanup, a seven-day stale sweep, and a single converged policy implementation in `@dsh-player2/runtime` with two thin transports — the host-plugin drain (production) and the SDK file bridge (keyless replay and smoke only). Timelines are wall-clock: every host timeout is a real-time deadline, so game pauses never stretch the wait.

## Companion Personality (0.1.1)

The five-layer personality now covers all five layers. Body: the presence capability (vanilla farmer template, no custom art). Experience: the receipt-backed memory projection. Soul: bounded persona rows — values, bonds, voice, hard boundaries — authored per roster entry and carried beside the companion identity on every bridge turn as the Player-owned bootstrap. P2-0013 materializes that exact identity as a content-addressed DSH Agent Preset whose sole row is the official persona plugin; both lanes mount it before their local policy. Temperament: the checkpoint module — pre-step attention (the receipt digest weighted against the current turn's targets, injected before the first step of every decision turn; the production social lane runs the fast composition, which skips this pre-step and carries a bounded memory note instead, see [W0 baseline](#w0-baseline-p2-0015)), a pre-execute reflection guard (observe before propose, propose before ordering), and turn-stopping closure (a turn ending without its completion evidence is steered to continue, at most twice). Memory closure: recall now participates in turn attention instead of being passively queryable. A changed identity creates a fresh preset and durable lane, while receipt-backed experience remains continuous.

## Self-Evolution Lane (0.1.2, P2-0012)

The companion's growth is the first capability built on kernel seams the bridge had never touched, and it deliberately crosses all three deposit layers without giving the model a single new authority.

```text
DSH lane (kernel seams)                    Player host (authority)
companion_recall ─┐
                  ├─ companion_reflect ──▶ outbox/growth-<sequence>.json (write-once)
envelope.growth ──┘                            │ validated + applied
                                               ▼
                                     growth/growth.json (L2 asset:
                                     revision = last applied sequence,
                                     ≤12 FIFO insights, focus; no soul
                                     field — the soul stays read-only)
                                               │ next turn envelope
                                               ▼
                                     observe render shows the growth;
                                     prompt sections never change
```

- **`companion_reflect`** (decision mode, both autonomy tiers) accepts one to three insights; every insight must cite receipt sequences `companion_recall` actually returned this turn, so growth is grounded in shared history, not invention. The tool writes a write-once proposal with the same byte-equivalence and conflict rules as action requests. Growth is self-knowledge: it is never citable as an observation and never authorizes an action.
- **`CompanionGrowthStore`** (player2-core, game-free and tested) validates each proposal against the Player contract, rejects stale sequences, trims insights oldest-first at twelve, and writes the versioned asset atomically. A damaged asset is a traceable error, never a silent reset. The envelope carries the applied asset as an optional field, so a mod built before the lane simply never sends it and both ends drift together.
- **Autonomy-tier approval answerer**: the plugin answers DSH's native `approval/request` waterfall for companion-owned tools only — `consult` rejects in-session asks (the game consent bridge is the only voice of the player), `full` grants from the player's standing authorization, and any other plugin's tool falls through to later answerers. Every ask/outcome pair is audited by DSH into the session log.
- **Package-owned invariants**: when the deployment composes DSH's invariant registry, the plugin registers stream checks that re-validate the reflect and action-order call contracts on `session/event`; without a registry the companion mounts unchanged (graceful degradation).

The lane consumes only installed kernel surfaces (`ctx.tools`, `ctx.approval`, `ctx.invariants`, the skill registry). P2-0013 adds `ctx.agentPresets`: the stable Soul now lives on DSH's native composition plane while changing growth continues through per-turn data so prompt-prefix caching remains valid.

## Native Persona Runtime (0.1.3, P2-0013)

`@deepseek-ai/dsh-agent-presets` is now a real runtime dependency rather than a researched possibility. The host derives `player2-<name>-<identity-hash>` from the complete validated identity, creates it through the roster's copy authoring seam, and specializes the composition to one `@deepseek-ai/dsh-persona` row before any agent can mount it. Reuse requires byte-identical content; a collision fails loudly. The decision/social setup order is preset first, then the lane-local skill/tool/policy plugin, yielding DSH's intended `agent → preset → global` lookup chain. `meta.agentPreset` makes the identity reconstructable from the durable session header.

The migration deliberately changes the session-id salt. A pre-0.1.3 session cannot be resumed under an identity composition it never recorded; the new lane starts clean while Player-owned receipts and growth assets carry the relationship across. Soul remains on the wire for bootstrap and older hosts, but the model-facing stable identity is no longer assembled by a Player2-specific Soul prompt section.

## W0 Baseline (P2-0015)

W0 stabilizes the loop the player actually feels before any new capability lands. It changes no authority boundary.

- **Movement commands are game-local.** An explicit "come / follow / stay" typed in chat starts moving on the same tick it is submitted; the Player validates the command with the same parser as before (`CompanionMovement.ParseCommand`), so a negative phrase still moves nothing. The DSH reply to that message still happens, but movement no longer waits for it, and a blocked path is reported as `COMPANION_MOVEMENT_FAILED` instead of silently doing nothing. The fast social policy is told that the game already started the movement.
- **Social turns carry history.** Every chat envelope now carries `priorMemory` (yesterday's receipt-backed shared outcome, the only citable memory id), `latestReceipt` (the newest readable receipt) and `growth` (the applied growth asset). [`SocialMemory`](../player2-core/SocialMemory.cs) projects them from `receipts/`; a damaged receipt is skipped and counted, never blocking the turn. Both result validators (C# `SocialBridgeHost`, TS `validateSocialResponse`) reject a memory id the turn never carried. The fast social composition still has no tools and no temperament pre-step; [`socialMemoryNote`](../packages/dsh-companion-plugin/src/social-memory.ts) renders the same envelope fields as a note of at most 600 characters ahead of the envelope. The [golden envelope](../fixtures/social-turn/stardew-social-memory.json) is pinned by both the C# writer test and the TS contract test.
- **Growth is applied where it is produced.** [`CompanionGrowthIntake`](../player2-core/CompanionGrowthIntake.cs) applies pending `growth-<n>.json` and `dream-growth-<n>.json` proposals in sequence order on day start, so decision and social turns read the same asset.
- **The day's first line is one tool-free step.** On day start the Mod publishes a social turn with `occasion: "day-start"` and the fixed `[day-start]` marker as soon as the DSH bundle is alive, in parallel with the consent proposal. A DSH failure is a traced `DSH_SOCIAL_TURN_FAILED`; there is no local template line. In the decision skill, `companion_recall` and `companion_reflect` are off the critical path (reflection belongs to the day-end dream).
- **Graded readiness.** The heartbeat stays the only gate. On save load the Mod also writes `<session>/warmup/mouth.json`; the host composes or resumes that session's social lane without a model turn and answers with `<session>/readiness/mouth.json` (`mode` reused / resumed / created, `composeMs`).
- **Same-clock latency trace.** The Mod appends to `development-logs/latency-mod.jsonl`, the host to `development-logs/latency-host.jsonl`; each line is `{at, source, lane, key, stage, detail}` with a UTC millisecond timestamp. `node scripts/latency-report.mjs <bridge-dir> [--since <ISO>]` joins them on lane and key and prints n / P50 / P95 per segment, failures, and turns that never finished. Lanes: `command` (key-enter → motion-started), `social` and `day-start` (published → host-picked → agent-ready → first-token → model-done → written → mod-picked → rendered), `decision`, `readiness`, `dream`.
- **Fenced model JSON.** The 0.2 runtime sometimes wraps the final JSON in one Markdown fence; the host strips exactly one outer fence before the unchanged schema and grounding checks.

## W1 One Mind (P2-0016)

Every lane now speaks from the same mind. The **Mind Core** ([`mind/`](../packages/dsh-companion-plugin/src/mind/core.ts)) runs inside the DSH host around each lane turn and keeps one **Persona Ledger** per companion person, beside that person's bridge project. It changes no authority boundary: the ledger is memory, never a current observation, never a capability, and never the soul.

```text
<bridge>/projects/<person>/ledger/
  person.json                 traits (cross-save, ≤24 active) + growth-migration bookkeeping
  remember.md                 player-readable export, rewritten after every dream
  saves/<save>/episodes.jsonl append-only experience, ≤2,000 per save, importance-based forgetting
  saves/<save>/state.json     receipt watermark already ingested
  saves/<save>/mood.json      four decaying scalars: valence, arousal, energy, closeness
  saves/<save>/story.json     "our story so far", ≤600 characters, rewritten by the dream
  saves/<save>/why.jsonl      the episodes each recent reply was given
```

- **Episodes** come from three sources: every Player-persisted receipt above the watermark (automatic, idempotent, damaged receipts skipped and counted); at most one nomination per chat turn (`remember`: utterance, correction, milestone, or shared-event); and nothing else. Ids are content-addressed, so a retried turn never writes twice.
- **Flavor cues, not search.** Memory search is DSH's job; Player2 keeps only a thin, replaceable `EpisodeSelector`: a few recent, salient episodes of the current game, nudged by plain word overlap with the turn (Latin words, CJK unigrams and bigrams). No index, no vector store, no new dependency; a DSH-side recall can replace the selector without touching the ledger or the lanes.
- **MindContext** is one bounded note (≤1,400 characters): mood, the picked episodes (≤3 for chat, ≤2 for decisions), our story, and the top in-scope active traits. The social and day-start lanes put it after the W0 `SOCIAL_MEMORY` note; the decision lane puts it ahead of the turn marker; the dream lane gets the ledger digest instead. A reply may cite episodes in an optional `episodeIds` field; citing one the turn was not given fails the turn, exactly like an unknown observation id. Both extras are stripped by the result schema, so the Player result file is unchanged.
- **Mood** moves by fixed rules (receipt outcomes, chat, nominated episodes, a night's sleep) and decays toward rest by wall-clock half-lives. It colours tone only.
- **Dream upgrade.** The day-end dream also sees the day's episodes (≤40), the traits, and the story, and may add an optional `ledger` field: a story rewrite, trait add / strengthen / weaken / retire with episode evidence, and episodes to forget. A new trait is active only with two independent episodes (no shared provenance) or one player correction; otherwise it stays a candidate until evidence accumulates. Receipts are never forgotten, nor is evidence a live trait still cites. "No change" stays normal.
- **Why did you say that.** A chat line that asks why ("你为什么这么说") carries the previous reply and the episodes it was given, so the companion explains from its real inputs.
- **Growth migration.** The applied growth asset's insights become traits once per revision, citing the receipt episodes they were grounded in; a single-receipt insight starts as a candidate.
- **Failure posture.** A ledger failure before a turn is traced (`DSH_MIND_PREPARE_FAILED`) and the turn runs without MindContext; bookkeeping after a written turn never fails it. A damaged person file is a loud error, never a silent reset.
- `node scripts/ledger-export.mjs <bridge> [person] [--stdout]` refreshes the export on demand; deleting `ledger/` forgets everything and the next turn rebuilds episodes from receipts.

The Mod side adds one interaction change: chat lines sent while a reply is pending queue in order ([`ChatInputQueue`](../player2-core/ChatInputQueue.cs), at most three) instead of being refused, and are published one at a time, so the DSH social lane still sees one turn in flight.

## B Line Goal-Driven Companion (P2-0021)

The companion gains a body it plays with. The player's request is the authorization: the fast social lane may hand a goal to a per-save **goal lane** in the DSH host, which runs one DSH agent per goal until it finishes, fails honestly, is stopped by the player, or spends its anti-runaway budget. Design, protocol, spike results and gaps: [p2-0021-b-line-goal-driven-companion.md](p2-0021-b-line-goal-driven-companion.md).

- **Mod = pure adapter.** [`BodyAdapter`](../stardew-mod/src/BodyAdapter.cs) exports raw state ([`BodyStateExporter`](../stardew-mod/src/BodyStateExporter.cs)) and plays raw button sequences on the companion body; it has no "go to" or task semantics. The protocol is a file lane under `<session>/body/` ([`body.ts`](../packages/contracts/src/body.ts), [`BodyBridgeFiles`](../player2-core/BodyBridgeFiles.cs), [`BodyTaskRunner`](../player2-core/BodyTaskRunner.cs)).
- **Plugin = hands and helpers.** Goal mode of the companion plugin registers world/body/reflex tools ([`goal-tools.ts`](../packages/dsh-companion-plugin/src/body/goal-tools.ts)); navigation, walking and the melee reflex run on the plugin side.
- **Authority.** Autonomy defaults to `full`; `consult` stays as an explicit option. Cheat inputs need the settings switch or a spoken, per-save grant (`goal/cheat.json`, traced with the player's words). The only hard limit on the goal loop is the engineering budget (turns, tool calls, game days); on exhaustion the companion itself reports where it got to.
- **Persona knobs.** Five 0–1 knobs per persona travel with every social turn; seeded, logged dice decide only whether a turn considers speaking up, asking for help, taking the bolder option, or following the wording to the letter.
- **Next direction (owner, 2026-10-14).** The NPC-with-stand-in-farmer body is a fallback with a recurring cost: game code assumes the local player, so each interaction needs hand wiring. The target is the companion as an independent co-op player in its own game instance with virtual controller input, where the game's own paths apply and window focus does not freeze it; a spike decides feasibility. A paused game holds a goal instead of ending it. See [operating model, design principle](operating-model.md#design-principle-intelligent-software).
