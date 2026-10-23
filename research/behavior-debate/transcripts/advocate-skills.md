# Advocate: LLM-written code skills + a growing skill library

Approach 3 of the debate. Voyager-style: the model writes small, verifiable code skills against
the body-port helper API when it meets a new task, stores them on disk, and retrieves and composes
them on later goals. Claim, evidence, and mechanism below. Written 2026-10-24 on `behavior-research`.

## Claim

The behavior loop should be owned by **model-written code skills executed against the body-port
bindings, with a per-game, on-disk skill library as the companion's procedural memory** — run on
DeepSeek Harness's own PTC execution seam (`ctx.ptcRuntime` / `run_code`, shipped in
`@deepseek-ai/dsh-ptc-runtime` and `@deepseek-ai/dsh-tools`), not on any runtime we build. This is
the only architecture on the table that turns *behavior itself* into a per-game data asset: the
plugin ships one small, game-agnostic executor + retrieval + validation harness, and every game
after Stardew arrives as (its adapter, already game-specific by design) plus a growing folder of
skill files the model writes for itself. Voyager proved the loop end-to-end (3.3x more unique
items, tech-tree milestones up to 15.3x faster than prior SOTA, and a learned library that
transferred to a new world to solve novel tasks where baselines failed); CodeAct showed executable
code actions beat JSON/tool-call actions by up to 20% success across 17 LLMs; SkillWeaver (2025)
showed the same loop still pays in constrained, non-open-ended environments (31.8% relative gain on
WebArena) and that libraries transfer between agents. Against the repo's "guide, don't script"
principle I argue head-on: the skill library is not us scripting behavior — it is *frozen model
output*, authored by the model at need, inspectable and revocable as a file, exactly the
"harness-authored code with inspectable limits on who approves it and how it rolls back" that
`docs/operating-model.md` already names as an allowed constraint. We add no fixed decision logic;
DSH already owns the code-execution seam, so the plugin's fixed code stays roughly the size it is
today, and the behavior grows as data.

## Mechanism

The loop has two modes: **compose** (a reusable skill exists) and **author** (it does not). The
executor is DSH's PTC runtime: a program (an async function body) runs in a fresh managed Node
process against a fixed set of host-provided async bindings — nothing else is in scope, no state
survives between runs (local citation: `node_modules/@deepseek-ai/dsh-ptc-runtime/README.md`,
"Understand the implementation" and "Known Limitations"). Our bindings are the existing helper
surface over the body port: `observe()`, `find(kind|name)`, `walkTo(x, y, mode)`, `selectSlot(i)`,
`press(buttonId)`, `submitInput(steps, until)`, `wait(ms)`, plus `skills.call(name, args)` for
composition and `log(line)` for the correlated local log.

### Scenario A: "plant and water the parsnips" (compose path, steady state)

1. The player's words become a DSH goal (`create_goal`) — unchanged from today (seam 5).
2. On the goal round, the plugin injects a prompt section listing the skill index for this game:
   name, one-line description, inputs, postcondition (seam 2). Retrieval is local: exact-name
   match on the goal text plus description similarity (embedding or word overlap, Mindcraft's
   `skill_library.js` ships exactly this word-overlap fallback), plus always-show skills.
3. The model finds `farm.plantAndWater(crop, area)` in the index and emits one program:
   `return await skills.call("farm.plantAndWater", { crop: "parsnip", area: "the east plot" })`
   — or, first time after that skill exists but the goal differs slightly, a small composition
   loop it writes inline. One model round-trip; the program then runs to completion locally,
   looping tiles: `find` dry tilled dirt → `walkTo(adjacent)` → `selectSlot(hoe)` →
   `press("ControllerA")` → verify the tile flipped in `observe()` before moving on
   (the Voyager pattern: check environment state, not faith).
4. The program returns a structured value (tilled/planted/watered counts, stamina, where it
   stopped). The model narrates the result to the player; DSH logs the program, every sub-call
   (`<parent>:ptc:<n>` correlation ids), and the rendered result in the session log.

### Scenario A, first time ever (author path)

1. No matching skill. The model writes a *candidate skill*: a named function with a header
   (description, inputs, postcondition, e.g. `planted >= n && watered === planted`).
2. **Validation ladder**, cheapest first: (a) static — the sandbox `resolve()`s it (portable
   names, timeout, file policy; failures are structured `result.error`); (b) postcondition
   execution — run it once against the live body with the declared asserts as hard checks
   (Voyager's self-verification: "we ask it to act as a critic", plus environment feedback and
   execution errors in the iterative loop — voyager.minedojo.org); (c) model review of the run
   log for the narratable "did that go the way I meant" pass.
3. On pass: written to disk under the bridge —
   `<bridge>/skills/<game>/farm.plantAndWater.ts` plus an `index.json` entry (description,
   inputs, postcondition, provenance: goal text, session id, run count, review status `draft`).
   On fail: not persisted; the error and the program text stay in the session log and the local
   skill log, and the model retries within the same turn (this is the expensive turn — see
   Latency).
4. A `draft` skill is promoted to `trusted` after N clean runs (data in `index.json`), and any
   skill is revocable by deleting one file — the same deletion story as the memory ledger.

### Scenario B: "get to the ladder" (mine; monsters, low health)

1. Goal round: retrieved skills `nav.walkTo` (already exists as today's helper, now callable from
   programs), `combat.swingAt(monsterId)` (authored the first time a monster was met —
   postcondition "monster gone or 3 swings and my health unchanged"), and the always-show guard
   `safety.retreatWhen(healthBelow)` (postcondition "I am at the warp / I told the player").
2. The model writes the *tactic* for this goal — deliberately not stored, because it is
   goal-shaped, not reusable behavior: `while (!atLadder) { if (health < 35) retreat; else if
   (monsterWithin(3)) swingAt; else walkTo(ladder) }`. The body protocol's own `until` tripwires
   (`monsterWithin`, `blockedMs`, `warped` in `packages/contracts/src/body.ts`) are the reflex
   layer inside every `submitInput` — no new fixed logic, they are already contract.
3. First time in a fight, the author path runs *in place*: the candidate `swingAt` executes one
   real fight under the turn's cancellation, with its postcondition asserts; the player's request
   is the authorization, and `[resume]`/pause semantics hold the goal exactly as today.
4. Reuse: next mine trip is one model round-trip that composes `nav.walkTo` + `combat.swingAt`
   behind a fresh, goal-specific tactic program.

**What is code vs data**: executor bindings, retrieval, validation policy = code we ship (small,
game-agnostic). Skills, their index, review status = data under the bridge. Tactics = ephemeral
program text in the session log. Goals stay owned by DSH, never by skills.

## How it fits the DSH seams

- **Seam 6 (body port + helper libraries)** — the PTC bindings are precisely today's helper
  surface (`walk.ts`, `navigation.ts`, the tool bodies in `tools.ts`) exposed as async functions
  instead of model tools. Raw state/raw input semantics unchanged; the adapter still knows
  nothing.
- **Seam 7 (local files under the bridge)** — the library: `skills/<game>/*.ts`, `index.json`,
  and a correlated skill log. Plain files, player-inspectable, deletable per skill.
- **Seam 2 (prompt sections)** — the per-turn skill index (selected + always-show entries), the
  authoring policy (postconditions mandatory, no coordinates in narration, retry budget).
- **Seam 1 (tools)** — a thin `skill_run` tool (and/or `skill_list`/`skill_inspect` for the model
  and for us in tests) that resolves and runs a program via `ctx.ptcRuntime` with our bindings.
- **Seam 5 (DSH goals)** — unchanged and load-bearing: goals still drive rounds; a skill never
  spawns its own turn; pause/cancel semantics are the turn's.
- **Seam 3/4 (turn-flow hooks, setup callback)** — `agent/pre-step` injects the retrieved index;
  setup loads/validates the index and registers bindings.
- **Honest runtime statement**: each program run *is* a separate managed Node process — but it is
  DSH's own (`dsh-ptc-runtime-node` backend, "a fresh managed Node process under the resolved
  sandbox policy"), not a runtime this repo owns, builds, or upgrades; the plugin only consumes
  the registered `ctx.ptcRuntime` service. No second harness, no daemon, no state between runs
  (a stated limitation of the seam — which suits us: reconstructability from session logs). Two
  honest caveats: (1) `docs/architecture.md` says the mod's profile patch today *disables* coding
  tools (shell, file system, subagents) — that stays true; our surface is bindings-only PTC with
  a resolved file policy limited to the skills directory, which is a different, narrower thing
  than re-enabling shell, but it is a deliberate policy change the owner must sign off (L2 gate).
  (2) Whether the acp profile composes `ctx.ptcRuntime` by default is a deployment fact to
  verify; if absent, registering the shipped backend in the plugin's patch overlay is
  configuration, or an upstream requirement to record — not a fork.

## Best evidence

- **Voyager (Wang et al., 2023, arXiv:2305.16291)** — first LLM lifelong-learning embodied agent;
  3.3x more unique items, 2.3x longer distances, tech-tree milestones up to 15.3x faster than
  prior SOTA; skills stored as executable code, "each skill is indexed by the embedding of its
  description," retrieved top-5, verified by environment feedback + execution errors + a GPT-4
  self-verification critic; library transferred to a new world to solve novel tasks.
  https://arxiv.org/abs/2305.16291, https://voyager.minedojo.org/, https://github.com/MineDojo/Voyager
- **CodeAct (Wang et al., ICML 2024, arXiv:2402.01030)** — executable code actions vs JSON/text
  actions: up to 20% higher success across 17 LLMs; multi-turn interpreter interaction enables
  self-debug and revision. The single strongest general result that code is the better *action
  surface*, independent of games. https://arxiv.org/abs/2402.01030
- **Code as Policies (Liang et al., Google, 2022, arXiv:2209.07753)** — code-writing LLMs
  re-compose API calls into new policy code with loops, feedback, and numeric grounding on real
  robots; hierarchical code generation by "recursively defining undefined functions" is the
  composition trick our skills reuse. https://arxiv.org/abs/2209.07753
- **SkillWeaver (Zheng et al., 2025, arXiv:2504.07079)** — the paradigm generalized beyond
  Minecraft: agents that synthesize reusable skills as APIs gain 31.8% (WebArena) and 39.8%
  (real websites) relative success, and synthesized skills transfer to weaker agents (up to
  54.3%). Directly rebuts "libraries only pay off at Voyager scale." https://arxiv.org/abs/2504.07079
- **Mindcraft (github.com/mindcraft-bots/mindcraft)** — the closest shipped relative: a coder
  module writes JS executed in-game behind `allow_insecure_coding` ("This project allows an LLM
  to write/execute code on your computer. The code is sandboxed, but still vulnerable to
  injection attacks"), a hand-written `library/skills.js`, and `skill_library.js` as in-memory
  embedding/word-overlap retrieval over the *first two lines* of each skill doc with always-show
  defaults — a working reference for our index design, and a warning we take seriously (their
  README's own security caution). https://github.com/mindcraft-bots/mindcraft
- **Orak (Park et al., 2025, arXiv:2506.03610)** — a 12-game, MCP-based benchmark that ships
  expert LLM gameplay-trajectory fine-tuning data: evidence both that game-agent contracts are
  converging on our shape (MCP/protocol bodies + code actions) and that skill traces are the
  distillation substrate. Community corroboration: the Andy model family (down to 360M
  parameters, Apache-2.0) plays Minecraft locally through Mindcraft-style commands after
  fine-tuning on ~12k prompt traces. https://arxiv.org/abs/2506.03610,
  https://huggingface.co/Sweaterdog/Andy-3.5

## Extensibility across games

The judge's top criterion, so plainly: in every rival architecture except this one, *behavior
logic is code or weights the product ships*. Hand-written BTs are per-game source; LLM-authored
BTs-as-data still ship a per-game node vocabulary and interpreter; planners ship per-game action
schemas; RL ships per-game policies. In the skill-library architecture, the shipped code is a
**game-agnostic triple**: PTC bindings over a body declaration (the declaration is *already*
self-describing — buttons with plain-word descriptions and roles, limits, legend, per-kind
`extra` payloads in `packages/contracts/src/body.ts`), a retrieval/validation harness, and an
empty `skills/<game>/` directory. Game 2's adapter is unavoidable game-specific work that every
architecture pays identically; after that, the *only* per-game artifact our architecture adds is
a folder of skill files the model fills in by playing — Voyager's library transferring to a new
world and SkillWeaver's cross-agent transfer are the measured versions of this claim. Mindcraft
shows the same shape holding up in a second large game (a different engine, different API), and
Orak shows 12 games behind one protocol interface with code-style actions. What is universal:
the runtime seam (DSH's, not ours), bindings names, validation ladder, index format, permission
and logging story. What is per-game: skill files only — data, inspectable, deletable, never a
release. Porting cost target for the bench's `toy2`: zero changed runtime lines, one new
bindings adapter the toy's port already forces, empty skills dir.

## Latency, trust, and debuggability

- **Latency.** First authoring is the slow turn (iterative loop, retries) — and it happens once
  per capability, ideally while the player is watching the new thing being learned. Steady state
  is the win: one model round-trip selects/composes, then the program runs locally to completion,
  driving the body continuously between round-trips instead of paying a model call per
  observe/walk/press. Pure tool calling pays that per-call tax on every leg of every goal
  forever; this is the architecture's core latency argument, backed by CodeAct's result that
  code actions reduce multi-turn flailing (up to 20% higher success across 17 LLMs). [speculation]
  Per-run process spawn cost (fresh Node process per PTC run) is real but small relative to a
  model round-trip; the seam's no-persistent-REPL limitation means long tactics are one program,
  not a session.
- **Trust and the permission boundary.** Inspection sits at four layers: (1) the program text is
  in DSH's session log with per-sub-call correlation ids (`<parent>:ptc:<n>`) and rendered
  results — a misbehaving evening is replayable from the log alone; (2) every persisted skill is
  a plain file under the bridge with provenance and review status, revocable by deletion, like
  the ledger; (3) the execution surface is bindings-only — a program can move *this* body, read
   *this* world, and write skill files, and nothing else (no shell, no network, no saves: cheat
  inputs still gated by the adapter's cheat switch, `cheat: true` flags honored below us); (4)
  first execution of a new skill can ride the existing ACP permission request ("allow once"),
  which is today's authorization point. Honest limits, stated: DSH's sandbox is a *deployment
  file-policy mode*, not a proven security boundary (the runtime's own README: language and
  isolation descriptors "do not themselves promise a security boundary"; no container backend is
  supplied) — which is why the binding surface stays minimal and Mindcraft's README warning
  ("sandboxed, but still vulnerable to injection attacks") is why game text is treated as data
  in skill prompts, per the repo's untrusted-input rule.
- **Debuggability.** Failures are structured (`result.error` kinds: exception/timeout/abort/
  worker-exit/invalid-output/...), surfaced as errors — never a local player-visible fallback
  (repo rule) — and correlated: goal id → program run id → sub-call ids → body task ids →
  adapter events. A bad run answers "which line of which skill" from the log; a bad skill is one
  file with a failed postcondition, not a debugger session in product code.

## A minimal prototype on the sim

- Host a **skill runtime** in `bench/`: loads `skills/<scenario>/*.ts`, exposes bindings
  `{observe, find, map, walkTo, selectSlot, press, submitInput, wait, log}` over the imported
  `SimAdapter` (unmodified), and enforces postconditions. Runs programs in a child Node process
  with `node:vm` or worker isolation as the bench stand-in for PTC (documented as such).
- **Farm scenario**: LLM (real call, else recorded stub, marked) authors
  `farm.plantAndWater` once; then N goal rounds retrieve and execute it. Compare against the
  baseline's raw-tool loop: expect ~1-2 model calls per task vs many, and low idle ratio since
  the body moves throughout the program.
- **Mine scenario**: author `combat.swingAt` and `safety.retreatWhen` on the wrapper-extended
  sim (monsters die to a swing; low health), then run "get to the ladder" as a fresh tactic
  program composing them; count stuck/recovery events per run.
- **Reuse check**: replay "water the parsnips" next-day phrasing; assert the stored skill is
  selected (index hit) with zero new authoring.
- **Porting check**: point the same runtime at `bench/toy2/` with a different bindings adapter;
  the runtime and validation ladder must change zero lines; count and report what does change.
- Fixed logic in the prototype = bindings + harness only; every behavior line is model-authored
  and file-logged.

## Anticipated attacks and your answers

1. **"Generated code bugs are catastrophic compared to data trees / curated BTs."** A buggy
   hand-written BT ships in product code and needs a release to fix; a buggy skill is caught by
   its declared postcondition on its first run, never persisted (or quarantined as `draft`),
   deletable as one file, and its blast radius per run is bounded by the bindings (one body,
   one world, a timeout, no state between runs). Voyager's loop explicitly treats execution
   errors as fuel for the next iteration; CodeAct's interpreter loop shows models self-debug
   exactly this way. A data tree that is wrong ships silently; a skill that is wrong fails loudly
   against its own contract.
2. **"Retrieval rarely fires in a small game like Stardew; the library is dead weight."** The
   library does not need Voyager scale to pay: it needs to amortize the *authoring* round-trips
   of repeated multi-step behaviors (water every day, fight every mine trip, shop every restock)
   and to make behavior portable as data. SkillWeaver's 31.8-39.8% gains are in bounded
   environments with tens of skills, not open-ended ones. And the index cost at small scale is
   trivially cheap — Mindcraft embeds only the first two lines of each skill doc with a
   word-overlap fallback and keeps always-show defaults; at Stardew scale the whole index can sit
   in the prompt section verbatim.
3. **"Sandbox escape / trust: the model's code is driving a body in my save."** The surface is
   bindings-only in a fresh process per run under a resolved file policy, with cheat inputs still
   refused by the adapter below us; every program and sub-call is in DSH's own session log; new
   skills are one-file revocable and can require allow-once on first run. Stated honestly: DSH's
   Node sandbox is a file-policy mode, not a hard boundary (no container backend), and Mindcraft
   warns injection remains possible — so treat game-derived text as untrusted data inside skill
   prompts, keep the binding set minimal, and record a container backend as a possible upstream
   requirement rather than pretending the wall is higher than it is.
4. **"Skills are dead weight when the model already has tool calling."** Tool calling is the
   degenerate one-line skill; `both` presentation mode keeps native tools available. What the
   library adds is the difference between narrating every step and handing over a procedure:
   fewer round-trips per goal (latency the player can see), postcondition-verified retries
   handled in-program instead of re-prompted, and CodeAct's up-to-20% success delta as the
   general evidence that code actions beat call-by-call actions. The pure-tool-call baseline
   never gets cheaper with practice; this one converts its best day-one routines into one call.
5. **"Voyager had a rich mineflayer API; our body port is raw buttons — the model can't write
   code against that."** It writes code against *bindings*, not buttons: the same A*-navigation
   and controller helpers the plugin already ships as `body_walk_to` today, re-exposed as
   functions. Voyager's agents likewise called a host-provided `skills.*` API, not pixels; Code
   as Policies built on host-provided perception and control primitives. The raw port stays
   raw; the binding layer is seam 6's "whatever helper libraries the plugin ships", and it is
   the same layer every rival architecture must build to say anything to the body at all.
6. **"This violates 'guide, don't script' — a saved skill is a script."** The operating model's
   allowed-constraints bullet already names "inspectable limits on harness-authored code (who
   approves it, how it rolls back, network and save access)" — model-written, inspectable,
   revocable code is inside the stated envelope, and the model (not we) authors every line,
   re-decides every use, and can inline-edit or refuse a skill the situation outgrew. What we
   would ship as fixed code is exactly what the principle wants: guidance (the authoring
   policy), hands (bindings), and memory discipline (the library), with the navigation helper
   already carrying its stated reason (the harness cannot pathfind). If the principle is read to
   ban frozen model output, it bans the memory ledger too.

## References

- https://arxiv.org/abs/2305.16291 — Voyager paper (numbers, skill-library abstract).
- https://voyager.minedojo.org/ — Voyager project page (skill library mechanics: embedding-indexed descriptions, top-5 retrieval, self-verification critic).
- https://github.com/MineDojo/Voyager — Voyager repo (skill_library/ on disk, decompose-then-execute usage).
- https://arxiv.org/abs/2402.01030 — CodeAct, ICML 2024 (code actions up to 20% higher success across 17 LLMs; self-debug).
- https://arxiv.org/abs/2209.07753 — Code as Policies (LLM-written policy code, hierarchical generation, real robots).
- https://arxiv.org/abs/2504.07079 — SkillWeaver 2025 (skill APIs: +31.8% WebArena, +39.8% real websites, strong-to-weak transfer +54.3%).
- https://github.com/mindcraft-bots/mindcraft — Mindcraft (coder/modes/hand-written library; security caution).
- https://github.com/mindcraft-bots/mindcraft/tree/main/src/agent — coder.js, modes.js, library/ layout.
- https://github.com/mindcraft-bots/mindcraft/tree/main/src/agent/library — skills.js + skill_library.js.
- https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/library/skill_library.js — in-memory embedding/word-overlap doc retrieval, always-show skills.
- https://github.com/mindcraft-bots/mindcraft/blob/main/FAQ.md — Mindcraft ops notes (pathfinder patches, stuck behavior).
- https://arxiv.org/abs/2506.03610 — Orak benchmark (12 games, MCP interface, expert-trajectory fine-tuning data).
- https://huggingface.co/Sweaterdog/Andy-3.5 — Andy local model family (12k-prompt Minecraft trace dataset; 360M-7B local play).
- Local (repo) citations: `node_modules/@deepseek-ai/dsh-ptc-runtime/README.md` and `package.json`
  (ctx.ptcRuntime semantics, one-shot fresh-process runs, sandbox caveats);
  `node_modules/@deepseek-ai/dsh-tools/README.md` (`mode: ptc|both`, `run_code`, 120s/600s
  budgets, `<parent>:ptc:<n>` logging, sandbox_permissions approval);
  `research/behavior-debate/BRIEF.md` (7 seams, constraints); `docs/architecture.md` (patch
  disables coding tools; allow-once permission); `docs/operating-model.md` (design principle,
  allowed constraints incl. harness-authored code); `packages/contracts/src/body.ts` (until
  tripwires, cheat flags); `packages/dsh-companion-plugin/src/body/tools.ts` and
  `sim-adapter.ts` (current helper surface; sim for the bench).
