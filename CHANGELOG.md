# Changelog

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
  resolution path (requires an owner-approved dependency change).

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
