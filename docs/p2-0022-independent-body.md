# P2-0022: the companion as an independent farmer (W2)

**Status:** plan, 2026-10-14. Follows the B-line phase result in
[p2-0021](p2-0021-b-line-goal-driven-companion.md#phase-result-2026-10-14-and-what-comes-next).

## Why

The B-line body is an NPC posing as a farmer. Stardew's code assumes a real
farmer behind every tool, crop, door, shop and pickup, so each interaction was
wired by hand (`BodyAdapter` per-button code, `BodyShop`, the stand-in avatar,
`CompanionInventoryStore`, harvest spill fixes, NPC barriers). Most B-line
defects came from that layer, and none of it carries over to a second game.

## The shape

The companion becomes a **real second farmer in the same game process**: a
local co-op player whose screen is never drawn, driven by a **virtual
controller**. The game then does everything a farmer does, natively.

```
DSH session (mind, goals, memory)      ── unchanged
  │ MCP tools: world_state / body_run / ...
game adapter (SMAPI mod)
  ├─ Seat      opens the hidden co-op player, joins it as a farmhand, closes it
  ├─ Pad       per tick, presses/holds the companion's controller buttons
  ├─ Eyes      BodyStateExporter, now reading the companion's own farmer + menu
  └─ Channel   BodyChannel + GameMcpServer + BodyTaskRunner (unchanged)
```

Three choices decide extensibility and portability:

1. **Input is the game's own controller.** The body protocol stops naming
   game verbs (`UseTool`, `MenuConfirm`); the adapter declares the buttons the
   game reads and what the game binds them to. Every game with gamepad support
   fits the same declaration; a game without one declares keys. The model reads
   the bindings and plans; the navigation helper only needs to know which
   buttons move (`move` on the input).
2. **Perception is the companion's own seat.** State is exported for the
   companion's farmer (its location, toolbar, open menu), so shops, chests and
   dialogue need no adapter code: an open menu is exported as the game holds it
   and driven with the same buttons.
3. **Nothing in the adapter decides.** No come/follow/stay parser, no melee
   loop, no harvest or shop logic. "Come here" is a chat line the companion
   answers by walking, in character.

The seat is the only Stardew-specific mechanism. Another game swaps the seat
(a headless protocol client, or a second instance) and keeps pad, channel and
plugin.

## Spike S13 (gate)

Pass when, on the owner's PC, with screenshots and a clean SMAPI console:

- a hidden second local player joins the loaded save as a farmhand;
- the host keeps the full window and frame time does not visibly drop;
- virtual controller input walks it, uses a tool, opens and buys at Pierre's,
  and it sleeps with the host;
- it keeps running while the host stands still or is in another location.

If S13 fails, the NPC body stays and only the thinning below the line ships.

## What is deleted after S13 passes

`NativeCompanion`, `BodyShop`, `CompanionInventoryStore`, `CompanionPresence`,
the per-button code in `BodyAdapter`, the come/follow/stay command path,
`reflex_melee` and `body_use` (the model composes `body_input`). The
appearance customization stays and is applied to the farmhand.

## Code budget

Added code stays under about 400 lines (seat, pad, menu export); the net
change must be negative by at least 1,000 lines. Each PR states lines added
and removed by kind.
