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

[`@dsh-player2/dsh-companion-plugin`](../packages/dsh-companion-plugin/src/index.ts) is the cognitive composition for this loop. It registers the `companion-grounded-deliberation` skill through DSH's public skill registry, contributes the stable companion policy through the system-prompt registry, and installs a monotonic tool guard that permits only the DSH `skill` loader. Persona and procedural technique therefore live in the Harness composition instead of inside the JSON-RPC adapter.

[`DshConversationPolicy`](../packages/runtime/src/dsh-conversation-policy.ts) now serializes only a bounded `PLAYER_SOCIAL_TURN` data envelope and validates the returned JSON. [`@dsh-player2/dsh-provider`](../packages/dsh-provider/src/index.ts) transports that envelope through the public JSON-RPC SDK and a fresh DSH session per social turn. The DSH session records the user envelope, skill catalog/load, and final assistant response; Player's versioned trace independently records the semantic observations, validated response, fallback, and retained result memory. Deployment must mount the Companion plugin with `dsh-skill` and `dsh-tool-skill` in a dedicated native-tool composition. It is not a fallback for the deterministic replay baseline. The first game-host bridge remains asynchronous: a SMAPI callback may present an already-available response, but must not wait for a model or Node process.

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

DeepSeek Harness publishes no daemon-side scheduler or file watcher, so the public way to drive a turn from an external event is to hold an SDK client and call it when the event fires. [`@dsh-player2/dsh-dispatcher`](../packages/dsh-dispatcher/src/index.ts) is exactly that: a resident waker that scans `inbox/turn-<sequence>.json`, calls `DeepSeekHarness.run` on one dedicated session, and requires `outbox/request-<sequence>.json` to exist and validate against the action request schema. The model's final message is never completion evidence.

```text
Mod publishes turn -> dispatcher wakes session -> skill/tool pipeline -> request file
                                                     ^ deduplicated by session id
grant/receipt/consent files: written only by the Player (SMAPI) host
```

The dedicated session id is stable per bridge, so Harness' durable session log accumulates the relationship history across days. That log is replayable audit context; the receipt-backed projection remains the only fact source, and no memory index may grant authority. Failed dispatches retry with bounded doubling backoff and then give the sequence up for the process lifetime — the Mod's existing timeout falls back deterministically. Restarts are idempotent because any persisted request marks the sequence answered, and the write-once bridge refuses conflicting rewrites. `scripts/dispatch-companion-turns.mjs` is the single resident command; `npm run replay:dispatch` exercises the dispatcher against the real plugin registries without a model or game.

## Receipt Memory (0.0.6)

Memory in this project is a projection of receipt-backed Player events, never retained model transcript. The 0.0.6 decision mode turns that projection into a model-facing tool: `companion_recall` reads the bridge's persisted `receipts/receipt-<sequence>.json` files and returns a bounded, newest-first digest of shared outcomes (completed, failed, declined, expired) with an honest `skipped` count for damaged files. The digest is read-only and replaceable — the receipt files stay the fact source, and a proposal still cites only current-turn observation ids, so recalled history cannot fabricate evidence or authorize action. The decision skill teaches the ordering `game_observe → companion_recall → companion_propose → game_request_action`.

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
