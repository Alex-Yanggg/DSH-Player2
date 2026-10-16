# Changelog

## Unreleased - W2 under ACP (P2-0018)

- the companion's words show sentence by sentence while DSH still streams the
  rest of the turn;
- more [world] facts it could not see in its own state: the player badly hurt
  (cuts in at once), exhausted, a fish caught, a new mine level, a skill level
  up; at most one an in-game hour, and none while the player is in a cutscene,
  festival or minigame, when the companion's lines are held as well;
- native emotes (the co-op chat's /emote) on the companion's controller
  (`EmoteHappy`, `EmoteHeart`, ...);
- W2's wire/WebSocket plan is superseded by ACP plus the game endpoint
  (P2-0022), so no new dependency or lock-file change.

## Unreleased - star personas and persona packs (P2-0017)

- a companion is a persona pack: `personas/<id>/persona.json` (format
  `player2.persona/0`) with soul, voice samples, catchphrases, reactions,
  habits, relationship arc, five knobs and probe questions; the mod reads only
  the name and hands the pack to the plugin, which validates and binds it;
- two official personas ship, 大肥鱼 and 军师; the Mira, Rowan and Kai config
  roster and the C# soul fields are gone;
- validator v0 (`npm run persona:check`): strict structure, and no wording
  that grants powers;
- e2e `persona` category: each persona answers its probes, and
  `blind_sheet.py` builds the H2 blind sheet.

## Unreleased - B-line close-out (P2-0021 3b)

- the location graph includes building interiors, so the companion can route
  out of its own cabin;
- a turn DSH rejects is reported once, not twice;
- plugin test files run one at a time (the body simulator ticks on wall-clock
  timers).

## Unreleased - independent body (P2-0022)

- the companion is a real co-op farmer: a hidden second local player in the
  same game process joins the save as a farmhand (it needs a cabin, like any
  co-op friend) and plays through its own virtual controller; the host keeps
  the whole window;
- body protocol 0.2: inputs are the game's controller buttons with what the
  game binds them to (`body_controls`), and the menu on the companion's own
  screen is exported as the game holds it;
- state is built only when the plugin asks and serialized off the game thread
  (owner bug OB-2);
- removes the NPC stand-in (`NativeCompanion`, `BodyShop`, the stand-in
  inventory store, come/follow/stay commands), `body_use` and the scripted
  melee reflex; the world no longer pauses for one player's menu or an
  unfocused window, as in co-op.

## Unreleased - DSH-native transport

- the mod now starts `dsh --profile acp` as its own child process, one DSH
  session per save, and talks ACP over stdio: `[day-start]`, `[chat]`,
  `[day-end]` and `[resume]` prompts; what the companion says is shown above
  its head, on the HUD and in the chat history;
- the companion's hands are a localhost MCP endpoint served by the mod
  (raw state and raw input); the plugin's body tools call it directly;
- goals are DSH's own (`create_goal` / `update_goal`); a paused game cancels
  the turn in flight, DSH pauses the goal, and `[resume]` re-arms it without a
  model call;
- removes the file bridge (turn, proposal, grant, receipt, social, speech and
  goal files), the consent dialogue and decision lane, the host plugin and its
  goal lane, the runtime package, the dual-host harness, the readiness
  heartbeat, `dsh --profile web` auto-start, the F6 retry key, the chat queue,
  and Player2's own development and latency logs (DSH's session logs are the
  record);
- memory episodes now come only from what the companion chooses to `remember`;
  the dream closes with `dream_commit`;
- `npm run accept` replaces the versioned acceptance chains.

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
keyless goal-lane replay) and `dotnet test`; the real-game
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
