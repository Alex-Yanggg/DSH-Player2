# DSH 0.2.0-rc.2 facts: memory, search, and the acp profile

Verified 2026-10-24 against the globally installed `dsh 0.2.0-rc.2` (`dsh --version`).
Package root (abbreviated **`$DSH`** below):
`C:\Users\user\AppData\Local\pnpm\global\v11\4d84-1a16635c7ca-37dab4d1fb676e17\node_modules\@deepseek-ai`
(163 `@deepseek-ai` packages). Every fact below names the file it was read from.

## 1. Web search — YES, two documented plugin-visible routes, both mounted in `acp`

- **The seam.** `ctx.web` is a public Cordis service (`WebRuntime`) with `search(request, signal)` /
  `fetch(...)`, a provider registry (`registerSearchProvider` / `registerFetchProvider`) and strict
  provider-selection rules (configured-id wins; exactly-one-usable auto-selects; otherwise structured
  `WebError`s: `WEB_PROVIDER_UNAVAILABLE`, `WEB_PROVIDER_AMBIGUOUS`, …).
  `$DSH\dsh-web\lib\types\index.d.ts` ("Service Definition for the web access capability seam (`ctx.web`)").
  Any Cordis plugin — including Player2's — can call `ctx.web.search()` directly from its own tools.
- **The model-facing tools.** `@deepseek-ai/dsh-tool-web` registers the `web_search` (multi-query, up to
  4 queries / 8 sources by default) and `web_fetch` tools over `ctx.web`; its required services are
  `inject = ["tools", "web", "systemPrompt"]` (`$DSH\dsh-tool-web\lib\index.js` line ~832; types in
  `lib\types\index.d.ts`, `search.d.ts`, `fetch.d.ts`). A plugin does not re-implement search to give the
  model web access; it enables/configures this row.
- **The shipped provider.** `@deepseek-ai/dsh-web-search-deepseek` searches via DeepSeek's native search
  (structured search blocks, not scraping) using `DEEPSEEK_API_KEY` or account sign-in. Its README warns:
  **one search costs a full model turn in latency and tokens** because DeepSeek exposes no dedicated search
  endpoint; missing credential or missing search block fail loudly with structured errors.
  `$DSH\dsh-web-search-deepseek\README.md`. Plain-HTTP page fetches need no credential:
  `$DSH\dsh-web-fetch-http\README.md` (+ `lib\types\network.d.ts`, `policy.d.ts`).
- **In the `acp` profile** (`dsh --profile acp --dump-default-config`, verified locally): rows `web`
  (`searchProvider: deepseek-official`, `fetchProvider: http`), `web-search-deepseek`
  (`apiKeyEnv: DEEPSEEK_API_KEY`), `web-fetch-http`, and `tool-web` (`fetch: true`,
  `searchTimeoutMs: 60000`; `search` defaults to true). So under the profile Player2 actually boots, both
  the seam and the model-facing tools are present out of the box.

## 2. Cross-session / project memory — NO built-in memory service; five partial facilities

No package named or typed "memory" exists; grepping all 163 packages' type surfaces for memory/remember/
recall/lessons yields no store. What exists:

1. **Session persistence + resume (same session id).** `dsh-session-persistence-jsonl` persists logs; the
   `acp` profile mounts it, and `dsh-acp` exposes `session/list`, `session/resume` ("a persisted inactive
   session … its log is restored without replaying old updates"), `session/close`. `$DSH\dsh-acp\README.md`
   (protocol contract table). This is conversation continuity for one session across restarts — not
   distilled memory, and it does not span saves or sessions.
2. **`ctx.sessionQuery` — full-text search across past sessions.** `dsh-session-query` defines the service;
   `dsh-session-query-sqlite` implements it as SQLite FTS5 over live+persisted history with
   `searchSessions` / `searchEvents` (ranked hits, snippets, cursor pagination; `$DSH\dsh-session-query-sqlite\lib\types\index.d.ts`).
   **In the shipped `acp` profile it is mounted with `path: ':memory:'` and `openAt: never`** — full-text
   search disabled by default (exact reads/filters/traces still work); enabling it is a one-row profile
   patch. Search is "opt-in in shipped compositions" per its README. This is the closest thing to a
   cross-session recall primitive DSH ships.
3. **Compaction (within-session).** `dsh-compaction` + `dsh-compaction-basic` condense older history into
   one summary message; shadowed content stays in the session log. `$DSH\dsh-compaction\README.md`;
   mounted in `acp` with `dsh-command-compact` and a tool-result pruner.
4. **Spill (`ctx.spillStore`).** Save oversized text, get an opaque locator + byte count + retrieval
   guidance. The API intentionally offers **no** retention, replacement, retrieval, or search.
   `$DSH\dsh-spill\README.md` (+ `dsh-spill-local`, `dsh-spill-policy`, both mounted in `acp`).
5. **File-based channels.** `dsh-agent-instructions` injects the AGENTS.md/CLAUDE.md chain (user-global →
   project → cwd) and re-discovers deeper files after successful fs operations and on session resume
   (`$DSH\dsh-agent-instructions\README.md`). `dsh-persona` registers per-agent prompt prefix/suffix rows
   whose `{{…}}` templates resolve against registered prompt variables **at render time**
   (`$DSH\dsh-persona\README.md`) — a static config, but render-time variables make the persona text
   dynamic. Neither is a memory service; both are injection points a plugin can feed.

## 3. Other facilities relevant to the options

- **Goals.** `dsh-goal` (mounted in `acp` with `dsh-goal-round-driver`, `dsh-tool-goal`, `dsh-command-goal`):
  one long-running objective persisting across turns, session resume, fork, and process restarts;
  compare-and-set updates; automatic continuation bounded by a round cap (default 256); blocked goals keep
  a stable policy code + human-readable explanation. `$DSH\dsh-goal\README.md`.
- **Skills.** `dsh-skill` = one catalog of reusable task-specific instructions from local directories,
  embedded plugin data, or remote services; `dsh-skill-filesystem` discovers local entries;
  `dsh-tool-skill` gives the model on-demand loading. `$DSH\dsh-skill\README.md`. All three are mounted in
  `acp`.
- **PTC (programmatic tool calling).** `dsh-ptc-runtime` runs one model-written program against
  host-provided async functions, returning lossless JSON + ordered logs, isolated per run
  (`$DSH\dsh-ptc-runtime\README.md`); `acp` mounts `dsh-ptc-runtime-node`, `dsh-workflow-ptc`,
  `dsh-tool-workflow`. This is the shipped batching primitive (one model round-trip, many tool calls).
- **Hooks.** `dsh-hook-protocol` (bridges: `dsh-hooks-claude-code`, `dsh-hooks-codex`) lets hooks block a
  prompt or tool call with a model-visible message, attach extra context, or stop the run; only command
  hooks run. `$DSH\dsh-hook-protocol\README.md`. The Cordis-native equivalent Player2 already uses is an
  `agent/pre-step` listener (`dsh-agent-loop` owns pre-step admission:
  `$DSH\dsh-agent-loop\lib\types\runtime-context.d.ts` line ~29, `agent.d.ts` line 59).
- **Time context.** `dsh-time-context` appends source-attributed clock readings at eligible steps
  (default min interval 10 min) — the model-visible passage-of-time channel. `$DSH\dsh-time-context\README.md`.
- **Auto review (experimental, web profile only).** Provider/model assesses each pending tool call before
  execution; off by default. `$DSH\dsh-experimental-auto-review\README.md`. Not mounted in `acp`.
- **Fresh-agent loops.** `dsh-tool-ralph` runs rounds of fresh child agents against one immutable
  objective, each round seeing only the previous bounded report; parent conversation never copied.
  `$DSH\dsh-tool-ralph\README.md`. Explicitly "only when the direct human requests it".

## 4. Gaps that matter for self-improvement

- No lesson/insight store, no reflection scheduler, no automatic curriculum, no cross-save identity, no
  per-save persona memory ship with DSH. A self-improving companion must build all of these from:
  ordinary plugin files (the memory-ledger pattern), `ctx.sessionQuery` (needs an FTS-enabling profile
  patch), `ctx.web` (needs a DeepSeek credential; one model turn per search), goals, skills, PTC, and
  turn-flow listeners.
- Web search in `acp` is live but billed as latency/tokens per query — a design constraint for
  reflect-and-search loops (search sparingly, cache results in plugin files).
- `session/resume` restores one session's log; there is no API to copy learned state between sessions
  other than files the plugin writes.

## 5. One-line implications for the debate options

- **(a) Stuck detector + reflect-and-search:** all seams exist (pre-step listener, own files, `ctx.web`),
  but each reflection+search costs model turns; DSH will not do it for the plugin.
- **(b) Persona-level library across saves:** no DSH concept of a save; a plugin-owned directory keyed by
  an adapter-declared save id + transparent prompt sections is the DSH-native shape (persona rows/variables
  and `dsh-skill` catalogs are the nearest shipped mechanisms).
- **(c) Exploration-first curriculum:** goals + pre-step can drive it; DSH has no curriculum service.
- **(d) Action-rate:** PTC (`dsh-ptc-runtime-node`, mounted in `acp`) is the shipped batching primitive;
  skills/reduced round-trips build on it.
- **(e) Combinations:** the `acp` profile already mounts every seam above simultaneously; composition is
  configuration + one plugin, not new runtime.
