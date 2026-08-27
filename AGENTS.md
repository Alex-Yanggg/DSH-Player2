# DSH-Player2 contributor instructions

DSH-Player2 is a public reference application for a trustworthy, game-native AI companion. It consumes DeepSeek Harness; it does not fork, patch, vendor, or reach into Harness internals.

## Boundaries

- Build every agent capability as a DSH plugin or against a documented public DSH plugin contract.
- Treat `@deepseek-ai/dsh-*` package interfaces and the configuration contract as the integration boundary. Do not import source files from a local Harness checkout.
- Keep game-specific state, permissions, presentation, and adapters in this repository. A reusable capability belongs in a separate plugin package only after two consumers need the same contract.
- Do not introduce a change to DeepSeek Harness as incidental support for this application. Record a concrete upstream requirement separately, with its own rationale and tests.

## Product rules

- The companion may advance a delegated plan autonomously only through explicit, inspectable game permissions. It must not become a cheating, account-automation, or unbounded unattended-farming tool.
- Prefer a small observable companion behavior over a broad simulated platform. Every user-visible capability needs a clear permission boundary, failure behavior, and way to verify it.
- Keep player data and credentials local by default. Document every network request, retained datum, and external service before adding it.

## Engineering rules

- Keep the application runnable from a clean checkout and document the supported game, platform, prerequisites, and verification command in `README.md`.
- Add focused automated coverage for behavior changes. User-visible changes also require a reproducible manual verification path.
- Use conventional, reviewable commits and keep generated files out of changes unless the repository declares them authoritative.
- Add a nested `AGENTS.md` only when a subtree has genuinely different rules; link to the parent instead of restating it.
