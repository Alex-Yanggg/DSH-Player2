# Changelog

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
