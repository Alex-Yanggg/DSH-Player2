# P2-0014: Dream Event Spine (watermark projection + dream turn)

Outcome: upgrade experience → reflection → growth from a file bridge to DSH
replayable event facts. The middle two points of the kernel research §7 ticket
only: (2) the watermark projection folds the relationship timeline
incrementally from `sessionPersistence.readFrom(sessionId, watermark)`, and
(3) one dream turn closes per explicit day-end boundary. The closing two
points (per-step model routing, the subagent critic) are explicitly out of
scope per the owner.

Owner scope: requested in the current conversation; scope alignment recorded
for the PM in the product workspace
(`10-product-validation/p2-0014-requirements-alignment.zh.md`, commit
`f1f3df7`). L2: bridge files and a detached event log; no new game authority.

Non-goals: model routing (`agent/request`), `dsh-subagent-spawn-in-process`,
soul writes of any kind, new network requests, Harness changes, CI or
dependency lockfile edits.

Allowed files: packages/contracts, dsh-companion-plugin, dsh-host-plugin and
tests, player2-core and tests, player2-dualhost, stardew-mod, scripts, README,
documentation. Commands: local git, npm, dotnet, local deployment.

## Shape

- Spine events (log-only, `ignorable: true`, references and results only —
  receipt files remain the fact source): `companion/receipt-observed`,
  `companion/reflection-proposed`, `companion/growth-applied`,
  `companion/dream-closed`. Declared by module augmentation of
  `SessionEventMap` in `@deepseek-ai/dsh-session/types`.
- The spine lives in a detached persistence session (`player2-spine-<hash>`,
  one per person and save) written through the public
  `sessionPersistence.create/append` seam — the sanctioned downstream path,
  because `Session.append` cannot set `ignorable` and persistence readers
  refuse unknown required events. Conversation-lane logs never change.
- `SpineTimeline` is the watermark projection: hydrate from a persisted state
  file and read only the suffix past the watermark; fold idempotently by
  reference key; one lost-race resync-and-retry around appends.
- The dream lane: `dream-inbox/dream-<sequence>.json` is the only trigger
  (`GameLoop.DayEnding` in the mod; `--dream` in the dual host). The lane has
  no tools; its reply parses to `{"kind":"no-change"}` or one growth proposal
  whose insights may cite only receipt sequences on the projected timeline.
  Outcomes are write-once (`dream-nochange-<sequence>.json` /
  `dream-growth-<sequence>.json`), mutually exclusive, and the Player applies
  growth through the existing `CompanionGrowthStore`. Dream sequences draw
  from the same monotonic turn space so the growth asset revision stays one
  causal line.

## Acceptance and evidence

- `npm run replay:dream` — the four-turn keyless replay: turn 21 leaves
  receipt-21 and the spine records `receipt-observed`; turn 22 applies the
  reflect growth, ends the day, and the dream closes with one grounded growth
  proposal (sequence continues the turn space, Player applies it); turn 23
  runs in a restarted process whose spine read is a suffix-only increment
  (persisted watermark asserted) and the next envelope carries the same
  growth. First run: PASS (`dual-end-model: dream 1788612563 closed with
  growth (watermark 3)`).
- Negative paths locked: a growth insight citing a receipt sequence absent
  from the projected timeline is rejected; a dream output has no soul,
  capability, or autonomy field by construction and the lane has no other
  write path; duplicate spine events fold once (`spine.test.ts`).
- `npm run accept:0.1.4` (0.1.2 chain + `replay:dream`), companion plugin
  49 tests including the new spine suite, host plugin 9 tests, C# core 88
  tests, mod Release build (pre-existing CS9057 analyzer warning only).

## Manual game check (still required)

1. Play to a day end with a chosen companion; confirm the SMAPI log line
   `Player2 published dream request <sequence> for the ended game day.`
2. Confirm the next DSH trace shows `DSH_DREAM_TURN_COMPLETED` with the
   projected watermark, and `outbox/dream-*.json` exists for that sequence.
3. Confirm the next day's decision turn carries the growth asset the dream
   produced (or nothing after a no-change dream) and that a corrupted dream
   outcome file surfaces as a loud error rather than a silent reset.

No claim of in-game dream verification is made until these checks are
observed.
