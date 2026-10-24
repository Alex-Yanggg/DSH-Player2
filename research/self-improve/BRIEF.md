# Debate brief: the self-improving companion (round 2)

Shared context every advocate gets. Read this before writing anything. The task
contract is [TASK.md](TASK.md); the process log is [PROGRESS.md](PROGRESS.md);
verified platform facts are [dsh-facts.md](dsh-facts.md). A separate judge —
not the advocates — will weigh the final report, and **the judge weights
extensibility across many games while staying one DSH plugin, with zero
hardcoded game facts, above everything else** (the owner has explicitly ruled
out game content in code: no hardcoded game facts, no per-game rule tables for
knowledge). Every advocate must address that criterion explicitly.

## The question

In real play (P2-0019 mine e2e, 2026-10-24) the companion: did not know the
mine is closed until spring day 5 and lost days to it; hit the same wall
repeatedly without stepping back; did very little per in-game day; and acted
sparsely (long model round-trips; round-1 baseline G2 skill-gap p95 ~20 s, G1
idle ~0.9). The owner wants the companion to **grow by itself** — web search +
RSI-style learning — as one DSH plugin. Which self-improvement architecture
should own that growth loop?

## What Player2 is today (facts you may rely on)

- **The stack.** A Stardew SMAPI mod seats the companion as a real hidden
  co-op farmhand with a virtual controller; the mod is a pure adapter (raw
  state out, raw button tasks in, over local MCP). It starts `dsh --profile
  acp` (one DSH session per save) and talks ACP on stdio. Player2 is one
  Cordis plugin in that profile. The plugin today: persona prompt sections,
  turn markers on `agent/pre-step`, body tools (`world_observe/find/map/
  locations`, `body_walk_to/controls/input`), a memory ledger
  (`remember`/`dream_commit`), a fixed reflex tier (`reflexes/
  stardew-valley.json` + engine), and a skill store (`skill_save`/`skill_run`).
  Navigation (A* + walk legs) is a helper library the model calls.
- **The DSH platform (0.2.0-rc.2, verified — read [dsh-facts.md](dsh-facts.md)).**
  Web search exists as a public seam: `ctx.web` (`@deepseek-ai/dsh-web`) plus
  the model-facing `web_search`/`web_fetch` tools (`dsh-tool-web`), both
  mounted in the `acp` profile with the DeepSeek provider reading
  `DEEPSEEK_API_KEY`; one search costs a full model turn. There is **no
  built-in memory service**: closest are `ctx.sessionQuery` (SQLite FTS5 over
  past sessions, mounted in acp but with FTS disabled by default), session
  resume (same session id, log restored), compaction (within-session),
  `ctx.spillStore` (write-once blobs), AGENTS.md-style instruction injection,
  and render-time persona template variables. Goals (`dsh-goal`) persist
  across turns/resume/restarts with a 256-round cap. Skills (`dsh-skill` +
  `dsh-skill-filesystem` + `dsh-tool-skill`) form a catalog loaded on demand.
  PTC (`dsh-ptc-runtime`) runs one model-written program against host-provided
  async functions — the shipped batching primitive. Hooks (`dsh-hook-protocol`)
  can block prompts/tool calls with a message or attach context.
- **A keyless simulator** (`packages/dsh-companion-plugin/src/body/sim-adapter.ts`)
  implements the same BodyPort; the debate bench runs on it unmodified.

## The options (one advocate each)

- **(a) reflect — Stuck detector + reflect-and-search** (Reflexion/ExpeL
  style): detect repeated failure, step back, write lessons, search the web for
  world facts, act differently.
- **(b) library — Persona-level library shared across saves** (one DSH session
  per save): lessons (and skills?) that persist per save and load
  transparently each session. Must address: how a save is identified (the
  game's own unique save id vs watermarking), how loading stays transparent,
  what is shared vs kept local, and privacy (player data stays local).
- **(c) curriculum — Exploration-first** (Voyager-style automatic curriculum):
  "learn the world before the goal"; surveys, field guides, curiosity. Must
  address: who pays for exploration, when it ends, the permission boundary
  (this must not become unattended farming), and composition with a delegated
  goal.
- **(d) actionrate — Action-rate fixes**: fewer model round-trips per action —
  batched plans (PTC), skills, the reflex tier, streaming tool calls. Must
  argue how rate relates to learning itself (nothing learns while the body
  idles at 0.9), and honestly confront "this fixes throughput, not knowledge".
- **(e) combo — Combinations**: pick a SPECIFIC composition (e.g. library +
  reflect + batching), defend why the composition beats each part alone and
  where you draw the line (what you deliberately leave out and why).

Every option must be implementable as a DSH plugin from the verified seams
(no second harness, no hardcoded game facts — runtime-learned data in plugin
files is fine, shipped per-game tables are not). Bench prototypes of all five
already exist in [bench/](bench/README.md) (scenarios: locked, wall, and their
toy2 variants); the matrix results will appear in the final report — do NOT
quote unmeasured numbers, and do not run the bench yourself.

## Prior round (context you may use)

`git show origin/behavior-research:research/behavior-debate/REPORT.md` — the
round-1 architecture debate (behavior loop, not growth). Its relevant results:
farm 10/10 for most finalists at 1.2-6.1 LLM calls; mine 9/10 for GOAP at 1.2
calls, 8/10 skills at ~0 (library retrieval), 7/10 pure-LLM at 6.1 calls;
toy2 port: pure-LLM 3/3 @ 30 calls, GOAP 3/3 @ 1 call, one-shot authored-data
approaches 0/3. Nobody addressed growth across sessions — that is this round.

## Required reading (already fetched for you)

[transcripts/notes-rsi.md](transcripts/notes-rsi.md) — RSIAgent (arXiv
2609.15364) and Zhipu-affiliated HarnessPro (arXiv 2610.26770, released this
week). [transcripts/notes-classics.md](transcripts/notes-classics.md) —
Reflexion, Voyager, ExpeL, Agent Workflow Memory, CLIN, Generative Agents.
You may fetch more sources yourself (see mechanics).

## Product constraints every architecture must respect

- The companion is **a trustworthy co-op player, not a bot**: it advances
  delegated plans only through explicit, inspectable, player-revocable
  permissions; growth must not become an unattended-farming or
  account-automation tool. Say where your permission boundary sits.
- **"Intelligent software": guide, don't script** — prefer policies, tools and
  learned data over fixed decision code; fixed logic needs a stated reason the
  model or harness cannot do it. You may argue against the principle head-on,
  but not ignore it.
- Latency matters (a live player shares the world with the body);
  determinism and debuggability matter (a misbehaving companion must be
  explainable from logs, and its learned data inspectable and resettable).
- One codebase, many games eventually: Stardew is the first game, not the
  product. The owner rules out per-game knowledge tables in code.
- Player data and credentials stay local by default; every network request a
  design makes must be documented (the wiki search goes through the DSH web
  seam to the DeepSeek search provider — say when and how often you search).

## Debate mechanics

- Each advocate writes `transcripts/advocate-<name>.md` (name: reflect,
  library, curriculum, actionrate, combo): **Claim** (one paragraph),
  **Mechanism** (how the loop actually works, concretely — what is detected,
  what is stored, what is retrieved when, where it lives), **How it fits the
  DSH seams** (which verified seams, what code/data lives where), **Best
  evidence** (with inline URLs), **Extensibility across games** (the judge's
  weighted criterion — address it directly), **Anticipated attacks and your
  answers**, **References**.
- Cite only URLs you actually fetched with WebFetch (search-result URLs you
  did not open do not count; the two notes-*.md files' citations may be reused
  as-is). Also write `transcripts/sources-advocate-<name>.json`: a JSON array
  of `{ "url": "...", "fetchedAt": "YYYY-MM-DD", "note": "one line" }` for
  every URL you fetched yourself.
- After the opening statements there are three cross-examination rounds: each
  round you attack at least two named rivals' concrete claims with evidence
  and answer the attacks made on you. Round 3 adds an honest closing position
  (what your option does NOT fix).
- Be a strong advocate — take a position and defend it — but never fabricate:
  every factual claim about a system, paper or number needs a fetched source
  or the bench/DSH facts files, or must be labeled speculation.
