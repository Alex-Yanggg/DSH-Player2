# DSH-Player2

DSH-Player2 is a public reference application for exploring a trustworthy AI companion inside a real game. Its job is to prove a small, player-controlled experience—not to build an unattended automation tool or a new agent framework.

## Relationship to DeepSeek Harness

This project consumes [DeepSeek Harness](https://github.com/dsh2026/test-Alex-Yanggg) as a plugin platform. All agent capabilities are implemented as plugins or through documented public contracts. DSH-Player2 does not modify, vendor, or import Harness internals.

## Status

The project is being prepared for its first runnable vertical slice. The initial scope, supported game, installation instructions, and verification command will be added with that slice.

The first technical gate is now [a minimal SMAPI mod](stardew-mod/README.md) that observes the start of a game day. It intentionally proves game access before introducing a model or companion behavior.

## Contributing

Read [AGENTS.md](AGENTS.md) for the project boundaries and [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Please do not open a pull request that changes DeepSeek Harness as a side effect of Player2 work.

The current [continuous-integration policy](docs/ci.md) separates public checks from the local SMAPI build that requires a legally installed copy of Stardew Valley.

## License

A license has not yet been selected. Do not assume permission to reuse the repository contents until one is published.
