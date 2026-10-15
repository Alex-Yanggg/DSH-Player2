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

### Results so far (2026-10-14, throwaway copy of a day-1 save with a cabin)

- **Join: pass.** The farmhand joins about 5 s into the day and the host keeps the full window.
- **Cost: pass.** On Intel UHD 600 with 4 cores, the seat adds about 0.13 CPU cores, 3 % GPU and 200 MB, with 54–60 fps against 59–60 without it.
- **Unfocused: pass.** The world clock keeps running with the window in the background.
- **Walk and buy: pending.** The model provider was unreachable from the PC.
- **Bedtime:** the host waits in bed for the companion, but nothing told the companion. The mod now sends a `[world]` prompt, a plain fact the persona reacts to in its own way.
- **Firewall:** Windows asks once to allow StardewModdingAPI, because the game's co-op server listens on UDP 24642. The companion itself uses only loopback.

## What is deleted after S13 passes

`NativeCompanion`, `BodyShop`, `CompanionInventoryStore`, `CompanionPresence`,
the per-button code in `BodyAdapter`, the come/follow/stay command path,
`reflex_melee` and `body_use` (the model composes `body_input`). The
appearance customization stays and is applied to the farmhand.

## Code budget

Added code stays under about 400 lines (seat, pad, menu export); the net
change must be negative by at least 1,000 lines. Each PR states lines added
and removed by kind.

## A player's day, and what can break for the companion

The seat is tested the way a day is played, not by feature. Each step names its risk for a hidden second farmer.

| Step | What the player does | Risk for the companion |
| --- | --- | --- |
| Wake | Leaves the farmhouse at 6:00; the companion wakes in its cabin. | Join or creation runs again on a later day; the cabin door warp leaves it stuck at the door. |
| Chores | Hoes, waters, opens the inventory, switches to another window. | The window loses focus or a host menu opens: the seat must keep running (it has its own screen), and a paused goal must hold. |
| To town | Walks the farm, bus stop and town warps. | A warp mid-walk invalidates the path; the companion is in a different place from the player. |
| Pierre's | Shop opens 9:00, closed Wednesday; talk at the counter, buy seeds. | The shop is a menu on the seat's own screen: it must be exported and driven with the same buttons; buying needs the companion's own gold. |
| Evening | Ships, heads home. | Nothing tells the companion the day is ending. |
| Bed | Host sleeps; the game waits for every farmer. | The host waits forever if the companion never goes to bed; at 2:00 both must pass out. |
| Save | Sleeping saves the day for both farmers. | The save must keep the companion's farmhand; reloading lands on the next day with no creation, and the companion must rejoin as the same farmer. |

Test saves are throwaway copies made with `python e2e/make_save.py <source> [--day N --season S]`, which edits the date in the save XML. Copying a save the companion already slept in skips day-1 creation.
