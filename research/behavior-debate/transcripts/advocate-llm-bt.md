# Advocate: behavior trees as DATA, authored and edited by the LLM (advocate-llm-bt)

## Claim

The loop from "plant and water the parsnips" to button presses should be owned by **a behavior tree that the LLM writes as data** and **a small, fixed, game-agnostic interpreter** that ticks that tree against the body port. The LLM reads the goal, the body declaration (inputs, legend, limits) and the raw state, and emits a JSON tree from a tiny closed node vocabulary (`seq`, `fallback`, `retry`, `timeout`, `act`, `cond`); the interpreter executes it every tick, reacts to monsters/blocks/health without any model call, and on failure returns a structured node-level trace that the LLM uses to *edit the tree* — not to start over. This is the only candidate that gives the model 100% of the "how" (the tree IS the model's authored behavior; the repo ships no behavior at all, which is the strongest possible reading of "guide, don't script"), while giving the player 100% of the inspectability (the tree is a static, diffable, revocable artifact). The pattern is not speculative: LLM-authored trees in DSL/JSON/XML form, parsed and run by a fixed engine, are now the dominant published pattern for exactly this problem — in robots (Cao & Lee 2023; LLM-BT 2024; LLM-as-BT-Planner 2024; BTGenBot 2024), in a Microsoft VLM system (2025), in construction machinery on real excavators (2026), and in commercial-scale *games*: PORTAL runs LLM-generated behavior-tree policies across "thousands of first-person shooter (FPS) games" and reports the policies are "instantaneously deployable, human-interpretable" — the two properties this co-op product needs most. For the judge's criterion: the interpreter and node grammar are fixed forever; every game difference lives in data (the body declaration and the tree the LLM writes), which is the maximum extensibility-per-line-of-code any architecture in this debate can offer while staying one DSH plugin.

A verification note before anything else, because this brief asked me to check: **the "PORTAL paper (Park et al., LLM + robot API with behavior trees)" as described does not exist.** I searched the arXiv API for papers titled "PORTAL" (869 title matches; none about LLMs, robots, or BTs) and for BT papers by Park/Nagarajan/Troniak (zero results), and the arXiv id one citation trail gave for "Robot task planning with large language models via behavior tree generation" (2310.06796) is actually an exoplanet-atmospheres paper. The real PORTAL is **"Agents Play Thousands of 3D Video Games," Xu et al., arXiv:2503.13356 (2025)** — a games system, and an even better fit for this debate than the phantom robot paper. The closest real "Park et al."-style robot work is the verified line below (Cao & Lee 2023 onward). Everything I cite below was fetched.

## Mechanism

The fixed pieces (shipped once, game-agnostic):

- **Node vocabulary** (the whole language, deliberately closed):
  - composites: `seq` (reactive: re-evaluates earlier children's conditions each tick), `fallback` (priority selector), `par` (parallel, all/any semantics)
  - decorators: `retry{n}`, `timeout{ms}`, `invert`
  - action leaves: `act` — calls the plugin's existing helper layer: `walkTo{x,y,location,mode}` (today's A* navigation helper, `body_walk_to`), `input{steps,until}` (raw `body_input`: `{hold,press,ms}` steps with `arrive/blocked/monsterWithin/warped` stop conditions), `wait{ms}`, `say{text}` (companion speech)
  - condition leaves: `cond` — one fixed query grammar over the raw state: `{path, op, value}` where `path` addresses anything the body protocol already exports (tiles via legend, `objects[].kind`/`extra`, `characters[].kind`/`health`, toolbar, stamina, the body's own tile/facing). Examples: `body.health < 25`, `objects[x=4,y=6].extra.watered == true`, `nearest(kind="monster").dist <= 3`.
- **The interpreter** (one small TypeScript module in the plugin, sibling of `navigation.ts`): tick = evaluate tree top-down; an `act` leaf in flight is a body task whose `until` map directly onto the tree's guarding conditions (so "monster within 3" both interrupts the walk at the adapter level and makes the guarding condition fail, flipping control to the next `fallback` branch). Leaves return SUCCESS / FAILURE / RUNNING; RUNNING persists across ticks. It enforces static safety at load time: reject unknown node types, unknown leaf calls, undeclared input ids, and any input flagged `cheat` (the adapter refuses those too — belt and braces). On root FAILURE or retry-budget exhaustion it stops and emits a **trace**: the failing node's path in the tree, the condition values at that moment, and the body events log. Trees and traces persist as JSON files under the bridge directory.

The loop, step by step, for **"plant and water the parsnips"**:

1. The player's words become a DSH goal (unchanged from today — seam 5 owns goal state). On the goal round, the model gets: the goal, the tree-authoring guide (a prompt section), the body declaration (`body_controls` vocabulary + legend + limits), and `world_observe` output.
2. The model calls one tool, `behavior_run`, with the tree as JSON. That is the ONLY model call needed for the whole chore.
3. The interpreter validates (schema + declared inputs + no cheats), writes the tree file, and starts ticking. For a 2x2 plot the tree looks like this (real shape, trimmed):

```json
{ "goal": "plant and water the parsnips",
  "root": { "node": "seq", "children": [
    { "node": "retry", "n": 2, "child": { "node": "seq", "children": [
        { "node": "act", "call": "walkTo", "args": { "x": 4, "y": 6, "mode": "adjacent" } },
        { "node": "act", "call": "input", "args": { "steps": [
            { "press": ["Slot1"], "ms": 100 },
            { "hold": ["DPadDown"], "ms": 150 },
            { "press": ["ControllerX"], "ms": 120 } ] } },
        { "node": "cond", "check": { "path": "objects[4,6].kind", "op": "==", "value": "dirt" } } ] } },
    { "node": "act", "call": "input", "args": { "steps": [
        { "press": ["Slot2"], "ms": 100 }, { "press": ["ControllerA"], "ms": 120 } ],
        "until": { "blockedMs": 400 } } },
    { "node": "act", "call": "walkTo", "args": { "x": 5, "y": 6, "mode": "adjacent" } },
    { "node": "act", "call": "input", "args": { "steps": [
        { "press": ["Slot3"], "ms": 100 }, { "press": ["ControllerX"], "ms": 120 } ] } },
    { "node": "cond", "check": { "path": "objects[5,6].extra.watered", "op": "==", "value": true } }
  ] } }
```

4. A failed `cond` (e.g. the game didn't accept the seed because the body faced the wrong way) fails its `seq`, the `retry` re-runs it (the walk re-faces via `adjacent` mode — reactive re-execution, no model involved). If the retry budget dies, `behavior_run` returns the trace; the next goal round's prompt (seam 3 hook) carries it, and the model emits an *edited* tree (typically a one-line fix — face before press). The tree file diff is the audit record.

For **"get to the ladder"** (mine scenario: hostile monsters, low health) the same grammar expresses a reactive survival policy with zero model calls while it runs:

```json
{ "goal": "reach the ladder",
  "root": { "node": "seq", "children": [
    { "node": "fallback", "children": [
      { "node": "seq", "children": [
          { "node": "cond", "check": { "path": "nearest(kind='monster')", "op": "absent" } },
          { "node": "cond", "check": { "path": "body.health", "op": ">", "value": 25 } },
          { "node": "act", "call": "walkTo", "args": { "x": 12, "y": 3, "mode": "stand" },
            "until": { "monsterWithin": 3, "blockedMs": 800 } } ] },
      { "node": "seq", "children": [                      // monster close: swing (monsters die to one swing)
          { "node": "act", "call": "walkTo", "args": { "target": "nearest(kind='monster')", "mode": "adjacent" } },
          { "node": "act", "call": "input", "args": { "steps": [
              { "press": ["Slot4"], "ms": 100 }, { "press": ["ControllerX"], "ms": 120 } ] } } ] },
      { "node": "seq", "children": [                      // health low: leave, don't die
          { "node": "cond", "check": { "path": "body.health", "op": "<=", "value": 25 } },
          { "node": "act", "call": "walkTo", "args": { "warp": "Farm", "mode": "stand" } } ] }
    ] },
    { "node": "cond", "check": { "path": "body.location", "op": "==", "value": "next level" } }
  ] } }
```

Each tick the reactive `seq` re-checks "no monster" and "health > 25"; the walk leaf's `until: monsterWithin` makes the *adapter* interrupt the held buttons mid-stride, and the very same tick the fallback flips to the combat or retreat branch. This is exactly what a live co-op world needs and exactly what a model round-trip cannot do: sub-second reaction with a clear, printable explanation ("switched to retreat: health 24 <= 25").

## How it fits the DSH seams

Every seam used, nothing outside them:

1. **Tools (seam 1).** One new `defineTool`: `behavior_run(tree)` — validates, ticks, returns the terminal status plus trace. It stays open while the tree runs, so DSH's turn cancellation kills the tree and the body task with it (same contract as today's long `body_walk_to` call). Optionally `behavior_trees()` lists saved trees. All existing tools remain — the model can still observe and hand-steer.
2. **System-prompt sections (seam 2).** A static "tree authoring guide": the node vocabulary, the `cond` path grammar against the body protocol's exported fields, two worked examples (the two above), and the editing convention (a failure trace means "edit this node," not "rewrite the goal"). This is thinking guidance, not behavior.
3. **Turn-flow hooks (seam 3).** `agent/pre-step` on a goal round attaches the active tree's last trace (if any) so the model re-authors or confirms; a player's new chat message that changes the goal simply results in a new tree — the old one is cancelled with the turn. `[day-end]`/dream are untouched.
4. **Setup callback (seam 4).** Registers the interpreter library and loads persisted tree/trace files from the bridge directory.
5. **DSH goals (seam 5).** Unchanged and decisive: DSH still owns goal creation, queueing, cancellation and pause. The tree is the *execution plan of one goal*, never a goal store. Cancel/pause the goal -> cancel/pause the turn -> the `behavior_run` tool call aborts -> body task cancelled. A paused game holds the goal and the tree, exactly as the product requires.
6. **Body port + helper libraries (seam 6).** The interpreter is a helper library in the same tier as `navigation.ts`/`walk.ts`: it composes `state()`, `run()` (with `until`), and `walkTo`. Nothing in it knows Stardew: it reads only the body protocol types in `packages/contracts/src/body.ts`.
7. **Local files (seam 7).** `<bridge>/behavior/trees/<goal>.json` (each version kept) and `traces/<n>.jsonl`. The memory ledger already established this pattern.

**Honest process answer:** no separate process, no side runtime, no second harness. The interpreter is in-plugin library code executing under an open tool call — architecturally identical to the existing walk helper, just with a data-driven control flow instead of a fixed one. The only long-running thing between model turns is the tool call DSH already knows how to cancel. The one thing this proposal *adds* to the repo is a fixed interpreter module; its size is an engineering estimate, not a measurement [speculation: ~300-500 lines + tests], and it shrinks every other candidate's burden (no per-behavior code, no per-game adapter semantics).

## Best evidence

- **PORTAL — "Agents Play Thousands of 3D Video Games," Xu et al., arXiv:2503.13356 (2025)** (https://arxiv.org/abs/2503.13356, project page https://zhongwen.one/projects/portal). The closest existing system to this debate: LLMs generate "behavior trees represented in domain-specific language (DSL)", one fixed parser runs them in-game, dual feedback (game metrics + VLM analysis) edits policies; validated "across thousands of first-person shooter (FPS) games" with policies "instantaneously deployable, human-interpretable" — the extensibility-across-games and inspectability claims, published, at commercial-game scale.
- **LLM-BT — Zhou et al., arXiv:2404.05134 (2024)** (https://arxiv.org/html/2404.05134v1). ChatGPT reasons the task, a parser builds the tree, and an Expand/Insert algorithm repairs the *tree in place* on failed conditions — "The success rate of Cargo sorting was about 85%" and household service "about 75%" over 5 cases x 20 users each: adaptation without full re-planning is measured, not asserted.
- **LLM-as-BT-Planner — Ao et al. (TUM/MIRMI), arXiv:2409.10444 (2024/v3 2025)** (https://arxiv.org/html/2409.10444). Four in-context methods for LLM->BT with GPT-4 on a real Franka Panda: one-step 12/17, human-in-the-loop feedback 16/17 success — and the cost data that kills the "just emit more calls" defense: iterative regeneration scored the same 12/17 while burning 7,770 tokens vs 5,075, and the recursive variant cost 50,230 tokens for 13/17. Structured feedback beats more sampling.
- **BTGenBot — Izzo, Bardaro, Matteucci (PoliMi), arXiv:2403.12761 (2024)** (https://arxiv.org/html/2403.12761v1). Even <=7B models emit valid XML trees for BehaviorTree.CPP when given one-shot examples (syntactic correctness up to 100% base one-shot; execution passing 7/9 tasks with static-analysis cleanup). Errors are format-level and statically fixable — validation is a solved, cheap step, and the trees run on an off-the-shelf fixed engine.
- **LLM-Based BT Generation for Construction Machinery — Tsutsumi et al. (Kyushu Univ.), arXiv:2602.01041 (2026)** (https://arxiv.org/html/2602.01041v1). The pattern in its third domain, current-frontier models: GPT-5 produced XML BTs that succeeded on 4/4 scenarios and coordinated a real ZX200 excavator and dump truck; small open models failed exactly at the synchronization-heavy scenarios. Same fixed interpreter (BehaviorTree.CPP), new domain, zero engine changes.
- **The substrate itself** — Iovino et al., "A Survey of Behavior Trees in Robotics and AI," arXiv:2005.05842 (https://ar5iv.labs.arxiv.org/html/2005.05842: "reactivity, together with modularity, is often listed as some of the main advantages"; "BTs have been successfully used as a policy representation for both learning and planning approaches"); BehaviorTree.CPP docs (https://www.behaviortree.dev/docs/intro: "Trees are created at run-time, using an interpreted language (based on XML)" plus built-in record/replay of state transitions); Chris Simpson's game-AI standard reference (https://www.gamedeveloper.com/programming/behavior-trees-for-ai-how-they-work: selectors make "failure ... no longer a critical full stop" and trees are authored as data). BT-as-data is the mature, tooled middle layer of both robotics and game AI; my proposal makes the LLM its author.

(VLM-driven BT, Wake et al., Microsoft, arXiv:2501.03968 (https://arxiv.org/html/2501.03968v2), belongs in the same stack: GPT-4o emits JSON trees (10/10 valid generation, 8/10 end-to-end), edited conversationally by full regeneration — evidence that "edit the tree on failure/feedback" works, and that JSON is a fine wire format for it.)

## Extensibility across games

The judge's top criterion, addressed head-on. Split the system into what is fixed and what is per-game:

- **Fixed forever (shipped once, in the plugin):** the interpreter, the node vocabulary, the `cond` path grammar, the trace format, the file layout. None of it references Stardew, tiles, tools or monsters; it references the body protocol types (`BodyState`, `BodyTask`, `BodyUntil`), which are already the game-agnostic contract.
- **Per-game, all of it DATA:** the body declaration (inputs, legend, limits — already per-game today by design), and the tree the LLM writes. Porting to a new game means the model reads that game's declaration and writes different trees. For the debate's own toy2 porting test (keys instead of tiles/tools), the expected diff is: new trees + possibly one new `act` leaf if that game lacks a grid for `walkTo` — the interpreter, grammar, guide section and tool do not change. That is the smallest porting cost in this debate by construction, because behavior is not ported at all; it is re-authored by the model from the new game's own declaration. [The one-honest-caveat: `walkTo` presumes an exported tile grid; a game without one needs its own navigation helper — but that helper layer is per-game in every architecture including today's baseline, so it is not a cost of this proposal relative to the alternatives.]
- **Published proof of the split:** PORTAL's whole result is this split — one fixed DSL/JSON parser, thousands of FPS games; the construction-machinery paper moved domains by changing the action vocabulary and BT content, not the engine; BTGenBot's trees run on BehaviorTree.CPP, a fixed interpreter used unchanged across robotics and games. In every verified system in this literature, "new domain" equals "new data," not "new runtime."
- **And it compounds:** trees are content. A library of the model's own corrected trees per game (seam 7 files) becomes few-shot material for the next goal and the next game — the same lever PORTAL pulls with policy iteration and Cao & Lee pull with source-tree retrieval (their BT-embedding search picks the closest known tree as the prompt source: ar5iv 2302.12927).

## Latency, trust, and debuggability

- **Latency.** One model call per goal (plus one per failed re-author), instead of a call per observe/walk/press round trip. While the tree runs, reaction time is the interpreter tick — milliseconds, not round trips; the mine tree above survives a monster appearing mid-stride with zero model involvement, using the adapter's own `monsterWithin` interruption. The papers quantify the alternative: LLM-as-BT-Planner's iterative variant adds tokens and wall time for no success gain; PORTAL explicitly avoids per-step model inference in favor of deployable trees. Idle-ratio (the bench metric) should be near the walk-helper floor: the body is only idle while the model authors once at goal intake.
- **Trust and the permission boundary.** The tree is the strongest permission object in this debate. Before or during execution the plugin can render, in player words, exactly what the tree may do: which areas, which tools, which retreat conditions — a closed, statically-checkable effect set (only body-port inputs; no shell, no files, no network; cheat-flagged inputs rejected at validation *and* by the adapter). "Only through explicit, inspectable, player-revocable permissions" maps one-to-one onto: inspect the tree JSON, revoke by cancelling the goal (DSH's cancellation chain already reaches the body task). Compare: an LLM-written code skill is inspectable only by reading code and is arbitrary in effect; a reflex layer's policy is invisible inside the plugin; per-step tool calls are inspectable only after the fact, one transcript line at a time.
- **Debuggability.** A misbehaving companion is explained by artifacts: the tree file (what it intended), the trace file (which node returned FAILURE/RUNNING at each tick with the condition values), and the diff between tree versions (what the model changed and why). BehaviorTree.CPP ships exactly this as record/replay state-transition logs; the construction paper's blackboard conditions debug the same way. "Why did you run away?" has a one-line answer: `health 24 <= 25 at node root.fallback[2].cond`. No other candidate produces a compact causal object per goal.

## A minimal prototype on the sim

Against `packages/dsh-companion-plugin/src/body/sim-adapter.ts` (imported, not modified):

- **Fixed side (the claim under test):** a small `bt-interpreter.ts` in `bench/` implementing the node vocabulary above over the `BodyPort` interface — `walkTo` (reusing the plugin's `walk.ts` logic), `input`, `wait`, `say`, and the `{path,op,value}` cond grammar with `nearest(...)` helpers; zod-style validation; a JSON trace writer.
- **Model side:** for the bench, a recorded/scripted "model stub" that emits the two trees above (declared as a stub, per TASK.md); optionally swap in a real GLM call that receives goal + declaration + observe and must emit the tree JSON.
- **Farm scenario:** fixed seed; 2x2 plot, hoe/seeds/can in toolbar; success = 4 tiles tilled, planted, `watered == true`. Count LLM calls (expect 1 + re-authors), wall clock, idle ratio, stuck/recovery events (e.g. wrong facing -> retry re-faces).
- **Mine scenario:** a bench wrapper around the sim (not an edit) spawns monsters between body and ladder, sets low health; success = on the ladder tile without dying; measure preemptions handled in-tree (monster interruptions that never reached the model).
- **Fault-injection runs:** kill a `cond` path, give a wrong input id, reference an undeclared slot — assert the interpreter rejects statically (mirrors BTGenBot's static-analysis finding).
- **Porting check (toy2):** point the same interpreter at the second toy game; only the stub's trees (and, if needed, one leaf) change. Count the diff lines — that number is this advocate's extensibility evidence.

## Anticipated attacks and your answers

1. **"An LLM that can emit a correct BT can just emit tool calls."** Emitting is not the bottleneck — *reacting* is. Tool calls execute once and blind; between two round trips nothing watches for a monster or a blocked path. The tree re-evaluates its guards every tick and survives the whole farm chore or mine run on ONE call. The measured counterpoint: LLM-as-BT-Planner's iterative tool-call-style regeneration scored 12/17 — identical to one-shot — while costing 7,770 vs 5,075 tokens, and the recursive variant burned 50,230 tokens for 13/17; only structured human/trace feedback (16/17) moved the number. PORTAL made the same choice at game scale: generate a tree, deploy it, don't sample per step.
2. **"A tree schema is a poor man's programming language."** It is a *bounded* language, and that is the point, not a weakness: no unbounded loops (retry has a budget), no arbitrary effects (leaves are the body port and only the body port), fully static-checkable (unknown nodes/inputs/cheats rejected at load — the sim already fails unknown inputs, and BTGenBot shows static cleanup turning generated trees executable). Code-skills advocates get generality; I get a closed effect set you can put on a permission screen. And the tooling is not poor at all: games and robots have authored trees as data for a decade (Simpson's JBT editors, BehaviorTree.CPP's XML + Groot, py_trees) — I am reusing an established, tooled format, not inventing a DSL in the dark.
3. **"The interpreter is hidden fixed logic; the repo principle says guide, don't script."** The principle (docs/operating-model.md) permits fixed logic "with a stated reason why the model or the harness cannot do it" — stated reason: a live co-op world needs sub-second reaction to monsters, blocks and health, and a model round trip is seconds; the body protocol's own `until` conditions exist precisely because someone must tick. And the interpreter scripts *nothing*: it contains zero decisions about how any goal is done — every priority, guard and fallback is the model's own authored data. In this architecture the repo ships strictly less behavior than today's baseline (which ships fixed navigation and reflex helpers and no structured way for the model to own a plan). "Guide, don't script" is satisfied most purely here: the guidance is a prompt section; the behavior is the model's artifact.
4. **"Failure recovery needs re-authoring anyway, so you gained nothing."** Gained twice. First, most failures never reach the model: LLM-BT's in-tree Expand/Insert recovered external disturbances to 85%/75% success without re-planning, and reactive fallbacks (my mine tree) handle the entire class of "world changed mid-action." Second, when re-authoring is needed, it is *surgical*: the trace names the failing node and the condition values, so the model edits one branch — versus the baseline's only recovery mode, re-reading a transcript and guessing. The VLM-BT paper shows conversational tree regeneration converges with a user in the loop (10/10 valid generation); the tree makes that loop cheap enough to run without one.
5. **"LLMs emit malformed trees; you'll spend your life validating."** Validation is static, cheap and proven: BTGenBot's <=7B models hit 86-100% syntactic correctness with one-shot prompting and a static-analysis pass; VLM-BT's GPT-4o was 10/10 on valid JSON tree generation; a zod schema plus the body declaration makes our check deterministic. Malformed trees are rejected before a single button press — a failure mode strictly safer than a malformed tool-call sequence, which executes partially before anyone notices.
6. **"Model-level game agents (SIMA/VLA/miHoYo) will make trees obsolete."** Those are trained per-domain policies, not plugin architectures: no permission surface, no DSH seams, no explanation of a wrong move, and (for SIMA-class agents) specialized per-game-family training. The day one is exposed as a callable service, it slots in as an `act` leaf inside this very grammar — the tree stays the trust and orchestration layer. Trees and learned policies compose (the Iovino survey documents BTs as the standard wrapper policy representation around learned components; PORTAL's trees contain neural nodes). This architecture is the on-ramp, not the roadblock.

## References

All URLs below were fetched on 2026-10-24.

- https://arxiv.org/abs/2503.13356 — PORTAL paper (Xu et al. 2025): LLM-generated BT policies in DSL across thousands of FPS games; "instantaneously deployable, human-interpretable".
- https://zhongwen.one/projects/portal — PORTAL project page: DSL/JSON policies "parsed to run the corresponding behavior tree in the game"; hybrid rule/neural nodes; dual feedback.
- https://arxiv.org/html/2404.05134v1 — LLM-BT (Zhou et al. 2024): ChatGPT->BT with in-tree Expand/Insert adaptation; 85% cargo / 75% household success; code at github.com/henryhaotian/LLM-BT.
- https://arxiv.org/html/2409.10444 — LLM-as-BT-Planner (Ao et al. 2024/2025): four ICL methods; GPT-4 16/17 human-in-the-loop; token costs per method.
- https://arxiv.org/html/2403.12761v1 — BTGenBot (Izzo et al. 2024): <=7B LLMs emit BehaviorTree.CPP XML; one-shot + static analysis results.
- https://arxiv.org/html/2501.03968v2 — VLM-driven BT (Wake et al., Microsoft, 2025): GPT-4o JSON->BT, conversational regeneration editing, 10/10 valid, 8/10 end-to-end.
- https://arxiv.org/html/2602.01041v1 — Construction machinery BT generation (Tsutsumi et al. 2026): GPT-5 XML BTs 4/4 scenarios; real excavator+dump truck coordination on BehaviorTree.CPP.
- https://arxiv.org/abs/2302.12927 — Cao & Lee 2023 abstract: Phase-Step prompt BT generation, the founding paper of the LLM->BT line.
- https://ar5iv.labs.arxiv.org/html/2302.12927 — Cao & Lee full text: Phase-Step format, BT-embedding source-tree retrieval, ablation tables (structure ratios, part-mating counts, davinci-003/ChatGPT).
- https://ar5iv.labs.arxiv.org/html/2005.05842 — Iovino et al. BT survey: modularity/reactivity vs FSM, BTs as policy representation for learning and planning.
- https://www.behaviortree.dev/docs/intro — BehaviorTree.CPP: trees as interpreted XML at run-time; record/replay/analyze state transitions.
- https://www.gamedeveloper.com/programming/behavior-trees-for-ai-how-they-work — Simpson (Game Developer, 2014): BT practice in game AI; data-driven authoring; fallbacks make failure non-fatal.
- Verification fetches (negative results, quoted in Claim): https://arxiv.org/abs/2310.06796 (unrelated astrophysics paper — disproves the garbled citation), http://export.arxiv.org/api/query?search_query=ti:%22PORTAL%22&start=0&max_results=30 (no PORTAL LLM/BT paper exists among 869 title matches), http://export.arxiv.org/api/query?search_query=all:%22behavior%20tree%22%20AND%20au:Park (no Park-author LLM-BT paper on arXiv).
