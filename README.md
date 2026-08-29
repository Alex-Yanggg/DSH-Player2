# DSH-Player2

DSH-Player2 is a public reference application for exploring a trustworthy AI companion inside a real game. Its job is to prove a small, player-controlled experience—not to build an unattended automation tool or a new agent framework.

## Relationship to DeepSeek Harness

This project consumes [DeepSeek Harness](https://github.com/dsh2026/test-Alex-Yanggg) as a plugin platform. All agent capabilities are implemented as plugins or through documented public contracts. DSH-Player2 does not modify, vendor, or import Harness internals.

## Status

The first runnable vertical slice is implemented for Stardew Valley through a small SMAPI adapter. It observes a bounded world snapshot, asks for permission using native game UI, leaves only a temporary visual receipt on agreement, and retains two player-owned state values for one next-day recall.

The cross-game product core is TypeScript. [`@dsh-player2/contracts`](packages/contracts/src/index.ts) defines the adapter contract and [`@dsh-player2/runtime`](packages/runtime/src/index.ts) enforces proposal and permission flow. The [architecture guide](docs/architecture.md) explains why Mod, real multiplayer, and visual control are separate adapter modes, not competing product cores.

The [SMAPI adapter](stardew-mod/README.md) remains deliberately narrow: it contains no LLM, DSH plugin, companion NPC, game automation, inventory mutation, or multiplayer feature. Its C# rules are a temporary P0 implementation required by the SMAPI host; the future bridge to the TypeScript runtime stays asynchronous and is not enabled until the P0 desktop validation passes.

The 0.0.2 runtime adds a text-only social turn that is unable to execute game actions: it receives a player message and current semantic observations, produces a grounded reply/question/disagreement/suggestion or explicit uncertainty, and may retain exactly one completed or failed receipt for the next game day. `@dsh-player2/dsh-companion-plugin` makes this a real Harness composition by contributing the NPC's procedural skill, stable social policy, and a monotonic tool guard to DSH. World grounding remains enforced by Player after the model returns.

Run `npm run accept:0.0.2` to type-check every package, run the DSH plugin composition tests and runtime tests, then replay the committed social fixture without an API key, game installation, or manual UI steps. The fixture is the acceptance baseline; a live DSH provider must be compared against it rather than replacing it.

The Stardew adapter exposes that text turn with **F2**. Its immediate deterministic fallback is intentionally equivalent in capability boundary to the TypeScript rule policy: chat cannot cause an action, and it may only recall the previous game day's one compatible outcome. This makes the text experience usable while the optional asynchronous DSH provider is unavailable.

`@dsh-player2/dsh-provider` supplies the live transport through DeepSeek Harness' public JSON-RPC SDK. It requires a dedicated DSH composition that mounts `@dsh-player2/dsh-companion-plugin`, the DSH skill registry, and the `skill` tool in native mode. The plugin's execution guard denies shell, filesystem, game execution, and every other model-facing tool even if such a tool is accidentally mounted. The provider uses a fresh DSH session for every social turn; the versioned Player envelope and trace, not retained chat history, remain the bounded context source.

The 0.0.3 decision lane makes DSH useful without giving it game authority. A Player-authored, immutable file envelope carries one monotonic sequence, semantic observations, and advertised capabilities. In `decision` mode the Companion plugin adds `game_observe`, `companion_propose`, and `game_request_action`; the last tool can only write an immutable `awaiting-player` request. It cannot grant consent or reach `GameAdapter.execute`. Run `npm run accept:0.0.3` for the full keyless social and decision regression, including an actual DSH tool-pipeline replay.

The 0.0.4 Stardew host closes that loop. When the optional bridge is configured, the Mod publishes one immutable day turn in the background, polls without blocking the game, shows a validated DSH proposal through native dialogue, and writes the player's grant plus terminal receipt. Only an unexpired affirmative answer can reach the existing temporary marker. A timeout, invalid request, unavailable DSH process, or invalid local path falls back once to the deterministic proposal; a persisted receipt or player-owned settled sequence prevents replay after restart. `npm run accept:0.0.4` runs both wire replays, every TypeScript test, and the pure C# host/rules suite.

The 0.0.5 dispatcher removes the last human-driven step. [`@dsh-player2/dsh-dispatcher`](packages/dsh-dispatcher/src/index.ts) watches the bridge inbox and wakes one dedicated DSH session per turn through DSH's public SDK, so the skill/tool pipeline writes the awaiting-player request without anyone typing a prompt. Completion is the persisted request file validated against the schema, never the model's final message; failed turns retry with bounded backoff, answered sequences survive restarts without a new model call, and the dispatcher has no write path to grant, receipt, or consent files. The dedicated session's durable event log becomes the relationship history; receipts remain the only fact source. Install the Mod, run `npm run companion:dispatch -- --bridge <dir>`, and player consent stays the only input. `npm run accept:0.0.5` adds a keyless dispatch replay — real plugin registries driven through the dispatcher plus a restart-idempotence check — to the full 0.0.4 regression.

The 0.0.6 recall lane gives that relationship a searchable past. In `decision` mode the Companion plugin adds `companion_recall`: a read-only projection of the newest Player-persisted receipts into a bounded, newest-first digest the model may consult before proposing. Recalled outcomes are history — they cannot be cited as observations, they expose no write path, and they never grant authority — while damaged receipt files inside the scanned window are skipped and counted rather than rewritten. This is receipt-backed memory inside DSH: the receipt stays the fact source, the digest is a replaceable index, and the Player-owned settled state remains authoritative.

The 0.0.7 presence capability gives the companion a body without giving it power. The Player capability surface became a small catalog: every turn advertises `visual-receipt` and `companion-presence`, each with its own validated scope. Granting a presence proposal draws Stardew Valley's own player character template — the vanilla farmer base spritesheet, no custom art — beside the agreed tile for the same bounded, temporary lifetime as the marker. Nothing is added to the world's state; the receipt records only that the presence was shown. `npm run accept:0.0.7` adds the presence golden replay and the unattended dual-end harness (`npm run replay:dual`): a headless C# host and a Node model process drive one real bridge directory through publish → request → scripted consent → receipt → recall with no game, no API key, and no human steps.

## Contributing

Read [AGENTS.md](AGENTS.md) for the project boundaries and [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Please do not open a pull request that changes DeepSeek Harness as a side effect of Player2 work.

The current [continuous-integration policy](docs/ci.md) separates TypeScript and pure C# checks from the local SMAPI build that requires a legally installed copy of Stardew Valley.

## License

A license has not yet been selected. Do not assume permission to reuse the repository contents until one is published.
