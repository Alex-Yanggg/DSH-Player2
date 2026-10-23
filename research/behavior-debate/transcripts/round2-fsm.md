# Cross-examination round 2 — advocate-fsm

## Answers

**"Auditability isn't unique" (llm-bt, modes, skills, utility).** Load-time validation is cheap — for *syntax*. Every rival's own evidence shows semantics is the gap: BTGenBot's static pass still left execution at 7/9; one-shot LLM trees 12/17 (both verified by my fetches, round 1). A stored skill or session-edited table is auditable *per goal* — the player's permission surface is re-authored by the model at runtime, and "reading is the inspection" (skills) means reading a fresh 60-node artifact per goal. My pack is read once, in CI, with tests, before any player exists. Same form; different evidential standard.

**"A tree never states a course of action" (goap).** The reverse: my mine tree read top-down *is* the course — retreat if hurt, fight if cornered, else walk to the ladder. Their own `plans/<goalId>.json` is the same statement produced per goal; mine is pre-reviewed, theirs post-hoc. Orkin's NOLF2 story indicts per-goal FSMs, not trees — Halo 3 shipped BTs *under* declarative objectives, and Nav2 embeds planners *inside* BT nodes where search pays. A planner can be a leaf in my tree; it cannot be the trust boundary.

**"ForEachTile is a plan without guarantees; BTs must grow very large" (goap).** The survey's blowup warning targets trees that unroll instances as nodes; mine don't — small fixed routines over blackboard lists, the same cure planners apply. The "sequencing knowledge" in leaves is per-leaf unit-testable, unlike domain operators, which encode the identical `press A to plant` knowledge with more machinery.

**"Guessed thresholds, tactically blind, re-tuned per game forever" (rl).** Thresholds in my design are *data* — a braver companion or faster monster is a one-line diff, versus their own price list: 9 GPU-days per task (DreamerV3), 720 GPUs for VPT's RL phase. PUBG Ally shipped co-op combat reflexes as an authored behavior tree at tick rate with no training (https://developer.nvidia.com/blog/how-krafton-built-pubg-ally-a-co-playable-character-powered-by-nvidia-ace — fetched: "A System 1 layer, implemented as a behavior tree, handles… movement, aiming, and immediate combat responses at game tick rate"; "Reflex-level actions never have to wait for the model"). Authored ≠ guessed; it means reviewed.

**"The effect set is decided at runtime" (utility).** True of every architecture, including theirs: candidates come from live objects each tick and "sort themselves by score" (their own cite). What a permission card can promise is the fixed action vocabulary plus guards — which I enumerate — while parameters (plot, thresholds) are what the preview shows and pause/cancel revokes.

**"PORTAL favors our authorship; day-one gap" (llm-bt).** PORTAL trains tiny neural nodes inside its trees — not pure LLM authorship — and its dual-feedback loop is generation infrastructure, not evidence a chat model emits product-grade trees per goal. The day-one gap is conceded: my fallback *is* their architecture, run as fallback, not the product.

**"Adapter ≠ leaf-pack equivalence" (skills).** Partly fair; but my leaves are the same `walkTo/selectSlot/press` primitives skills, modes, and goap ship as bindings, macros, and operators. And "no leaf pack transfers anywhere" cuts at them too: their own round-1 attack on modes shows the skill library's predicates break on `toy2` as well.

## Attacks

**On advocate-goap:** Round-1 claim: "all game specificity is data." Their opening's "Fixed 1 — Grounding" is a shipped extractor deciding which `extra` fields become predicates — `health_low(true)`, `monster_within(3)` are per-game semantic choices in fixed code, exactly the authoring they bill to me, minus CI. Utility flagged the contradiction; I price it.

**On advocate-rl:** Their attack demands competence evidence against "one game's monsters" — but their training substrate *is* this repo's sim, where monsters die to one swing; a policy trained there overfits toy physics and proves nothing about Stardew [speculation until their bench shows otherwise]. Their standing answer — "trained from the same BodyDeclaration they read" — confirms the per-game loop they deny me, at GPU prices their own citations set.

**On advocate-utility:** Their audit attack lands double on them: with behaviors sorted per tick by score and no authored priority order, the permission card can enumerate only *action families* — never which one the argmax picks — and every curve parameter is re-authored per goal by the LLM, the "guessed threshold" indictment they joined against me, minus the fixed order a player could read.
