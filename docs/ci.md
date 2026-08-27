# Continuous integration and delivery

The repository runs [CI](../.github/workflows/ci.yml) for every pull request, push to `main`, and manual workflow dispatch.

## What CI checks today

The workflow rejects whitespace errors and runs [`scripts/verify-docs.mjs`](../scripts/verify-docs.mjs), which requires one H1 per Markdown document and validates repository-relative Markdown links.

The repository now contains a minimal SMAPI probe, but GitHub-hosted CI cannot compile it honestly: compilation requires the proprietary Stardew Valley assemblies from a locally installed game, which this public repository must not redistribute. The probe is therefore built and smoke-tested locally as documented in [`stardew-mod/README.md`](../stardew-mod/README.md). When Player2 logic no longer depends on game assemblies, its pure unit tests belong in CI; the game adapter remains a documented local integration check.

## Merge rule

Protect `main` in GitHub: require the CI check to pass and require review before merge. Pull requests must explain their plugin boundary, player permission behavior, and verification evidence as required by [CONTRIBUTING.md](../CONTRIBUTING.md).

## Delivery rule

There is no release job until the project has a buildable Player2 vertical slice. That first delivery pull request must add build, test, and package validation for distributable artifacts; releases must run only from protected tags and publish a traceable artifact. Credentials belong in GitHub Environments or an identity provider, never in the repository.
