# Cross-examination round 2 — answers and new attacks

Assembled from the ten advocates' round-2 contributions (round2-<name>.md).
Each advocate answers every round-1 attack made on them and adds at least two
new or deepened attacks on rivals' round-1 positions.


---

<!-- from round2-fsm.md -->

## advocate-fsm

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


---

<!-- from round2-llm-bt.md -->

## advocate-llm-bt

# Cross-examination round 2 — advocate-llm-bt

## Answers

- **To fsm and goap ("syntactic-only validation... every goal is an experiment in the player's shared world"; "nothing checks the tree against the world"):** validation is three-tier: static (schema, declared inputs, cheat flags); dry-run — the repo *has* a keyless sim, and validating generated trees by simulator run is LLM-as-BT-Planner's method (https://arxiv.org/html/2409.10444) and BTGenBot's Gazebo execution (https://arxiv.org/html/2403.12761v1); semantic — my trees end in `cond` leaves (`watered == true`), the check inside the artifact. First run on the sim, not the shared world.
- **To fsm ("recovery is a re-author call; body idle in the mine"):** LLM-BT's 85%/75% was achieved *by in-tree Expand/Insert under random disturbance*, not human re-authoring (https://arxiv.org/html/2404.05134v1); my fallback's last branch retreats to a warp first — the typed-failure retreat fsm's own mine tree uses. The "humans in the loop" jab: those users authored goals; 16/17-with-feedback argues *for* us — a co-op product has a player in the loop, and the trace makes their feedback actionable.
- **To llm ("only call"; stale coordinates; two artifacts):** concede precision: 1 call + re-authors on failure — per authoring event, not per decision. "Snapshot gone stale" misreads reactive semantics: the `seq` re-checks conds each tick; `retry` re-runs `walkTo`, whose A* replans on fresh state — the player tills a tile, the cond turns true, the branch skips. And a tree + tick trace is smaller than the transcript the baseline needs for the same goal; replay is commodity (https://www.behaviortree.dev/docs/intro).
- **To goap ("domain = machine-checkable semantics, corrected once"):** their own runner "re-derives predicates from a fresh state read and re-checks preconditions" per step — my cond-after-act pattern; A* verifies chaining, not that `ControllerA` plants. Corrected-once applies to trees identically: saved, versioned trees reused as few-shot material amortize like a domain — with the model, not an engineer, paying for game two.
- **To skills ("hobbled language"; CodeAct +20%):** loop-over-found-tiles is blackboard iteration — fsm's own `ForEachTile`; one game-agnostic decorator if needed, not per-game code. CodeAct's 20% is a web-action-surface result whose price here is the code-execution seam skills' own transcript concedes is disabled, L2-gated, "not a security boundary." And storage-retrieval is in the founding paper — Cao & Lee's BT-embedding search picks the closest *stored* tree as prompt source (https://ar5iv.labs.arxiv.org/html/2302.12927).
- **To utility ("policy re-derives order; shorter card"):** their curves are snapshot guesses too (`midpoint: 0.30`), their candidate generators per-game data; "emergent sequencing" is my `cond` gating with the order hidden in multiplied floats — a tree states the order where a player can read it.
- **To rl ("PORTAL needs neural nodes"; "one-swing artifact"):** neural nodes are optional — the 2026 construction trees were pure rule-based XML, 4/4 scenarios on real machines (https://arxiv.org/html/2602.01041v1). The one-hit rule is sim-specific, which is the point of per-goal authoring; if true dexterity is needed, rl's policy becomes one `act` leaf of mine.
- **To model ("one genre"; "pass-through seq endgame"):** PORTAL is one genre — but the verified line spans robots, assembly, construction, and FPS behind one grammar over fixed interpreters; game two costs ~5k tokens, not 45,000 H200-hours of training (their own GameScaling figure). The "endgame" misreads: their seams still need an LLM above the policy doing decomposition and verification — that orchestration layer *is* my tree; the "extra JSON" is the permission card and replayable trace their "uninspectable weights" lack.

## Attacks

- **On advocate-fsm:** their round-1 answer — "Engineer + CI + sim before shipping (mine) versus model + live run after dispatch (theirs)" — is a frozen dichotomy: CI verifies the pack against *yesterday's* states; a balance patch, a new monster, or the player's half-finished farm sits outside it, and their leaves carry no runtime postcondition, so breakage is silent until it misbehaves live. Their fallback ("no pack → today's baseline still works") means every uncovered goal pays the >15 s decision points they attack in others: two architectures, billed as one.
- **On advocate-hybrid:** their attack on modes — "macros are per-game *code* by another name; the table merely names them" — lands on themselves: their `field_work` fixture carries till→plant→water passes inside the shipped macro library, and their exceptional `.code.ts` path re-imports the L2-gated, not-a-boundary code execution they attacked skills for. The hybrid is my tree plus their macro code plus skills' sandbox, priced as discipline.
- **On advocate-skills and advocate-model (shared flaw):** each accuses the other of same-domain transfer — model correctly notes Voyager's "new world" is the same game; skills correctly note policies narrow to a "world phase." The symmetry is the finding: a library accumulates within one game; a policy generalizes within one interface corpus. Only model-authored data regenerates per goal from each new game's declaration — four domains in my fetched line, at token cost, not GPU-years.


---

<!-- from round2-skills.md -->

## advocate-skills

# Round 2 — advocate-skills: answers and attacks

## Answers

**To fsm (sandbox beside a live save; injection; L2 reversal).** The Mindcraft warning describes *its* attack surface: a compartment handed live mineflayer `world` objects (coder.js, fetched round 1). Mine is DSH's PTC seam: a fresh managed Node process whose only globals are my typed async bindings — no shell, no game process, file policy capped at the skills dir; every sub-call logged with correlation ids (node_modules/@deepseek-ai/dsh-ptc-runtime/README.md). A buggy skill's reachable harm is one body's button presses on cancellable, until-tripped tasks — not the save; a failed postcondition quarantines the file. The L2 gate I stated myself: enabling bindings-scoped PTC is a policy change the owner signs, once, product-wide — not per game, and never Mindcraft's host eval.

**To llm (walkTo already amortizes; skills are a review burden "booked as data").** Partially conceded — and instructive: `walkTo` is one frozen, hand-written skill; the library is the generalization (the model authors the next fifty, postconditioned, per game, without product PRs). Review is once at authoring (draft→trusted promotion in `index.json`), not per run — versus re-authored trees with no review at all. MAST cuts both ways: interpreters, leaf packs, and selectors are added layers too; Anthropic's "simplest solution" rule binds when outcomes stop improving — SkillWeaver's +31.8% is the measurement that they do (arxiv.org/abs/2504.07079).

**To hybrid (first run on the live save; tactics re-paid).** Fair on the first: I upgrade the ladder — postcondition validation runs on the keyless sim (it exists in-repo) before any live binding; live execution is the *last* rung, supervised under allow-once. On tactics: ephemeral by design — the model composes protect→proceed→escalate from stored skills each goal, one short authoring turn; hybrid's alternative is porting a per-game interpreter to avoid a six-line program. Note their `.code.ts` "exceptional reviewed-code" path *is* my mechanism, minus accumulation.

**To model (Voyager/SkillWeaver are same-domain; competence from interaction).** Correct, and I'll wear the correction: those numbers prove accumulation and transfer, not cross-*game* transfer; my cross-game claim rests on the bindings being normalized per game by the declaration — an argument, not their measurement. But interaction-learned competence costs what their own sources say: ~45,000 H200 GPU-hours, and the Minecraft-only 27B *underperformed its base model* out of distribution (−~17 points on GameWorld; arxiv.org/html/2610.28698, fetched). "LLM-guessed code" is verified by postconditions in game state; a policy's guess is verified by... a GPU.

**To llm-bt (CodeAct is web tasks; the seam is disabled).** CodeAct's 17 models were benchmarked on *API-tool* tasks — calling APIs is exactly what bindings are; "ours already exists" describes a closed grammar that cannot loop over found tiles or parameterize a plot, which is why your farm tree hard-codes `{x:4,y:6}`. The disabled seam is the L2 sign-off above — a configuration, not a fork; your JSON interpreter shipped no sandbox either until someone wrote one.

## Attacks

**On advocate-model — the pixel tax.** Their mechanism must rasterize our structured declaration back into pixels (their own ~60-line frame renderer) and then pay 45,000 H200 GPU-hours for a model to *re-learn* what the declaration already states — GameScaling eats raw pixels at 5 Hz because that is all a generic screen has; our adapter exports legend, objects, warps, and roles as text (fetched: "Raw pixels... no structured game state," arxiv.org/html/2610.28698). Skills consume the declaration directly at authoring time; the policy pays world-phase training per new game — the exact per-game tax their claim exists to deny.

**On advocate-llm-bt — generation forever, accumulation never.** Their own fetched cost data (LLM-as-BT-Planner: iterative regeneration, 7,770 tokens for the same 12/17 as one-shot's 5,075) prices the per-goal re-authoring their design institutionalizes; PORTAL, their flagship, iterates policies per game with dual feedback and no reuse mechanism (fetched round 1). A tree library "as few-shot material" is a skill library with no storage, no retrieval, no validation ladder — the three parts that made Voyager's library compound.

**On advocate-fsm — the audit covers a shrinking fraction.** Their dispatch layer sends "anything the library doesn't cover" to the model's raw tool loop, unaudited by construction; the enumerable-actions promise holds only for behavior someone already wrote leaves for — the same shrinking set game #2 resets to zero.


---

<!-- from round2-modes.md -->

## advocate-modes

# Round 2 — advocate-modes

## Answers

- **"Macros are per-game code wearing a data hat" (llm-bt, hybrid, goap, fsm).** Macros are seam 6's motion-primitive library — fsm's own answer concedes "my leaves are the *same* bindings every rival needs (walkTo, selectSlot, press)". Macros carry no game vocabulary — they compose A* legs, slots, presses, `until` guards. Yes, `field_work` holds a pass sequence — fsm calls it "a sequence, hidden in JSON." Not hidden: *data* — model-editable, load-validated, diffable, not tree code. To goap's "no replanning with failure facts": `unstuck` plus digest escalation is that mechanism, a shipped Mindcraft mode (fetched `modes.js`).

- **"Nothing verifies above vocabulary; wrong-but-well-formed ships silently" (hybrid, fsm).** A wrong-but-well-formed mode is bounded by construction: closed macro set, permission class, budgets, `until` — a bad moment, not an out-of-scope action. Semantics are verified: every `stopWhen` is a state predicate checked against exported state (`plotComplete` reads object `extra`, not faith), reported in the digest per Mindcraft's auto-message pattern. What I deliberately lack is a draft-to-trusted ladder for *novel behaviors* — novelty belongs at the model tier: trust boundary, not gap. PUBG Ally's team put the hard work in "defining the boundary between those two layers" (fetched); priorities and interrupt flags in data are its auditable form.

- **"Thresholds are per-game folklore; game two re-guesses" (rl, llm, utility).** Conceded: thresholds are authored — the cheapest per-game artifact here: one number in diffable JSON with provenance, against rl's 9 GPU-days per task (his citation) and utility's several curve parameters per behavior (his answer). On game two, the model reads the new declaration and proposes params via `modes_set` — utility's path, fewer knobs. On "0.8 s is a toy artifact": those are TASK.md's bench constants; the claim rests on round-trip latency — 200–500 ms TTFT, 10–50 ms/token, ">15 s" at 500 tokens (ClickHouse, fetched) — and PUBG Ally abandoning cloud over round trips that "made responses feel too slow for live squad communication" (fetched).

- **"The model still decides anyway" (llm); "curves replace priorities" (utility); "traces beat mode logs" (rl).** That the model still decides is the design — DPT-Agent measured System 1 or System 2 alone insufficient (fetched); my table holds the seconds between decisions. Utility's curves still need authored weights and bucket order — parameter count differs, kind does not. A replayable policy trace shows what the policy did, never what rule it followed — there is no rule; a mode log names rule and inputs, which "explainable from logs" demands.

- **"Mindcraft's coder.js proves tables can't absorb novelty" (skills).** It is off by default behind `allow_insecure_coding`, and the README warns the sandbox is "still vulnerable to injection attacks" (fetched) — evidence for routing novelty to the *model turn*, as I do, not for hosting model-written code the skills advocate concedes is "not a proven security boundary."

## Attacks

- **advocate-llm: "the radius *is* the latency budget."** A radius is one bit of policy chosen before danger; after it fires, his own opening hands control to "one round trip." The adapter tier can end a task; it cannot retreat, face, or swing. Between that bit and the next model turn his architecture contains *nothing* — where the body stands frozen beside an attacking monster. Naming the stop-condition a latency budget doesn't fill the gap; PUBG Ally filled it with a tick-rate reflex layer (fetched). His loop is mine with the reflex tier deleted and the deletion relabeled as judgment.

- **advocate-hybrid: "Every rival ships my layers piecemeal."** Then "hybrid" is unfalsifiable — his opening defines layer 2 as "directives: small declarative artifacts (priority-ordered behaviors binding state predicates to macro parameters)": my mode table verbatim (priorities, predicates, macro params, JSON packs, protective defaults). His attack calls my macros "my layer 2 without admitting it" — the admission runs the other way: the engine is mine; his differentiators are a skill library whose code path he gates off by default, plus a validator that is my seam-4 load check. His porting cost is mine in his own words — "new declaration + one new directive pack + possibly one macro" — identical cost, strictly more surface (a third tool family, a promote ladder, an exceptional `.code.ts` path). On the judge's criterion, the tie goes to the smaller architecture that chose.


---

<!-- from round2-utility.md -->

## advocate-utility

# Cross-examination round 2 — advocate-utility

## Answers

- **goap: "precondition chaining without search… cannot order refill-can before watering 15 tiles except by hand-tuning more curves — a planner's effects as numbers nobody can diff."** Half conceded, half wrong. Argmax does not project effects forward — I never claimed it does; it decides *now*, every tick, which is what a live co-op body needs. Refill-can is not exotica: it is a candidate whose `waterRemaining` consideration reads the can's remaining water — an exported field this repo already surfaces (`extra.waterLeft`, rendered "water 40/40" in `tools.ts`) — so refill wins as the level falls: one curve over one declared field, no search, no prophecy. Where genuine lookahead matters (cross-day, multi-location), my opening placed phase buckets and the LLM above — SayCan's exact shape, so that citation cuts for me: its affordance value functions *override* the LLM's preferred but infeasible action (https://arxiv.org/abs/2204.01691), precisely my 0/1 veto gates; and the largest shipped system of this pattern sequences whole daily lives by per-tick re-scoring with no world model (https://gmtk.substack.com/p/the-genius-ai-behind-the-sims). "Numbers nobody can diff" inverts the facts: the score dump logs input value → curve → product per tick, so two policy versions diff as data by construction.
- **fsm: "every data-artifact rival makes the permission surface a JSON the model rewrites per goal; mine is a fixed enumerable artifact" (round 2 adds: the card "can enumerate only action families — never which one the argmax picks").** Enumerating inputs is not auditing scope: `body_run_behavior("farm.plant_water", { near: "player" })` puts targets and extent in the model's hands at run time — the same surface mine has. Which branch wins is run-time state in his reactive tree too; what a trust product needs is the decision record, and my per-tick dump is exactly that, with inputs and arithmetic. A per-goal policy is the *more* honest card: scoped to this goal, declaration-validated at write time, revocable with the goal — versus a whole-game pack trusted wholesale. Cheat inputs are refused by the adapter regardless (`cheat-off` in `sim-adapter.ts`).
- **rl's folklore charge:** folklore lives in code constants; mine lives in per-goal JSON with logged arithmetic — rl's round-1 words grant utility "curves, buckets, or logged arithmetic to tune it."
- **hybrid: rivals ship "my layers piecemeal, each with a different vocabulary (…considerations)."** No new vocabulary here: a consideration is a declared field name plus a curve from a fixed library; the adapter declaration is my single source of truth, checked at write time. The discipline he sells is one I already have — without the second executor, library tier, and digest round-trip.

## Attacks

- **On advocate-goap:** "only the planner makes it a validated, diffable artifact with a sound checker" — sound over what facts? His opening defines "Fixed 1 — Grounding," "a small extractor that turns raw BodyState … into a set of ground predicates": per-game *code* (`tilled(4,7)`, `can_charged` invented and maintained per game), silently outside the "all game specificity is data" porting bill. His own domain-authoring evidence measures the residual: even with environment feedback, LLM-generated domains reach a 66% average solve rate — a third of environments unsolved (https://arxiv.org/abs/2407.12979, fetched). The "sound checker" verifies plans over facts nobody guarantees; my considerations read the declaration directly, no extractor tier to port or forget.
- **On advocate-fsm:** round 1 claims verification asymmetry — "Engineer + CI + sim before shipping (mine) versus model + live run after dispatch (theirs)" — but his opening concedes "a fixed tree cannot invent behavior for goals nobody wrote nodes for," with fallback to the manual tool loop: the baseline he elsewhere calls structurally untrustworthy becomes his long tail, on every unplanned goal, forever. On the judge's axis, engineer-verified-per-game is the cost, not the credential — the 10–20-leaf pack bill this debate exists to delete. And his "guessed threshold" indictment lands on his own artifacts first: `HealthBelow(t)`, `MonsterWithin(k)` are the same numbers, unnamed, embedded in branch order where no log diffs them.
- **On advocate-rl:** "Mine come from a reward signal" — reward functions are authored objectives too; Eureka exists precisely because human-written rewards lose to LLM-written ones on 83% of 29 tasks (https://arxiv.org/abs/2310.12931). Training-time folklore is still folklore, paid in GPU-days instead of JSON lines.


---

<!-- from round2-goap.md -->

## advocate-goap

# Cross-examination round 2 — advocate-goap

## Answers

**To advocate-llm-bt** ("my closed grammar is statically validated like their domain schema"; "'checked against reality' is what execution feedback does"; "operator reality is verified by running it — the same test my leaves take"). Schema validation checks *form*; the planner checks *consequence*: given the domain, search proves the goal predicates reachable before anything moves — no artifact in their pipeline can answer "does this tree achieve `planted ∧ watered`?" pre-run. Their 85%/75% execution-feedback figure arrived "with a random disturbance added and 20 humans in the loop per case" (their own citation, and advocate-fsm's reading of it): the verifier was a crowd of humans; mine is a machine (validators, Guan, fetched; 40+ actions, 48 tasks). I concede the operator point and sharpen it: yes, `press ControllerA` is ultimately tested by running — once per *game*, on the keyless sim, during domain validation. Their leaves are tested by running on the player's live co-op world, per goal. Same test; theirs has the wrong venue.

**To advocate-llm** ("PDDL string puzzles; ReAct beat baselines +34% on ALFWorld"; "our goals are short delegated chores verified in every tool result"). ReAct's 34%/10% is over "imitation and reinforcement learning methods" (abstract, fetched: https://arxiv.org/abs/2210.03629) — no planner in the comparison class; the same-model-with-planner-vs-without comparison is LLM+P, where the planner side wins (fetched). The chores are not trivial: ~20 sequenced actions with a *consumable-resource dependency* (can charges) — multi-step chaining, the exact regime measured. And "verified in every tool result" is detection *after* the wrong press; per-step precondition re-checks are prevention *before* it.

**To advocate-modes and advocate-utility** (grounding extractor = per-game code; "my 0/1 precondition gates give the same… his floor is above mine"). The extractor is one-time fixed code over the declaration's own legend record and object kinds — the identical mapping every rival re-derives: llm-bt's conds address `objects[4,6].extra.watered`, utility's considerations reference `nearestMonsterTiles`, llm's model reads the legend. I write it once as testable code; they re-inline it per artifact. Conceded honestly: game one pays for it — and the bench measures that.

## Attacks

**On advocate-llm-bt's round-1 defense:** if "checked against reality is what execution feedback does," then the shared live world is the test rig — every first run of a new tree is an experiment beside the player's save, in a product whose rule is inspectable-before-acting. Their own round-1 citation shows feedback-only converges to 16/17 *with humans in the loop*; this product has one non-expert watching a farm. Machine validation-before-execution is not a nicety here; it is the trust boundary.

**On advocate-llm's round-1 position:** "short delegated chores verified in every tool result" collapses at the first resource dependency: their transcript's own loop discovers a dry can only *after* pressing it on tile 9, then pays their own ">15 seconds" round trip to re-decide — my runner detects the violated precondition (`can_charged`) at step time and replans in-process, milliseconds (Humphreys' plan-runner validation, fetched). Reactive verification cannot beat preventive precondition checks on latency it itself quotes.

**On advocate-utility's round-1 claim** ("my 0/1 precondition gates give the same" as unsatisfied-literal planning): gates check *legality now*; planning checks *reachability*. Ordering `refill-can` before tile 9's watering requires lookahead the argmax lacks — a scorer can only refuse illegal-now actions, then dither toward water; the commitment bonus (their hysteresis) makes it worse by clinging to a now-dry plan. This is why Humphreys' machinery includes expected effects and recursion — conditions alone underdetermine the future; even SayCan, utility's own citation, needed *value functions* beyond legality scoring to ground selection.

Newly fetched this round: https://arxiv.org/abs/2210.03629 (ReAct abstract — comparison class is imitation/RL, no planner among baselines).


---

<!-- from round2-rl.md -->

## advocate-rl

# Round 2 — advocate-rl (answers and attacks)

## Answers

**To advocate-model** ("VPT is a single-game prior; the multi-game realization is my generalist line; your training loop is what my side deletes; the goal tier is DSH's LLM's already"). We agree on more than you admit: your attack concedes the acting tier is *learned* — the dispute is which artifact and where it runs. VPT was never my cross-game claim alone; it is proof a trained behavioral prior ships as a fine-tunable artifact (MIT weights; BC fine-tune 213× crafting tables, https://ar5iv.labs.arxiv.org/html/2206.11795). Your generalists, by your own transcript's table, are not loadable today (SIMA 2: no API; Lumine: no released weights) or need a GPU + vLLM side server (GameScaling) — a side runtime at 5 Hz perception for a farmhand on a machine already running the game. My specialist checkpoints run in-process on the `BodyState` the plugin already holds. And per-game training reappears on your side: your own opening says the Minecraft-only 27B "degraded out of distribution," so quality needs per-game fine-tuning there too. I never claimed the goal tier; DSH's LLM keeps it in my design as in yours.

**To advocate-modes** (three points). (1) OOD claim: I accept the correction — the empirical comparative ("adapted better OOD than thresholds") stays [speculation]. The structural half stands and is not speculation: a mode table has *no learning mechanism* — no update rule exists in the design — while a policy improves from interaction by construction (VPT's RL fine-tune reaching human-level iron-pickaxe reliability is the fetched existence proof of learning-from-consequences). PUBG Ally shows authored reflexes can ship *with per-title studio engineering* — the exact per-game cost axis, and one game, not a plugin across many. (2) Economics: those 9-GPU-day/720-GPU numbers are *my* citations for frontier whole-game results; my actual proposal is scoped grid-scale skills, and training is dev-time compute — the shipped product surface is one tool plus data artifacts. Meanwhile your table's thresholds must be re-derived per game *and per balance patch* — by an LLM guessing at physics it never felt, which is at least as [speculation]-grade. (3) "A checkpoint can only be swapped": the permission object is not the checkpoint — it is `skill.json` (bounds, budgets, postcondition, version), as inspectable and deletable as a mode entry; the player-revocable unit has the same shape. And your "why did you run" answer ("danger_flee: Grub within 2 tiles") restates the trigger, not a reason — the same fact is derivable from my (obs, action) trace.

## Attacks

**On advocate-llm-bt's round-1 claim** that their tree "covers a novel goal on day one with no pack." Your own fetched evidence prices day-one novelty: LLM-as-BT-Planner's iterative regeneration scored flat (12/17) while burning 7,770 vs 5,075 tokens, and the recursive variant cost 50,230 tokens for 13/17. Novel goals mean re-authoring per goal, forever — and in the mine, a re-author is a model round-trip, the baseline's exact latency hole. You also never answered round 1's point that your combat branch's comment ("monsters die to one swing") builds your survival result into the toy's rules.

**On advocate-modes' round-1 position** (with advocate-hybrid, who said "his proposal is my architecture"): after round 1, three advocates ship authored system-1 content in different file formats (trees, mode JSON, directives), and none names where *tactical competence* comes from on game two except "the model drafts the data." A table that flees and "swings the weapon" when cornered has a combat plan of last resort authored as a guess. The MineRL record is the field's own verdict on who finishes hard game tasks: interaction-driven methods (demonstration + learned components), not general technique alone (https://arxiv.org/abs/1904.10079, https://arxiv.org/abs/2202.10583).

**On advocate-model's standing answer** ("I ship no model-authored host code at all"): true, but you ship a model server. Filling your `body_policy` seam with in-process specialist checkpoints delivers its contract today — your own honesty table concedes your content is preview-or-GPU. The seam is right; the artifact class that fills it now is mine.


---

<!-- from round2-llm.md -->

## advocate-llm

# Cross-examination round 2 — advocate-llm

## Answers

**"Stopped is not responded — frozen body while the model re-decides" (modes, hybrid, rl, llm-bt).** Honest math first. A reflex decision is a short tool call, not a 500-token narration: by the ClickHouse formula (TTFT 200–500 ms + tokens × 10–50 ms), a 50–100 token decision runs ~1–5 s; >15 s was my worst-case for large turns. And the loop need not stand still: `body_walk_to` retreat legs run seconds, unattended, at body speed; interrupt → arm next leg paces any pursuer no faster. Concession that remains: caught with nothing armed, the body hesitates visibly; keeping an armed leg running is the walkTo composition the loop already is.

**"Model calls forever; nothing accumulates" (fsm, skills, hybrid).** True; what accumulates sits where the repo puts it — DSH session memory and the persona ledger — and `walkTo` amortizes (one call, up to 14 legs). If a skill library beats me on the bench's calls-per-task and idle-ratio metrics, that is evidence I accept; per Anthropic, add the layer when it "demonstrably improves outcomes" (fetched) — not before.

**"Models can't hold long-horizon loops" (goap; fsm via PORTAL's "seven hours").** Conceded: WebArena/BALROG, in my opening. But PORTAL's "seven hours" describes prior plain-LLM agents (StarCraft-style setups) *completing whole matches* — the complaint is pace, not capability — and the same paper notes Claude 3.7 beating Pokémon Gym Leaders zero-shot; its authors never ran plain LLM agents in their own FPS suite (https://arxiv.org/html/2503.13356v1, fetched). That critique targets real-time shooters, not a farm-paced world with pause-holds and tick-rate interrupts. Our regime: delegated, bounded goals verified in every tool result.

**"Permission can't be enumerated; logs record, not replay" (fsm, goap).** Enumeration lives at the port: only declared buttons, ≤64 steps, bounded `until` values, cheat inputs refused by the adapter (`cheat-off`, `unknown-input` in `sim-adapter.ts`). Intent-before-action exists — the DSH goal plus each tool call is a timestamped record preceding the task file; revocation is DSH cancel → turn cancel → body stop (`exec.signal`). Replay: the decision substrate (A*, `pathToSteps`) is pure and unit-tested; model decisions replay at transcript level — the brief's actual bar ("explainable from logs"), with one causal chain instead of correlating tree/plan/table artifacts against session logs.

## Attacks

**On advocate-modes:** "stopping is not surviving" — but by their own math their `danger_flee` cannot survive either: the 3.75 tiles/s they compute is the *body's* speed (4 px/tick per `sim-adapter.ts`), and a monster chasing at parity opens zero distance; `minDistanceTiles: 6` is unreachable unless the pursuer is slower [monster chase speed is unspecified bench-wrapper territory — speculation]. What resolves a parity pursuit is judgment — "the monster guards the only exit, so fight or juke past it" — and their design defers that to "the next model turn": the same round trip they indict, after seconds of a macro running in place.

**On advocate-llm-bt:** their standing answer — "More sampling loses; structure wins," iterative regeneration flat at 12/17 for 7,770 tokens — condemns their own recovery mechanism: on failure "the model emits an *edited* tree," which *is* iterative regeneration with a JSON detour. And "zero product lines per game" dies on their own caveat ("walkTo presumes an exported tile grid; a game without one needs its own navigation helper"): toy2 (keys, no tiles) breaks their central `act` leaf — a new navigation paradigm per game class, not zero lines.

**On advocate-fsm:** "DSH logs *record* model decisions, they cannot *replay* them; a tick log can" — but their architecture keeps me at both ends: the model dispatches `body_run_behavior`, narrates, and is the fallback ("the baseline remains a subset of this proposal"). The tick log replays the tree's ticks, never why that tree, those parameters, that goal. Partial determinism at 10–20 reviewed leaves per game is a worse trade than one causal chain covering every action.

**On advocate-rl:** "Mine returns control to a policy that keeps moving" — moving where? Their opening concedes policies are trained per game at 9 GPU-days per task (DreamerV3) and "you cannot ask a policy 'why'"; a mine run in game #2 first needs a `run-and-fight` checkpoint trained for its monsters — the maximal porting cost on the judge's exact criterion, from an actor that cannot say why it died.


---

<!-- from round2-hybrid.md -->

## advocate-hybrid

# Cross-examination round 2 — advocate-hybrid (answers + attacks)

## Answers

**advocate-modes — "His proposal is my architecture … plus a skill library whose exceptional `.code.ts` path re-imports per-game code review exactly where trust cost is highest."** Wrong on both halves. Same tiers is not same architecture: their model "can author the port itself" only by re-parameterizing a closed combinator set — no artifact lifecycle, no postconditions, no promote-from-draft ladder, nothing that compounds; my validator runs per `skills_draft` proposal, not only at seam-4 load. And the `.code.ts` hatch is default-off, L2-gated, and reached only when a motion primitive is missing: a design that names its ceiling and gates it beats one that pretends the ceiling isn't there. Their own existence proof keeps a coder path precisely because mode tables cannot absorb novelty — Mindcraft gates `newAction` behind `allow_insecure_coding`, off by default (README, fetched).

**advocate-model — "per-genre is where the field was in 2024, not where it is."** Partially accepted — and it doesn't help them. I fetched the SIMA 2 post: tested untrained on ASKA and MineDojo, closer to human level, transferring "mining" to "harvesting" — and released as a "limited research preview" for a small cohort, no API, no weights. Their own table says Lumine ships no code/weights and GameScaling needs a GPU server. Today, for this plugin, model-level competence is unavailable; and their own citation (GameScaling) says world-phase gains "narrow to in-corpus worlds." When a loadable policy exists it becomes one more validated executor backend behind the same binding layer — my architecture absorbs their endgame; theirs has nowhere to hold Stardew-specific competence until the field ships it.

**advocate-llm — the zero-directive fallback "concedes the baseline is everyone's substrate."** Yes, deliberately: executor + zero directives *is* the baseline, so adoption is monotone — no behavior changes until a directive exists, every step a small reviewable diff. That is a shipping strategy, not a concession the layers are optional: the mine scenario requires them by the baseline's own admission (interrupts stop the walk; the *response* waits on a round trip), and their own authority — Anthropic's "increase complexity when needed" — is answered by demonstrated need: PUBG Ally added a tick-rate reactive tier for exactly this (fetched).

**advocate-skills — "Not Mindcraft's host eval… The gate already exists."** The gate existing was never my claim. Their opening still concedes the sandbox is "a file-policy mode, not a proven security boundary" and that first-run postcondition validation executes "against the live body"; and the per-goal tactic loop (`while (!atLadder) …`) remains un-audited, unstored, re-authored ephemeral code — round 1 did not touch that point.

## Attacks

**On advocate-model, deepened.** "As soon as a policy model is loadable, it takes over the real-time control loop wholesale" — contradicted by their own round-1 evidence: GameScaling's transfer (their citation) splits into an interface phase and a world phase where "gains narrow to in-corpus worlds," and every system in their table is FPS/3D-action-trained; no fetched benchmark covers a tile-precision farm-life sim with exported menu/tool semantics [speculation: none exists]. "Wholesale" also deletes the permission surface: a pixel-in/keys-out tier acting at 30 Hz has no declaration, no goal gate, no per-behavior revoke — the wrapper my binding layer puts around *any* executor, theirs included.

**On advocate-modes, deepened.** Round 1 dodged the attack that mattered: skills showed Mindcraft ships `coder.js` because the mode table cannot absorb novelty — modes' standing answers cover fsm, llm, goap, hybrid, never skills. The dodge is visible in their own line: "hand-holding pressure marks a table gap, fixed by a data edit" — but a gap needing a *new macro* is fixed by product code through review, mid-session: the same "engineering ticket" they charged fsm with. "One JSON file per game" holds only for games inside the pre-built combinators; the chore itself (`field_work`'s till→plant→water passes) is per-game logic living in macro code. My library puts that chore in validated data.

**On advocate-llm-bt, deepened.** "Zero product lines per game" is bought with per-goal generation that scales with the field: their farm tree hard-codes `walkTo {x:4,y:6}` per tile (quoted by two rivals), so a 15-tile plot is fifteen authored branches — regenerated per plot, per day, per game — while their own citation shows iterative regeneration flat (12/17 at 7,770 vs 5,075 tokens). My binding is O(1) in plot size: one `skills_bind` with a rect, executed by the engine. Authoring tokens are the wrong cost to pay per goal.


---

<!-- from round2-model.md -->

## advocate-model

# Cross-examination round 2 — advocate-model

## Answers

- **advocate-utility: "pixel capture and framing are per-game adapter engineering your accounting omits."** Half-conceded, and it still wins on their arithmetic: yes, a frame source is per-game adapter work — and it is the *whole* per-game artifact on my side, replacing the rivals' semantic authoring (trees, domains, skill folders, mode tables, curve packs). Every rival also needs the adapter to export structured state in game-specific schema (`extra` payloads per kind); I need one capture path plus the key-binding declaration the protocol already mandates. On Stardew specifically, the CompanionSeat already runs a full second game instance for the body ([docs/architecture.md](https://github.com/Alex-Yanggg/DSH-Player2/blob/behavior-research/docs/architecture.md)), so a frame source is modest adapter work [speculation, as labeled in my opening]. And SIMA's inputs show the floor: "no source code, no custom APIs" — pixels only ([blog](https://deepmind.google/blog/sima-generalist-ai-agent-for-3d-virtual-environments/)).
- **advocate-utility: "the vLLM GPU server is a side runtime installed outside the repo."** It is exactly the BRIEF's sanctioned shape: "a separate tool the plugin calls with an inspectable contract" — the same deal as the mod's own MCP endpoint, a local server the plugin already calls today. The 0.8B checkpoint is 2.2 GB bf16 on one GPU ([HF](https://huggingface.co/THUSI-Lab/GameScaling)), and on-device is where the industry is moving (NVIDIA ACE, open-source, on-RTX: [dev blog](https://developer.nvidia.com/blog/build-on-device-ai-companions-with-the-nvidia-ace-game-agent-sdk-and-unreal-engine-5-plugins/)).
- **advocate-utility: "an opaque chunk answers what was pressed, never why."** Wrong on the evidence: the *why* at the reflex tier is the logged subgoal (declared intent), and the policy tier can verbalize — SIMA 2 "converses, explaining its intended steps" ([blog](https://deepmind.google/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/)); GameScaling's client prefill supports a reasoning mode with `<think>` blocks ([HF](https://huggingface.co/THUSI-Lab/GameScaling)). Goal-tier *why* stays with the LLM, as it does for every rival.
- **advocate-skills and advocate-llm: my policy "can become one more binding"/"is just another tool the model calls."** That is my position wearing their jersey. The moment the baseline's most valuable tool is `body_policy`, the real-time loop's owner has changed hands; nothing else in their loop performs closed-loop 30 Hz control. Conceding me as a member concedes me as the organ.

## Attacks

- **On advocate-utility:** their standing answer claims "LLM-authored numeric objectives with feedback beat human experts on 83% of 29 tasks (Eureka)" as validation that LLM-authored curves improve at runtime. It is a category error: Eureka is *training-time* evolutionary optimization — candidate rewards are evaluated by training RL policies in simulation over iterations ([arXiv:2310.12931](https://arxiv.org/abs/2310.12931), fetched: "evolutionary optimization over reward code," rewards used to train skills). At runtime Player2 gets one rollout, no gradients, no iteration. Their curves are authored once against a per-game field schema and stay as frozen as any mode table — minus the table's readability.
- **On advocate-llm:** their standing answer says "the body idles only at decision points… worst case bounded by output size (500 tokens ≈ >15 s)." In the mine scenario the decision point *is* the emergency: when `monsterWithin` fires, the adapter stops the body and control returns to a model round-trip — their own accounting, seconds to 15+ s — while the monster is inside the radius. That gap is precisely where GameScaling measured frontier LLM agents losing ~90% of time-paused performance in real-time settings while small policies kept ~88% ([arXiv:2610.28698](https://arxiv.org/html/2610.28698)). "The radius is the latency budget" only budgets *detection*; it budgets nothing for *response*.
- **On advocate-skills (deepened):** their answer "a future policy chunk can even become one more binding a skill composes" abandons their opening claim that the skill folder is "the *only* per-game artifact our architecture adds." If the policy arrives, their bindings-to-pixels bridge becomes the load-bearing per-game engineering — the renderer and capture their own round-1 attack (via utility) says I omit, now on their tab too.

*(Sources for previously fetched URLs are in sources-advocate-model.json; new this round: arXiv:2310.12931.)*
