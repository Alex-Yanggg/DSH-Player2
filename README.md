# DSH-Player2

<p align="center">
  <img src="assets/player2-readme-hero.svg" alt="Player2: a game companion built on DeepSeek Harness" width="900">
</p>

<p align="center">
  <strong>An AI second player for games, starting with Stardew Valley.</strong><br>
  Player2 is a companion with its own persona who plays alongside you: it talks in the native game UI,
  takes on goals from your words, plays with its own body, and remembers what you lived through together.
</p>

<p align="center">
  <a href="https://github.com/Alex-Yanggg/DSH-Player2/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Alex-Yanggg/DSH-Player2/ci.yml?branch=main&label=CI"></a>
  <img alt="Stardew Valley" src="https://img.shields.io/badge/Stardew%20Valley-SMAPI%204.5%2B-brown">
  <img alt=".NET" src="https://img.shields.io/badge/.NET-6.0-512BD4">
  <img alt="Node" src="https://img.shields.io/badge/Node-24.x-339933">
  <img alt="License" src="https://img.shields.io/badge/license-pending-lightgrey">
</p>

## What It Is

DSH-Player2 is a game companion built on [DeepSeek Harness](https://github.com/dsh2026/test-Alex-Yanggg). It does not fork, vendor, or patch Harness internals: the companion's mind is an ordinary DSH session in DSH's own `acp` profile, with Player2 mounted as one plugin. Player2 adds only what DSH lacks: the persona, the game's body (raw state and raw input), and a memory ledger.

## Current Slice

| Capability | Current behavior |
| --- | --- |
| Native game UI | F2 opens a compact chat overlay with scrollback, input recall, and per-save history; the companion speaks above its head. |
| One DSH session per save | The mod starts `dsh --profile acp` and talks ACP; DSH owns models, tools, goals, queueing, cancellation and logs. |
| Goals from your words | "给我弄 3 根胡萝卜" becomes a DSH goal the companion pursues across days; a paused game holds the goal. |
| Raw body | The mod serves an MCP endpoint with raw state export and raw button input; navigation and reflexes live in the plugin. |
| Persona | Soul constitution plus five knobs (talkativeness, help-seeking, risk, obedience, skill). |
| Memory | Episodes the companion chooses to remember, a story rewritten by the end-of-day dream, traits and mood; a readable `remember.md`. |
| Movement commands | "come here", "follow me", "stay" move the companion at once through native pathfinding. |

## Scope

The one hard non-goal: Player2 is not a second DeepSeek Harness runtime, and Harness is never patched as a side effect of game work. Everything else (unattended farming, cheat-style abilities, broader game mechanics) is simply not the current focus; the slice above is what is proven today, and it does not claim that every Stardew mechanic is supported.

## Quick Start

Prerequisites:

- Stardew Valley with SMAPI 4.5+
- .NET 6 SDK
- Node.js 24.x
- DeepSeek Harness `0.2.0-rc.2` installed globally (`@deepseek-ai/dsh`); Player2 is only a plugin and ships no runtime of its own

Install dependencies, verify, and add the plugin to DSH's acp profile:

```powershell
npm ci
npm run accept
dsh plugin --profile acp add ./packages/dsh-companion-plugin
```

Build and deploy the Stardew mod from a Windows checkout with Stardew installed:

```powershell
dotnet build .\stardew-mod\DSHPlayer2.Stardew.csproj --configuration Release -p:OS=Windows_NT
```

Start the game through `StardewModdingAPI.exe`, load a save, choose or customize a companion, and press **F2** in game to talk.

## Verification

`npm run accept` builds, type-checks and tests the TypeScript packages and runs the pure C# core tests; CI runs the same plus the documentation verifier. The SMAPI adapter needs local game assemblies, so GitHub-hosted CI cannot build it. For game-side validation, run the real-game suite in [e2e/README.md](e2e/README.md) on a local Windows machine and the manual check in [stardew-mod/README.md](stardew-mod/README.md).

## Architecture

```text
Stardew / SMAPI mod
  chat UI, speech, companion presence, raw state + raw input (MCP endpoint)
      |  ACP over stdio: [day-start] [chat] [day-end] [resume]
      v
dsh --profile acp  (one session per save)
  models, goals, tools, queueing, cancel, logs  — DSH's own
      |
      v
Player2 plugin
  persona prompt, body tools, memory ledger, dream
```

Read [docs/architecture.md](docs/architecture.md) for details.

## Repository Map

| Path | Purpose |
| --- | --- |
| [packages/contracts](packages/contracts/src/index.ts) | Soul, persona knobs, persona ledger and body wire schemas. |
| [packages/dsh-companion-plugin](packages/dsh-companion-plugin/src/index.ts) | The DSH plugin: persona prompt, body tools, navigation, reflexes, memory and dream. |
| [player2-core](player2-core/DSHPlayer2.Core.csproj) | Pure C#: ACP client, game MCP endpoint, body channel and task runner, movement parsing, chat transcript. |
| [stardew-mod](stardew-mod/README.md) | SMAPI adapter: starts DSH, native UI, companion body and rendering. |
| [e2e](e2e/README.md) | Real-game end-to-end tests that drive Stardew like a player. |
| [fixtures](fixtures) | Body protocol golden frames shared by C# and TypeScript tests. |
| [docs](docs/architecture.md) | Architecture, CI, development mode, operating model, and task-specific notes. |

## Development Rules

Read [docs/operating-model.md](docs/operating-model.md) before non-trivial changes. The short version:

- give the companion thinking guidance and light constraints, not fixed behavior;
- preserve the DSH boundary and use public Harness contracts only;
- add focused tests or replay fixtures for behavior changes;
- document every user-visible game behavior with a reproducible manual check;
- never store credentials, game assets, private saves, or machine-specific paths in the repo.

## Status

This repository is pre-release. The 0.1.x line has a playable Stardew vertical slice and a strong keyless regression chain, but no public release package and no selected license yet. Detailed change history lives in [CHANGELOG.md](CHANGELOG.md).
