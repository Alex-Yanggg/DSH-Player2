# Changelog

## Unreleased - P2-0021 B line goal-driven companion

- adds body protocol v0.1 (`<session>/body/`): raw state export, declared raw
  inputs, write-once input tasks with cancel and status, and in-world speech;
  C# and TypeScript schemas share one golden fixture;
- turns the Stardew mod into a pure body adapter for the companion: held
  directions walk with the engine's collision, `UseTool` / `Action` /
  `DropItem` / toolbar slots act on the faced tile, a persisted 12-slot body
  toolbar; shop counters export their stock as a raw menu with cursor and
  confirm buttons (paid from the player's wallet); no semantic actions in the
  mod;
- adds plugin-side navigation (A* over the exported grid, warp-graph routes),
  a walk helper, a melee reflex script that measures its loop latency, and
  goal-mode tools for the companion plugin;
- adds the host goal lane: goals start from the player's own words without a
  consent dialogue, run across game days, stop on "stay" or a spoken stop,
  resume after a restart, and end honestly when the anti-runaway budget is
  spent; `GOAL_STATUS` reaches the chat lane;
- adds five persona knobs with seeded, logged dice, the spoken per-save cheat
  switch, and lets the goal lane use DSH's own web tools (logged by DSH);
- makes `full` the default autonomy (`consult` remains an explicit setting).

Acceptance: `npm run accept:0.2.0` (the `accept:0.1.4` baseline plus the
keyless goal-lane replay and the S10 spike) and `dotnet test`; the real-game
steps are in `stardew-mod/README.md`.

## Unreleased - P2-0016 W1 one mind

- adds the Mind Core and Persona Ledger: receipt and chat-nominated episodes,
  a thin replaceable flavor-cue episode pick, a decaying four-scalar mood, "our story", and evidence-backed
  traits, stored as local files beside each companion's bridge project;
- injects one bounded MindContext note into the chat, day-start, and decision
  lanes, and validates any episode a reply cites;
- upgrades the day-end dream to rewrite the story and add, strengthen, weaken,
  or retire traits with episode evidence, then refreshes `ledger/remember.md`;
- answers "why did you say that" from the episodes the previous reply was given,
  and migrates the growth asset into traits;
- queues chat lines sent while a reply is pending instead of refusing them.

## Unreleased - P2-0013 native persona runtime

- adopts the official `@deepseek-ai/dsh-agent-presets` and
  `@deepseek-ai/dsh-persona` kernel packages;
- materializes each exact Player-authored identity as a content-addressed,
  persona-only DSH preset and mounts it for both decision and social lanes;
- records the preset id in every new durable DSH session header, intentionally
  starting a fresh lane at the composition boundary while keeping receipt
  memory continuous; and
- removes the Player2-only `presetAutonomy` shadow. Autonomy stays a separate
  host policy and defaults to `consult` (`full` since P2-0021).

Focused acceptance is the host/companion package tests and type checks plus
`npm run replay:dual:reflect`; the earlier `npm run accept:0.1.2` gate remains
the full regression baseline.

## Unreleased - P2-0012 kernel deep integration

- adds the `companion_reflect` decision tool: the companion may record up to
  three receipt-grounded insights about itself plus one self-chosen focus,
  written once as `outbox/growth-<sequence>.json`; growth is self-knowledge and
  never an authority;
- adds the Player-owned `CompanionGrowthStore` (validated application, monotonic
  revision, FIFO insight cap, no soul field by construction) and the optional
  `growth` envelope field so the next turn carries what the companion learned;
- answers DSH's native approval waterfall with the companion's autonomy tier
  (`consult` rejects in-session asks; `full` grants companion-owned tools only;
  foreign tools fall through);
- registers package-owned composition invariants on the optional
  `ctx.invariants` seam; and
- records the published upstream `@deepseek-ai/dsh-agent-presets` as the UR-1
  resolution path (adopted by P2-0013).

The reproducible acceptance command is `npm run accept:0.1.2`, which chains the
`accept:0.1.0` gate with the reflect golden replay and the unattended three-turn
dual-end self-evolution cycle.

## 0.1.0 - 2026-09-03

This release candidate completes the Player2 vertical slice for the current
development gate:

- adds player-authored companion identity, soul commitments, bounded chat, and
  Simplified Chinese fixed UI text;
- adds farmer self-observation and consult/full autonomy tiers with explicit
  receipt markers for autonomous execution;
- validates the native DSH bridge through keyless social, decision, dispatcher,
  and unattended dual-end replays;
- makes malformed companion souls fail at mount time with a readable contract
  error; and
- keeps the acceptance command reproducible on a clean checkout, including a
  cold .NET host start.

The repository remains a development build. Stardew Valley and SMAPI adapter
verification still require the locally installed game assemblies described in
[`stardew-mod/README.md`](stardew-mod/README.md).
