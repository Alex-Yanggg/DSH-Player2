# Debate brief: the Player2 behavior architecture

Shared context every advocate gets. Read this before writing anything. The task contract is
[TASK.md](TASK.md); the process log is [PROGRESS.md](PROGRESS.md).

## The question

How should the Player2 companion turn a player's goal ("plant and water the parsnips", "get to
the ladder") into in-game actions? Which **behavior architecture** should own that loop, given
that Player2 is a plugin inside DeepSeek Harness (DSH) and must stay one? A separate judge — not
the advocates — will pick the winner from the final report, and **the judge weights
extensibility across many games while staying a DSH plugin** above everything else. Every
advocate must address that criterion explicitly.

## What Player2 is today (facts you may rely on)

- **The stack.** A Stardew Valley SMAPI mod seats the companion as a real hidden co-op farmhand
  with a virtual controller. The mod is a *pure adapter*: it exports raw game state and accepts
  raw button input over a local MCP endpoint. It starts `dsh --profile acp` (one DSH session per
  save) and talks ACP on stdio. DSH owns the model, tools, goals, prompt queueing, cancellation,
  sessions and logs. Player2 is one Cordis plugin mounted in that profile. See
  `README.md`, `docs/architecture.md` in the repo root.
- **The body protocol** (`packages/contracts/src/body.ts`): the adapter declares its inputs
  (buttons with `hold`/`press`/`modifier` kinds, roles like "up"/"action", cheat flags) and
  limits (tick length, walk speed, tile size, step limits). State is raw: map rows as legend
  characters, objects with per-kind `extra` payloads, characters, warps, the body's own tile,
  toolbar, stamina, open menus. Input is submitted as task files of steps (`{hold, press, ms}`)
  with `until` conditions (arrive/blocked/monster-within/warped), replaceable and cancellable.
  Nothing in the adapter knows "walk to" or "water this".
- **The plugin today** (the "pure LLM tool calling" baseline): persona prompt sections; turn
  markers on `agent/pre-step` (`[chat]`, `[day-start]`, `[day-end]`, `[resume]`, goal rounds);
  body tools — `world_observe`, `world_find`, `world_map`, `world_locations`, `body_walk_to`,
  `body_controls`, `body_input`; a memory ledger (`remember`, `dream_commit`). Navigation
  (`A*` + walk legs, `packages/dsh-companion-plugin/src/body/navigation.ts`, `walk.ts`) is a
  *helper library the model calls through `body_walk_to`, not a semantic adapter command.
- **A keyless simulator** exists: `packages/dsh-companion-plugin/src/body/sim-adapter.ts`
  implements the same `BodyPort` with a toy world (tiles, hoe/watering can/weapon, crops,
  monsters that die to a weapon swing, shops). The debate's experiments run on it.

## The DSH seams (the only integration surface)

Any candidate architecture must be built from exactly these, behind the plugin boundary —
**no second harness, no forked runtime, no side process that owns agent behavior**:

1. **Tools** the model can call (`defineTool` from `@deepseek-ai/dsh-tools`), each cancellable
   with the caller's turn.
2. **System-prompt sections** (persona, policies, guidance) injected per turn.
3. **Turn-flow hooks** like `agent/pre-step` that read the prompt marker and can rewrite the
   turn's inputs (this is how `[day-end]` becomes the dream today).
4. **A setup callback** at plugin start.
5. **DSH goals** (`create_goal` / `update_goal` / `get_goal`) — DSH, not the plugin, owns goal
   state, queueing and cancellation; the plugin may feed and observe them.
6. **The body port** (raw state, raw input) plus whatever helper libraries the plugin ships.
7. Ordinary local files under the plugin's bridge directory (the memory ledger works this way).

If a proposal needs a new runtime (a training loop, a planner daemon, a model server), it must
either be framed as a *separate tool the plugin calls* with an inspectable contract, or it is
out of bounds. Say honestly which one yours is.

## Product constraints that any architecture must respect

- The companion is **a trustworthy co-op player, not a bot**: it advances delegated plans only
  through explicit, inspectable, player-revocable permissions; it must not become an
  unattended-farming or account-automation tool. Architectures that imply long unattended
  autonomy must say where the permission boundary sits.
- The repo's design principle is **"intelligent software": guide, don't script** — prefer
  policies, tendencies and tools the model composes over fixed decision code; fixed logic needs
  a stated reason the model or harness cannot do it (see `docs/operating-model.md`). You may
  argue against the principle itself, but you must argue it head-on, not ignore it.
- Latency matters: the body shares the world with a live player; long model round-trips while
  the body stands idle are visible. Determinism and debuggability matter: a misbehaving
  companion must be explainable from logs.
- One codebase, many games eventually: Stardew is the first game, not the product.

## Debate mechanics

- Each advocate writes `transcripts/advocate-<name>.md`: **Claim** (one paragraph), **Mechanism**
  (how the loop actually works, concretely), **How it fits the DSH seams** (which seams, what
  code/data lives where), **Best evidence** (with inline URLs), **Extensibility across games**
  (the judge's weighted criterion — address it directly), **Anticipated attacks and your
  answers**, **References**.
- Cite only URLs you actually fetched with WebFetch (search-result URLs you did not open do not
  count). Also write `transcripts/sources-advocate-<name>.json`: a JSON array of
  `{ "url": "...", "fetchedAt": "YYYY-MM-DD", "note": "one line" }` for every fetched URL.
- After the opening statements there are three cross-examination rounds: each round you attack
  at least two named rivals' concrete claims with evidence and answer the attacks made on you.
- Be a strong advocate — take a position and defend it — but never fabricate: every factual
  claim about a system, paper or number needs a fetched source or must be labeled speculation.
