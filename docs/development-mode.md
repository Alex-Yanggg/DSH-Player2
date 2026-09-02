# Development-mode contract

Player2 is presently a development build. Its purpose is to expose the real
boundary with DeepSeek Harness, not to preserve a convincing demo when that
boundary is broken.

## Non-negotiable rules

1. Every player-visible companion proposal, chat reply, presence, receipt, or
   state claim must originate from a completed, validated native DSH turn.
2. A missing DSH-host bundle, unavailable DSH runtime, timeout, malformed bridge
   file, invalid model output, stale build, or presentation failure is an
   **error**, never an offline rule response, template, or silent no-op.
3. Deterministic TypeScript policies may exist only as keyless test fixtures or
   inside a DSH-run execution path. The SMAPI host must never present them as a
   companion response.
4. Each error shown in game includes a `traceId`. The host appends a structured
   JSONL record to `<DecisionBridgeDirectory>/development-logs/player2-host.jsonl`.
   The DSH-host bundle writes the corresponding native trace to
   `<DSH_HOME>/player2/bridge/development-logs/dsh-player2-host.jsonl` and
   preserves the Harness session event log.
5. A new save always opens the companion creator before a DSH day turn. A
   configured companion name is only preselected; it cannot silently bypass
   the creator.

## Debugging a report

Capture the in-game error code and trace id, then keep these files together:

- `development-logs/player2-host.jsonl` — SMAPI-side lifecycle and failures;
- `dsh-player2-host.jsonl` — bridge lifecycle and native DSH failures;
- DSH session event log — tool calls and native model response;
- the immutable bridge input/output file for the trace id.

Do not replace any of these failures with a player-facing fallback without an
explicit product decision and a matching regression test.
