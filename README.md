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

## Contributing

Read [AGENTS.md](AGENTS.md) for the project boundaries and [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Please do not open a pull request that changes DeepSeek Harness as a side effect of Player2 work.

The current [continuous-integration policy](docs/ci.md) separates TypeScript and pure C# checks from the local SMAPI build that requires a legally installed copy of Stardew Valley.

## License

A license has not yet been selected. Do not assume permission to reuse the repository contents until one is published.
