# Cross-examination round 1 — attacks

Assembled from the ten advocates' round-1 contributions (round1-<name>.md).
Each advocate attacks at least two rivals' concrete claims and sharpens the answers
to the attacks they anticipated in their openings. Rounds 2 and 3 add answers and new attacks.


---

<!-- from round1-fsm.md -->

## advocate-fsm

# Cross-examination round 1 — advocate-fsm

## Attack on advocate-llm-bt

Claim: LLM-authored trees are "instantaneously deployable, human-interpretable" — maximum extensibility per line. Look at their own evidence, verified: LLM-BT achieves "about 85%" (cargo) and "about 75%" (household) success *with a random disturbance added and 20 humans in the loop per case* (https://arxiv.org/html/2404.05134v1); LLM-as-BT-Planner scores 12/17 one-shot and reaches 16/17 only "Human-in-the-loop," while iterative regeneration buys zero success for 7,770 vs 5,075 tokens (https://arxiv.org/html/2409.10444). The mechanism that carries these systems to product-grade reliability is a human — which our product has only as a player watching a live farm in real time. Worse, their validation is *syntactic*: it rejects unknown nodes, inputs, cheats — nothing checks that the JSON actually waters parsnips until the first live run, so every goal is an experiment in the player's shared world; a hand-written pack's semantics are verified in CI and on the sim before it ever ships. And when the tree fails, recovery is a re-author model call — the body stands idle through a round trip precisely in the mine scenario the tree exists to survive.

## Attack on advocate-llm (baseline)

Claim: "my per-game fixed-logic count is zero and cannot go lower." Zero per-game logic is purchased with per-surprise model calls forever: their own math puts a 500-token decision point at "over 15 seconds," and PORTAL's authors — pro-LLM, and fetched by me — report LLM-agent gameplay durations "extending to seven hours per match" and call inference latency "impractical for real-time applications" (https://arxiv.org/html/2503.13356v1). Their permission story is also the weakest in the field by their own framing: the action set is whatever the model composes next turn, so the enumerable-actions promise a trust product wants ("it will only ever press these buttons") is structurally unavailable. Their determinism attack ("worthless if its semantics must be rewritten per game") misprices my port — engine and node taxonomy carry; only leaf bindings and tree data change — and undervalues the property: DSH logs *record* model decisions, they cannot *replay* them; a tick log can.

## Attack on advocate-skills

Their transcript concedes both facts that disqualify the approach for this product: DSH's sandbox descriptors "do not themselves promise a security boundary," and Mindcraft's own README warns the coder is "still vulnerable to injection attacks." Model-authored code would run beside a live save on an execution surface whose vendor documents the injection risk, in a repo whose rules treat game text as untrusted input. They also concede the acp profile patch *disables* coding tools today — an owner-gated L2 policy reversal before it boots at all. Voyager and CodeAct's gains are real, but measured in sandboxes where a buggy skill costs a reset, not the player's co-op farm.

## Attack on advocate-modes

They open by conceding the thesis: "In engine terms it is a BT with exactly two node types… we accept the subset relation." A two-node BT whose table the LLM edits at runtime inherits advocate-llm-bt's verification gap (nothing checks table semantics before a live run) while discarding the sequencing farm chores need — their own walkthrough hand-rolls till→plant→water *passes* in `steps` data, i.e. a sequence, hidden in JSON.

## Standing answers

- **"Guide, don't script":** five rivals (modes, hybrid, utility, goap, rl) independently stated the same reason I did — model round trips cannot meet tick-rate reaction, and the baseline itself admits >15 s decision points. The principle's bar ("a stated reason the model or harness cannot do it") is met by consensus, not dodged.
- **Authoring cost:** llm-bt prices its interpreter at ~300–500 lines [speculation, their own estimate]; modes concedes a first-game predicate-library cost; my engine is the same order, and my leaves are the *same* bindings every rival needs (walkTo, selectSlot, press). The delta is tree data files — reviewed once, diffable forever.
- **Open-ended goals:** llm-bt's whole mechanism proves authoring happens somewhere per goal; the real question is who verifies it. Engineer + CI + sim before shipping (mine) versus model + live run after dispatch (theirs).
- **"Scripted botting":** every data-artifact rival makes the permission surface a JSON the model rewrites per goal; mine is a fixed enumerable artifact, machine-checkable for cheat inputs before the first button press. Verifiable is trustable.


---

<!-- from round1-llm-bt.md -->

## advocate-llm-bt

# Cross-examination round 1 — advocate-llm-bt

## Attack on advocate-llm

The baseline says idle "concentrates at decision points, which is where a co-op partner hesitating reads as *thinking*, not broken." Run it on the mine scenario: from the sim's declared limits (`walkPxPerTick: 4`, `tilePx: 64`, ~60 Hz → ~0.27 s/tile) a monster 3 tiles out arrives in under a second, while their own latency source prices a 500-token turn at >15 s. That is not "thinking," it is the failure the brief names. Their patch — `until.monsterWithin` at tick rate — only stops the walk; what to do *next* still waits on a round trip, every surprise, forever. My tree pre-authors the fight/flee/retreat ladder before the monster exists. Measured (LLM-as-BT-Planner, https://arxiv.org/html/2409.10444): one-shot generation 12/17 at 5,075 tokens; iterative regeneration — their "call the model again" — flat at 12/17 for 7,770 tokens; only structured feedback reached 16/17. More sampling loses; structure wins. Second claim: "every such artifact is per-game fixed logic that must be re-authored... for each new game." False for my tree: per-*goal* model output, written from the same declaration the baseline reads — zero product lines per game.

## Attack on advocate-fsm

They cite PORTAL and conclude "the runtime architecture both camps needs is mine; the dispute is only who authors the trees." But PORTAL's trees are LLM-generated policies refined by dual feedback (https://arxiv.org/abs/2503.13356) — evidence for *my* side of that dispute, as is the verified line (Cao & Lee, LLM-BT, BTGenBot, the 2026 construction system): the model authors the tree. Their shipped-game canon (Halo, Spore) predates LLMs and paid a studio team per title — the per-game bill ("roughly 10–20 leaf implementations plus tree data files," their words) the judge weights against. And "static auditability... no rival can offer" is wrong: my tree is the same static, load-time-checked JSON (unknown nodes/inputs/cheat flags rejected; BTGenBot's static-analysis pass is the analogue, https://arxiv.org/html/2403.12761v1) — and it covers a novel goal on day one with no pack, the gap they concede ("a fixed tree cannot invent behavior").

## Attack on advocate-modes

Where does their chore actually live? "the selector executes `field_work`'s macro: for each tile in the plot... `press: [Slot2]` (hoe)... pass 2 swaps seeds and presses `ControllerA`; pass 3 swaps the can." That macro — the till/plant/water order, the slots, the passes — is per-game decision code wearing a data hat; only the trigger table is JSON. On the judge's axis that is the hand-written-BT bill with a smaller grammar. My tree expresses that entire per-tile routine as model-authored data (`seq`/`retry` over `walkTo`/`input` leaves) on a game-blind interpreter. Their jab — LLM-BT pays "per-session re-generation plus an execution engine anyway" — the engine is the same few hundred lines their selector is; the difference is where the chore lives: their code, my data.

## Attack on advocate-goap

"a BT is executable control flow, not a declarative model; nothing checks it against reality before it runs" — overstated twice. My closed grammar is statically validated like their domain schema (node vocabulary, declared inputs, cheat flags), and "checked against reality" is what execution feedback does: LLM-BT repairs failed conditions in-tree to 85%/75% success (https://arxiv.org/html/2404.05134v1); LLM-as-BT-Planner validates trees by simulator run. Their A* proves precondition chaining, not that `press ControllerA` plants a seed — operator reality is verified by running it, the same test my leaves take.

## Standing answers

- **"An LLM that can emit a tree can emit tool calls" (llm):** emitting is not reacting — see 12/17-flat-iterative vs 16/17-structured above, and PORTAL's reason for deployable trees over per-step inference.
- **"Code beats JSON" (skills, CodeAct +20%):** that is about action surfaces in web tasks; ours already exists. Their own transcript concedes the code seam is disabled today and re-enabling it is an L2 owner gate — my JSON tree needs no host code execution at all.
- **"Hidden fixed logic violates guide-don't-script" (fsm/modes/goap):** every accuser ships more fixed decision code than I do — leaf packs, macro libraries, domains, grounding. My interpreter contains zero decisions; the model authors every branch.
- **"Validation won't catch semantic errors" (hybrid):** bounded by the closed effect set (body-port inputs only), adapter `until` tripwires, and trace→edit recovery (85%/75% in-tree). A wrong-but-valid tree wastes one goal round; it cannot escape the body port.


---

<!-- from round1-skills.md -->

## advocate-skills

# Round 1 — advocate-skills: attacks and standing answers

## Attack on advocate-fsm

Claim quoted: "Extensibility across games... is a real but bounded per-game cost (a leaf-node pack plus tree data files)" — "roughly 10–20 leaf implementations" per game, "the same class of work as the per-game SMAPI adapter." Wrong equivalence: the adapter is unavoidable game I/O every architecture pays identically; the leaf pack is optional decision-code only yours pays. Each pack is reviewed, released code — game #2 starts with an engineering backlog, and their own "graceful degradation" concedes the alternative is the slow baseline on everything the pack lacks: per-leg model latency *forever* on novelty. A skill library pays novelty *once per capability, as data the model writes* — Voyager's library transferred to a new world where baselines failed (arxiv.org/abs/2305.16291); no leaf pack transfers anywhere. And the audit absolutism ("every possible input press... enumerated before the companion ever moves") is not unique: a stored skill is exactly such a static artifact — enumerable inputs, declared postcondition, revocable file.

## Attack on advocate-llm-bt

Claim quoted: this "gives the model 100% of the 'how'" with "maximum extensibility-per-line-of-code." The "how" is capped by their closed grammar: their own farm tree hard-codes `{x: 4, y: 6}` per tile. Loops over *found* tiles, parameterized plots, computed recovery logic — the actual farm work — need either a grammar extension (fixed code change) or a freshly generated tree per goal variant: per-goal code generation in a hobbled language. The action-representation question is measured: executable code beat JSON/text-style actions by up to 20% across 17 LLMs (arxiv.org/abs/2402.01030), and Code as Policies attributes code's power precisely to loops, libraries, and hierarchical function definition (arxiv.org/abs/2209.07753) — all absent from a tree JSON. Their compounding claim ("a library of the model's own corrected trees... becomes few-shot material") is my skill library without storage, retrieval, or validation; and their flagship PORTAL regenerates policies per game via a dual-feedback loop, with no persistent library or reuse mechanism in the abstract (arxiv.org/abs/2503.13356) — iteration, not accumulation.

## Attack on advocate-modes

Claim quoted: "LLM-as-author is safe exactly where LLM-as-executor is not," with extensibility = "author one JSON file in the adapter's declared vocabulary." Their own existence proof refutes the sufficiency half: Mindcraft ships `modes.js` *and* `coder.js` — when the hand-written library and mode table can't cover a situation, the LLM writes JavaScript, lint-checked, skill-name-checked, interrupt-guarded, executed in a restricted compartment (github.com/mindcraft-bots/mindcraft/blob/main/src/agent/coder.js; README: "This project allows an LLM to write/execute code on your computer"). The shipped system keeps a code-skill escape hatch because bounded predicate tables cannot absorb novelty. Also, "one JSON file" hides fixed predicate/macro code — `monsterWithinTiles` is not universal; their own porting test (`toy2`, keys, no tiles) breaks the predicate library, which is product code.

## Attack on advocate-llm

Claim quoted: "an LLM-written skill library needs a verification harness per game." False as stated: my validation ladder checks postconditions against body-protocol state (object `extra` flags, inventory diffs, arrival reasons) — all game-agnostic; the harness ships once, and only the skill files are per-game data. Their per-leg round-trip loop pays their own quoted 15-second turns on every repeated chore, every day; a stored skill deletes that cost from the steady state (one call to compose, then local execution).

## Standing answers

- **"Unauditable code vs. a closed artifact" (fsm, llm-bt).** A saved skill is static, enumerable, and diffable like a tree; unlike a tree it carries a machine-checkable postcondition. First execution is the audit; DSH logs every sub-call. "Inspectable only by reading code" — yes: reading is the inspection, the same reading a 60-node JSON tree needs.
- **Latency (modes, fsm: ~0.8 s monster vs model seconds).** Stored skills execute with *zero* model calls inside; `until` tripwires arm in every `submitInput`, same as everyone's. Authoring latency is paid once, amortized by reuse (SkillWeaver: +31.8% from small libraries, arxiv.org/abs/2504.07079).
- **"Unsandboxed model code" (hybrid).** Not Mindcraft's host eval: DSH's own PTC seam — fresh managed process, resolved file policy, bindings-only, per-sub-call session logging (node_modules/@deepseek-ai/dsh-ptc-runtime/README.md). The gate already exists.
- **Model-level agents' 4–23.7 s/step frontier numbers** indict the per-step LLM loop, not skills; a future policy chunk can even become one more binding a skill composes.


---

<!-- from round1-modes.md -->

## advocate-modes

# Round 1 — advocate-modes: attacks and standing answers

## Attack on advocate-fsm

Claim: "the executable is a statically auditable artifact whose every possible input press … can be enumerated before the companion ever moves — a property no rival can offer at any price," and per game this costs "roughly 10–20 leaf implementations plus data files." Both halves are overstated. Auditability is not unique: a declarative mode table over the closed declaration vocabulary, validated at load (unknown input id or predicate = named load error), gives the same static enumeration while staying editable in session — his pack changes only through code review and a release, so the player's "stop fighting, just run" becomes an engineering ticket; in my design it is one validated `modes_set` call. And his own mine tree is my mode table wearing branch scaffolding: `HealthBelow → Retreat`, `MonsterWithin → Swing`, walk-to-ladder, explore — the same four reactive competences Mindcraft ships as data behind one fixed `ModeController` (fetched: `modes.js`). On the judge's criterion, "10–20 leaf implementations" of product code per game, forever, is precisely the porting cost being priced; my per-game artifact is one JSON file the model itself can draft and the engine validates.

## Attack on advocate-llm

Claim: "Danger does not wait for the model … The reactive guarantee is tick-rate, not model-rate." The adapter tier *stops*; it does not *act*. His own next step concedes it: on interrupt "the model re-decides with one round trip" — a frozen body mid-corridor while the monster keeps moving. Sim math (repo constants): a monster closes at 4 px/tick × 60 Hz ÷ 64 px = 3.75 tiles/s. His own latency source gives 200–500 ms TTFT and 10–50 ms/token, and a 300 ms/30 ms turn "still takes over 15 seconds" at 500 output tokens (fetched: ClickHouse). A 2–15 s decision window lets the monster cross 7–56 tiles: stopping is not surviving, and this is the mine scenario the brief names. His "a reflex table that moves instantly moves wrong in novel situations" has shipped counterexamples in this very debate: PUBG Ally's authored tick-rate reflex layer and DPT-Agent's FSM system 1 are the two systems that made real-time co-op work; neither reports reflex failure — both report boundary design as the work. Novelty escalates in my design: unhandled states surface via the digest; the model judges while the table holds the seconds.

## Attack on advocate-rl

Claim: "a hand-tuned engage/retreat threshold is exactly the fixed logic that fails out-of-distribution … whereas a damage-avoidance-trained policy adapted during training." That comparative claim carries no fetched evidence and is [speculation] by the debate's own rules; the fetched counterexample is PUBG Ally, a shipped commercial co-op title whose reactive tier is an authored behavior tree at game tick rate under the SLM. The economics are worse: his own citations price DreamerV3 at 9 GPU-days for one task and VPT's RL phase at 720 GPUs for 9 days — per-game training is the maximal porting cost on the exact criterion the judge weights, and his rescue (a foundation "body prior" fine-tuned per game) he himself labels gated speculation. Add his own concession — "you cannot ask a policy 'why'" — against a product requirement that every acting thing be player-readable and revocable: a mode entry is a line of data a player can inspect and delete; a checkpoint can only be swapped.

## Standing answers

- **"Anemic BT" (fsm, hybrid):** conceded as a subset; the case rests on the split and on data-not-code per game. The fsm advocate's Halo 3 layering (declarative objectives above BTs) is my system 1/system 2 split with authored code where I put validated data.
- **"LLM hand-holding" (llm):** Mindcraft's auto-message and PUBG Ally show one digest per interrupt, not per step; hand-holding pressure marks a table gap, fixed by a data edit, not by re-entering the tool-call loop.
- **"Predicates per game are the real cost" (goap, fsm):** game one pays the combinator library once; each later game authors bindings over the declaration, not predicate code — the goap advocate's grounding extractor needs the same mapping plus a domain file, so his floor is above mine, not below.
- **"Reflexes fight the model" (hybrid):** priority data, the auto-message escalation, and per-tick permission rechecks are my mechanism; the hybrid advocate's validator is my seam-4 load check. His proposal is my architecture (same tiers, same evidence) plus a skill library whose exceptional `.code.ts` path re-imports per-game code review exactly where trust cost is highest.

New URL fetched this round: https://clickhouse.com/resources/engineering/llm-inference-latency (TTFT/token figures used against the baseline).


---

<!-- from round1-utility.md -->

## advocate-utility

# Cross-examination round 1 — advocate-utility

## Attack on advocate-fsm

Claim: "a property no rival can offer at any price: the executable is a statically auditable artifact whose every possible input press, stop condition, and permission check can be enumerated before the companion ever moves." Overstated twice for this product. First, the audit covers only the leaf vocabulary — the model still dispatches `body_run_behavior("farm.plant_water", { near: "player" })` and `SelectPlot` fills a blackboard from a live snapshot, so the *effect set* (which tiles, how far, in whose direction) is decided at run time and is not statically enumerable. Second, closed-vocabulary audit belongs to any declaration-validated data layer: my `behavior_policy` tool rejects considerations referencing undeclared fields — the same "unknown input is a load error" guarantee. What trees uniquely ship is *authored priority order*: their mine tree hard-codes retreat-above-fight-above-walk, so a braver companion is a tree edit. Utility behaviors "sort themselves by score"; a new behavior declares why it is useful, not where it sits among the branches (https://en.wikipedia.org/wiki/Utility_system). Their per-game bill — "roughly 10–20 leaf implementations plus tree data files" — is the shipped-code cost the judge weights: The Sims scaled to thousands of content items because objects arrived as advertising data, not tree nodes (https://gmtk.substack.com/p/the-genius-ai-behind-the-sims).

## Attack on advocate-llm-bt

Claim: "every game difference lives in data (the body declaration and the tree the LLM writes), which is the maximum extensibility-per-line-of-code any architecture in this debate can offer." The tree is a snapshot program: their farm example embeds coordinates and full choreography (`walkTo {x:4,y:6}`, per-tile press sequences) for one world moment; a moving world — the player tills a tile, a monster shifts — sits outside the guarded `cond`s and costs a re-author. Their own evidence prices that authoring: LLM-as-BT-Planner's iterative regeneration scored flat (12/17) while burning 7,770 vs 5,075 tokens (https://arxiv.org/html/2409.10444). A policy document declares *why* each action is valuable (curves over declared fields); the argmax re-derives order from live state every tick, so one small artifact survives a changing world. And on trust: a tree with embedded step choreography is a control-flow program to read; named weights over five universal action families is a shorter permission card.

## Attack on advocate-model

Claim: "the plugin's per-game surface shrinks to a key-binding declaration (which our body protocol already requires)." Not in this repo: the adapter is a *structured-state* exporter, and their own mechanism section admits "[speculation] the SMAPI adapter would need to capture the seat's instance" — pixel capture and framing are per-game adapter engineering their accounting omits. Add the conceded vLLM GPU server (a side runtime, installed outside the repo) and "uninspectable weights, inspectable contract": for a product whose brief demands misbehavior explainable from logs, a 200 ms opaque chunk answers *what was pressed*, never *why*. Utility consumes the declaration's structured fields — legend, objects, `extra`, characters — with no renderer, no GPU, and a score dump per decision.

## Standing answers

- **"Hand-tuned thresholds fail out of distribution" (rl, #6 — aimed at me):** my thresholds are not constants in code; they are curve parameters in per-goal JSON the LLM authors — and LLM-authored numeric objectives with feedback beat human experts on 83% of 29 tasks (Eureka, https://arxiv.org/abs/2310.12931); the score dump is the feedback loop. rl's own flagship evidence prices the alternative: diamonds only "from scratch without human data" after fleet-scale training, per its transcript's full-text accounting (https://arxiv.org/abs/2301.04104).
- **"No notion of a plan; parsnips need sequencing" (goap, fsm):** goap concedes the exact property I use — "GOAP only ever plans for unsatisfied goal literals, so donated progress is absorbed for free"; my 0/1 precondition gates give the same without his per-game grounding extractor ("Fixed 1"), which quietly contradicts his "all game specificity is data."
- **"Zero per-game behavior code" (llm):** true until a monster moves: their own answer #4 sends every surprise through a model round trip the brief calls visible; the field survey requires "fast action and hybrid architectures" under the LLM in real-time games (https://arxiv.org/html/2404.02039v5).
- **"A mode table is just an anemic behavior tree" (modes, own words):** agreed — crisp predicates (`healthBelowPct: 35`) plus hand-set priorities and `stopWhen` hysteresis are authored branch order with patches; continuous curves re-sorted per tick replace both mechanisms.


---

<!-- from round1-goap.md -->

## advocate-goap

# Cross-examination round 1 — advocate-goap

## Attack on advocate-llm

Their claim: "gains come from the model, not from a behavior layer" — the model owns "every decision." That is the job the literature says models cannot hold: multi-step action synthesis over exact state. Their own citations concede it (14.41% WebArena, ~35% BALROG); my fetched sources measure the fix: LLM+P exists because LLMs "cannot reliably solve long-horizon planning problems" while the same model plus a classical planner returns correct/optimal plans (https://arxiv.org/abs/2304.11477); environment-feedback domain refinement reaches 66% vs 29% GPT-4 chain-of-thought (https://arxiv.org/abs/2407.12979). Their latency number ("over 15 seconds" a turn) is paid at every decision point; plan-then-execute pays one round-trip per goal and replans in-process at millisecond cost. Their trust claim — "the model's reasoning trace plus tool I/O" — is an after-the-fact transcript; a permission boundary wants intent *before* the body moves, which a plan artifact is and a chat trace is not. Their porting attack ("a GOAP/HTN domain needs actions, effects, and preconditions per mechanic") ignores that domains are authored once per game under validation — GPT-4 modeled 40+ PDDL actions, validator-corrected once, then solved 48 tasks unaided (https://arxiv.org/abs/2305.14909).

## Attack on advocate-fsm

Their claim: "every possible input press, stop condition, and permission check can be enumerated before the companion ever moves," at a per-game cost of "roughly 10–20 leaf implementations." Enumerating *inputs* is not auditing *intent*: what the player revokes is a goal's course of action, and a tree never states one. On extensibility this is NOLF2 economics, and the industry fled it: Orkin documents Monolith's per-goal embedded state machines becoming "overly complex, bloated, unmanageable," fixed in F.E.A.R. by decoupling goals from actions so behavior is added as data — the late-development drones, or one `TurnOnLights` action instead of editing every goal (https://www.gamedevs.org/uploads/three-states-plan-ai-of-fear.pdf). Their own survey concedes BTs "must be very large to perform tasks that involve many objects and subtasks"; `ForEachTile`+blackboard moves the sequencing into leaf code — a plan without a planner's guarantees, hand-authored per game instead of searched per goal from data.

## Attack on advocate-llm-bt

Their claim: the model gets "100% of the 'how'" with "maximum extensibility-per-line-of-code." A tree is control flow with no action semantics: their interpreter rejects "unknown nodes/inputs" — *syntax* — while nothing checks the tree against the world before it runs. Their own numbers show the gap: one-shot 12/17 (71%), only human-in-the-loop reached 16/17 — and every goal re-pays authoring, per game, forever. A domain is machine-checkable semantics — preconditions and effects verified by search, corrected once (Guan, Mahdavi, fetched above) — then reused by every goal. Goal translation to predicates is a smaller, verifiable LLM surface than whole-tree authoring — LLM+P's demonstrated division.

## Attack on advocate-modes

Their farm loop — "for each tile in the plot… pass 2 swaps seeds… pass 3 swaps the can" — is a hand-written plan inside a macro; the priority table merely gates it. The ordering knowledge lives in per-game leaf code, where mine lives in searchable, validated data — plus Orkin's replanning-with-failure-facts (blocked door → kick → window) when the plot is blocked or the can runs dry.

## Attack on advocate-utility

"Sequencing emerges from state preconditions under the same scorer" is GOAP's precondition chaining *without search*: a per-tick argmax with hysteresis is greedy one-step lookahead. It cannot order `refill-can` before watering 15 tiles when water is off-screen, except by hand-tuning more curves — a planner's effects as numbers nobody can diff. SayCan, their own citation, pairs scoring with grounded affordances rather than trusting argmax.

## Standing answers

- **"Domains are where the difficulty went":** every rival needs identical grounding (conds, macros, leaves, policies read the same legend); only the planner makes it a validated, diffable artifact with a sound checker (Guan, Mahdavi, LLM-Modulo — fetched).
- **"Replanning storms":** replans trigger on violated preconditions of remaining steps, with MTR-priority hysteresis — the documented fix for aborting still-valid plans, the bug reactive layers re-introduce (Humphreys, fetched); `until` guards cancel input with zero model calls.
- **"HTN = BT in a trench coat":** a tree cannot simulate effects or backtrack; Humphreys states it — unlike behavior trees, HTN planners "reason about the effects of possible actions."
- **"Guide, don't script":** the stated reason now has the rivals' own numbers (14.41%, ~35%, 29%); search is the one subtask with a 50-year exact solution, and the model keeps goals, words, costs, and domains.


---

<!-- from round1-rl.md -->

## advocate-rl

# Round 1 — advocate-rl (attacks and standing answers)

## Attack on advocate-fsm

Their claim: a hand-authored tree offers "a property no rival can offer at any price: the executable is a statically auditable artifact," and their mine branch is "EquipWeapon → FaceMonster → Swing (ControllerX) → BackOff." Auditability of *intent* is real; it says nothing about *competence*. That combat branch encodes exactly one tactic — face, swing, back off — and its thresholds (`HealthBelow(t)`, `MonsterWithin(k)`) are numbers someone guessed for one game's monsters. The repo's own design principle warns against fixed decision code; a tree that decides when to fight is decision code, kinetically auditable and tactically blind. Learned policies exist because this tier resisted twenty years of authoring: VPT's RL-fine-tuned agent reached >80% iron-pickaxe reliability — human-level (57%) — on precisely the dexterous, adversarial sequencing that authored branches approximate (https://ar5iv.labs.arxiv.org/html/2206.11795). And the fsm advocate's porting story ("~10–20 leaves per game") counts only happy-path leaves; every monster speed, weapon range, and knockback change is re-tuned guessing, per game, forever — the cost they hand-wave as "the same economics every studio pays." We are not a studio per title; we are one plugin for many games.

## Attack on advocate-llm-bt

Two concessions in their own transcript sink the pure-data-tree claim. First, defending against obsolescence, they write that "PORTAL's trees contain neural nodes" — their flagship thousands-of-games evidence stays deployable *because learned components do the acting inside the authored scaffold*. That is my architecture with the authorship burden moved into the model. Second, their mine tree's combat branch carries the comment "// monster close: swing (monsters die to one swing)" — the tree's demonstrated survival competence is an artifact of the sim's one-hit-kill rule. Change monster speed or HP and the tree does not degrade; it simply fails, and the fix is another authoring round-trip. Reactivity (`until: monsterWithin` flipping a fallback branch) is not dexterity: it stops the walk and picks the next *authored* branch. A trained fight-or-retreat policy is the only candidate whose dodge timing was earned from consequences rather than written from imagination (DreamerV3's diamond-from-sparse-reward is the same point at horizon scale: https://arxiv.org/html/2301.04104).

## Attack on advocate-modes

Their table is thresholds all the way down: `danger_flee` fires at `"healthBelowPct": 35`, `cornered_fight` "swings the weapon." Every one of those numbers is per-game folklore of exactly the kind the utility advocate is attacked with — except without curves, buckets, or logged arithmetic to tune it. Where do the thresholds come from on game two? An author re-guesses. Mine come from a reward signal (−damage, +arrival) which adapts the behavior, not the documentation, to a new monster. And their claim that "a trained policy is invisible inside the plugin" is false in my design: every (obs, action) pair lands in a jsonl trace, replayable against a checkpoint hash — more machine-checkable evidence than a mode log's winner annotations.

## Attack on advocate-llm

Their defense — "Danger does not wait for the model. `until.monsterWithin` is evaluated by the adapter per tick" — conflates stopping with responding. `until` halts the walk; then the body stands armed-nothing beside an attacking monster for their own quoted worst case of >15 s of model turn time (https://clickhouse.com/resources/engineering/llm-inference-latency, per their citation). An interrupt that hands control to a seconds-long round trip is a pause button, not a reflex. Mine returns control to a policy that keeps moving.

## Standing answers

- **"Uninspectable 60 Hz acting."** Rivals inspect *intent* (trees, tables, plans) and stay silent on *competence* — a readable tree that dies in the mine explains nothing. I log every obs/action pair; determinism is against the artifact. All rivals already ship unauditable numeric internals: A*.
- **"Per-game training = zero extensibility."** Rivals' per-game data is hand-derived decision content that also rots per balance patch; my artifact is trained from the same `BodyDeclaration` they read, and VPT showed priors fine-tune across contexts (213× crafting tables) — compute is my cost, honesty paid in my opening.
- **"Reward hacking."** The skills advocate and I converged: postconditions verified in game state, errors surfaced, never faked; Eureka-grade reward authoring happens at dev time (https://arxiv.org/abs/2310.12931), inside the small-horizon scope where CoastRunners-class failure cannot hide (https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity).
- **"Sample inefficiency."** Every rival's bench prototype runs a scripted stub; my trained-against-the-sim checkpoint is the only "stub" in this debate that is the real artifact class it stands for.


---

<!-- from round1-llm.md -->

## advocate-llm

# Cross-examination round 1 — advocate-llm

## Attack on advocate-modes

Claim under attack: "the pure-tool-calling baseline spends a model round-trip per surprise while the body stands idle" and "zero model round-trips to not die in the mine," justified by a monster "3 tiles out" arriving "in ~0.8 s."

Two problems. The 0.8 s is a toy-sim artifact — from `SimAdapter`'s limits (`SPEED = 4`, `tilePx = 64`, 60 Hz → ~267 ms/tile), not a shipped game. And it misdescribes my loop: the model arms `until: { monsterWithin: r }` *before* entering danger; the adapter evaluates it every tick (`sim-adapter.ts` `playTick`), so the body stops the tick the monster crosses radius `r` — not when the model answers. The radius *is* the latency budget, chosen by judgment — what a fixed `danger_flee` cannot do without per-game tuning. Their ~100–250 ms poll buys nothing for survival the tick-rate interrupt hasn't done; it buys a flee macro whose thresholds (`healthBelowPct: 35`, `minDistanceTiles: 6`) are per-game magic numbers — exactly the fixed logic per game the judge's criterion taxes. Their own scenario ends with "the next model turn... can re-plan": the model still decides; a tuned table sits in between.

## Attack on advocate-skills

Claim under attack: "Pure tool calling pays that per-call tax on every leg of every goal forever."

False about the code. `body_walk_to` is one call under which `walkTo` runs up to 14 legs autonomously — planning, held steps, blocked-tile marking and replanning (`settle()`, `walk.ts`) — zero model calls between legs, honest failure text at the end. A farm chore is a handful of calls, not per-leg. Their steady state ("one model round-trip... runs locally to completion") describes `body_walk_to` plus a per-game folder of model-written code. For THIS product that folder is the wound: they concede the sandbox "do[es] not themselves promise a security boundary," so every skill is code a trust product must review per game — a recurring burden booked as "data." MAST finds agent-system failures concentrate in system-design and coordination categories ([arXiv:2503.13657](https://arxiv.org/abs/2503.13657)); Anthropic says add layers only when they "demonstrably improve outcomes" (fetched).

## Attack on advocate-llm-bt

Claim under attack: "That is the ONLY model call needed for the whole chore" with "the smallest porting cost in this debate by construction."

Their own evidence contradicts the first half: iterative regeneration scored the same 12/17 as one-shot at 7,770 vs 5,075 tokens (LLM-as-BT-Planner, their citation) — authoring is iterative, so calls-per-goal is 1 + re-authors. Their sample trees hard-code tile coordinates (`walkTo {x:4,y:6}`) and button timings — a snapshot plan gone stale when the player tills a tile mid-goal; reactive guards re-check *conditions*, not the stale *structure*. My loop re-reads state at every decision. Debugging gains two more artifacts — tree JSON plus per-tick trace to correlate against DSH's log; I keep one causal chain.

## Attack on advocate-goap

Claim under attack: "LLMs demonstrably cannot reliably do multi-step planning over exact state" (LLM+P: 66% vs 29%).

Those are PDDL string puzzles; on embodied tasks ReAct beat imitation- and RL-trained baselines by +34% absolute on ALFWorld with one-two examples (arXiv:2210.03629, fetched). Our goals are short delegated chores verified in every tool result (inventory diffs, `watered` flags), not IPC-hard search. Their port: a new `domains/<game>.json` plus a per-game grounding extractor — a larger authored artifact than my single declaration.

## Standing answers

- **"Idle while thinking":** the body idles only at decision points; legs and input batches run unattended, danger interrupts are tick-rate. Worst case is bounded by output size (500 tokens ≈ >15 s, ClickHouse); tool outputs are capped (`renderObservation` ≤ 45 objects).
- **"Dithering":** real (WebArena 14.41% vs human 78.24%) but bounded here: delegated goals, verification in every result, `walkTo`'s 14-leg honest give-up, DSH goal rounds, and a persona that asks the player.
- **"No determinism":** the substrate (A*, `pathToSteps`) is deterministic and tested model-free; acceptance is statistical over fixed seeds, per the bench.
- **"Every rival keeps the model":** their seams prove it — `body_run_behavior`, `behavior_run`, `skills_bind`, `body_execute_plan`, `body_skill`, `body_policy`, `modes_set` are all tools *the model calls*. The question is whether per-game artifacts belong between model and body; I say no — the hybrid's fallback, "ship the executor with zero directives (pure baseline, unchanged)," concedes the baseline is everyone's substrate.


---

<!-- from round1-hybrid.md -->

## advocate-hybrid

# Cross-examination round 1 — advocate-hybrid (attacks)

## Attack on advocate-llm

The baseline claims: "**Danger does not wait for the model.** `until.monsterWithin` is evaluated by the adapter per tick… The reactive guarantee is tick-rate, not model-rate." That conflates *detection* with *response*. The adapter stops the walk at tick rate, true — then the body stands frozen beside the monster it was interrupted by for a full model round-trip while the model "re-decides with one round trip: fight, retreat, or reroute." By the baseline's own cited numbers that is seconds: TTFT 200–500 ms plus 10–50 ms per output token; "a 500-token response still takes over 15 seconds" ([ClickHouse](https://clickhouse.com/resources/engineering/llm-inference-latency)). In the mine — monster inside 4 tiles, low health — that is the moment the companion must move, and nobody is home to move it. The systems the baseline itself appeals to agree: PUBG Ally keeps reflexes out of the model path because "reflex-level actions never have to wait for the model" ([NVIDIA](https://developer.nvidia.com/blog/how-krafton-built-pubg-ally-a-co-playable-character-powered-by-nvidia-ace)); DPT-Agent found System 1 or System 2 "alone is insufficient" ([arXiv:2502.11882](https://arxiv.org/abs/2502.11882)). Second claim: "**zero per-game behavior code**… cannot go lower." Zero is also the ceiling: nothing accumulates. Every parsnip day costs the same round-trips forever — no practiced routine, no library. Voyager's counterpoint is measured: a stored, verified skill library unlocked 3.3x more items and *transfer to a new world* ([arXiv:2305.16291](https://arxiv.org/abs/2305.16291)). A co-op companion should get better at living with you; this one has no memory in its hands.

## Attack on advocate-skills

Two claims from the opening: validation is "postcondition execution — run it once against the **live body**," and the trust surface is fine because "the player's request is the authorization." So the test run of unvalidated, model-generated code happens on the player's live save, in the live co-op world — the first execution *is* the experiment. The same opening concedes DSH's sandbox "is a *deployment file-policy mode*, not a proven security boundary" and that a profile policy change "the owner must sign off" (L2) is required. For a product whose rule is "trustworthy co-op player, not a bot," first-run-validated-on-production sits on the wrong side of the permission boundary — and it is unnecessary: my ladder validates drafts against the declaration *and* smoke-tests on the keyless sim before anything binds to a goal. Second: the mine tactic — "`while (!atLadder) { if (health < 35) retreat; else if (monsterWithin(3)) swingAt; else walkTo(ladder) }`" — is reactive control flow, model-written, fresh, per goal, outside any fixed audited interpreter. That is my system-1 re-derived as unauditable per-goal program text: the loop shape every game needs (protect → proceed → escalate) is frozen into ephemeral code, and since tactics are "deliberately not stored," every mine trip re-pays authoring it. The recurring structure belongs in one inspected engine; only parameters belong to the model.

## Attack on advocate-modes

The modes advocate claims the per-game surface is data only: "`modes-<game>.json` plus, at most, one or two new macros." Their own entries say otherwise: `"macro": "retreat_from_nearest_monster"`, and `field_work`'s till→plant→water pass structure — macros are per-game *code* by another name; the table merely names them. The port is "data + a macro library," which is my layer 2 without admitting it. And the design has no verification above vocabulary checking: a wrong-but-well-formed mode ships silently — no postcondition, no promote-from-draft ladder, nothing that compounds across goals. The model "can author the port itself" only inside the closed predicate/macro combinator set; it can re-parameterize pre-built behaviors but never compose a *new* one. That is a per-game ceiling dressed as an engine.

## Standing answers

- **"Kitchen sink."** The panel refutes the charge: fsm puts "goal intake (LLM, 1 call)" above its tree; modes drafts tables via the model; skills ships `safety.retreatWhen` — a mode — as code; goap and utility have the LLM authoring validated data; model sits an LLM above the policy. Every rival ships my layers piecemeal, each with a *different* vocabulary (PTC bindings, predicate/macro sets, domain predicates, considerations). The hybrid's contribution is the discipline: one vocabulary (the declaration), one artifact flow (draft → validate → bind → execute → digest), one owner per timescale.
- **"What did you add?"** The interfaces and single source of truth, plus accumulation (the library) that modes lacks and validation-before-live-binding that skills lacks.
- **"Layer conflicts."** Conflicts are escalation events with provenance (tick, predicate snapshot, outcome); DPT-Agent and Mindcraft both route interrupts back up as messages.
- **"Integration cost."** The adapter tier and macro substrate already ship (`until`, `fastState`, `walk.ts`); only the interpreter and validator are new — game-agnostic, bench-testable on the keyless sim.


---

<!-- from round1-model.md -->

## advocate-model

# Cross-examination round 1 — advocate-model

## Attack on advocate-llm-bt

Claim attacked: "the interpreter and node vocabulary are fixed forever; every game difference lives in data… the maximum extensibility-per-line-of-code any architecture in this debate can offer," with PORTAL as proof at "commercial-game scale." Two problems. First, PORTAL's scale is **one genre**: "thousands of first-person shooter (FPS) games" ([arXiv:2503.13356](https://arxiv.org/abs/2503.13356), fetched). Thousands of clones of the same verbs is the easy case; GameScaling's controlled study found transfer splits into an "interface phase" (broad cross-world gains) and a "world phase" where gains narrow to in-corpus worlds ([arXiv:2610.28698](https://arxiv.org/html/2610.28698)) — and an LLM-authored tree is *all* world phase: every guard, tile coordinate, and button timing is world knowledge, the exact part that does not transfer. Second, their own farm tree proves it: `walkTo {x:4,y:6}`, `{press:["ControllerX"], ms:120}` — open-loop parameterized script, re-authored per plot, per goal, per game, by the LLM. That is an authoring tax paid in model round-trips forever, not extensibility. And their anticipated-attack #6 concedes the endgame: "The day one is exposed as a callable service, it slots in as an `act` leaf inside this very grammar." Exactly — at that point the tree's entire raison d'être (tick-level reactivity) is done better by the policy at 30 Hz ([arXiv:2511.08892](https://arxiv.org/abs/2511.08892)), and the grammar degenerates to a pass-through `seq` around one leaf. They have described my architecture with extra JSON.

## Attack on advocate-skills

Claim attacked: per-game cost is "a folder of skill files the model fills in by playing," evidenced by "Voyager's library transferring to a new world and SkillWeaver's cross-agent transfer." Both are **same-domain** results, misread as cross-game: Voyager's transfer is a new Minecraft *world* (same game, same mineflayer API); SkillWeaver's gains are WebArena→real websites (same domain, both web; their own transcript says "cross-agent," not cross-game). The measured cross-game evidence points the other way: Lumine trained in Genshin Impact completed missions zero-shot in Wuthering Waves and Honkai: Star Rail ([arXiv:2511.08892](https://arxiv.org/abs/2511.08892)); SIMA's withheld-game agent nearly matched the specialist ([DeepMind blog](https://deepmind.google/blog/sima-generalist-ai-agent-for-3d-virtual-environments/)). Also, their steady-state pitch — "one model round-trip, then the program runs locally" — is byte-for-byte my `body_policy` call's shape, except the skill is LLM-guessed code against bindings whose semantics the LLM inferred from a declaration, while the policy's competence came from interaction. And their own trust section concedes DSH's sandbox "is a file-policy mode, not a proven security boundary." A trust product running model-written host code per game, when a bounded alternative exists, is a liability they waived rather than argued.

## Attack on advocate-rl

Claim attacked: "Foundation policies are the real multi-game asset," with VPT as the existence proof. That argument's escape hatch opens into my room: VPT is a **single-game** Minecraft prior (2022); the multi-game realization of exactly that idea is the 2024–2026 generalist line — SIMA (one agent, nine commercial games, multi-game training beating specialists), Lumine, GameScaling (open Qwen3.5-based keyboard/mouse policies, Apache 2.0). The rl advocate's own conceded costs ("9 GPU-days for one diamond task") are the per-game tax generalist training amortizes once. Their architecture's dev-time training loop is the thing my side deletes; what remains for them is the goal tier — which DSH's LLM already owns.

## Standing answers

- **"No permission surface, no seams" (llm-bt #6):** my opening named them: DSH-owned goals (seam 5), turn-cancellable tool (seam 1), adapter-enforced `until`/budgets/cheat refusal (seam 6), logged chunks (seam 7). "Specialized per-game-family training" is contradicted by fetched evidence, not assertion.
- **"Latency worse than a BT/FSM":** per tick yes; per product no — 0.13–0.69 s/step with 30 Hz control vs 4.0–23.7 s/step for frontier-LLM loops ([arXiv:2610.28698](https://arxiv.org/html/2610.28698)), and co-op tolerance, not microsecond supremacy, is the bar.
- **"Uninspectable acting":** the rivals trust LLM-written code (skills) or LLM-written trees under a sandbox their own advocate admits is not a hard boundary; I ship no model-authored host code at all — bounds live in the adapter contract, records in body-task files.
- **Hybrid's "model-level agents pay per-genre models":** SIMA 2 ran zero-shot in held-out games and Genie-3-generated worlds ([blog](https://deepmind.google/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/)); per-genre is where the field was in 2024, not where it is.
