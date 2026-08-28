# Continuous integration and delivery

The repository runs [CI](../.github/workflows/ci.yml) for every pull request, push to `main`, and manual workflow dispatch.

## What CI checks today

The workflow rejects whitespace errors, runs [`scripts/verify-docs.mjs`](../scripts/verify-docs.mjs), executes the pure rules tests in [`player2-core.tests`](../player2-core.tests/DSHPlayer2.Core.Tests.csproj), and type-checks, builds, and tests the TypeScript cross-game core. The documentation verifier requires one H1 per Markdown document and validates repository-relative Markdown links.

GitHub-hosted CI cannot compile the SMAPI adapter honestly: compilation requires the proprietary Stardew Valley assemblies from a locally installed game, which this public repository must not redistribute. The adapter is therefore built and smoke-tested locally as documented in [`stardew-mod/README.md`](../stardew-mod/README.md). The deterministic snapshot, proposal, receipt, and next-day recall rules live in [`player2-core`](../player2-core/DSHPlayer2.Core.csproj), while the reusable TypeScript contracts and turn coordinator live under [`packages`](../packages). Both can be covered by public CI without game assets.

## Merge rule

Protect `main` in GitHub: require the CI check to pass and require review before merge. Pull requests must explain their plugin boundary, player permission behavior, and verification evidence as required by [CONTRIBUTING.md](../CONTRIBUTING.md).

## Delivery rule

There is no release job until the project has a buildable Player2 vertical slice. That first delivery pull request must add build, test, and package validation for distributable artifacts; releases must run only from protected tags and publish a traceable artifact. Credentials belong in GitHub Environments or an identity provider, never in the repository.
