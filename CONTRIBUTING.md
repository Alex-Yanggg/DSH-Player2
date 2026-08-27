# Contributing to DSH-Player2

Thank you for helping build a reliable game companion.

## Before opening a change

- Read [AGENTS.md](AGENTS.md) and keep the work inside this repository.
- Open an issue or discussion first for a new game integration, agent permission, networked service, or cross-project contract.
- Keep pull requests focused. Explain the player-visible behavior, permission boundary, failure mode, and how you verified it.

## Pull requests

- Do not include credentials, personal game saves, proprietary game content, or generated build output.
- Add or update focused tests where automation is practical; otherwise provide exact manual reproduction and verification steps.
- Update the README when prerequisites, supported platforms, configuration, or user-facing behavior change.
- Propose upstream DeepSeek Harness changes separately. A Player2 pull request may depend on an upstream release, but it must not carry an upstream core patch.
