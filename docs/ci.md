# Continuous integration and delivery

The repository runs [CI](../.github/workflows/ci.yml) for every pull request, push to `main`, and manual workflow dispatch.

## What CI checks today

The project has no runnable application or package yet. The workflow therefore verifies the foundation that exists: it rejects whitespace errors and runs [`scripts/verify-docs.mjs`](../scripts/verify-docs.mjs), which requires one H1 per Markdown document and validates repository-relative Markdown links.

## Merge rule

Protect `main` in GitHub: require the CI check to pass and require review before merge. Pull requests must explain their plugin boundary, player permission behavior, and verification evidence as required by [CONTRIBUTING.md](../CONTRIBUTING.md).

## Delivery rule

There is no release job until the project has a buildable Player2 vertical slice. That first delivery pull request must add build, test, and package validation; releases must run only from protected tags and publish a traceable artifact. Credentials belong in GitHub Environments or an identity provider, never in the repository.
