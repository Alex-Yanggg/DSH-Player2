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
