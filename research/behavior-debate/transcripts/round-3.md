# Cross-examination round 3 — final answers, final attacks, closing positions

Assembled from the ten advocates' round-3 contributions (round3-<name>.md).
Each advocate answers every round-2 attack made on them, delivers final attacks,
and states an honest closing position: strongest case and weakest point.


---

<!-- from round3-fsm.md -->

## advocate-fsm

# Cross-examination round 3 — advocate-fsm

## Answers

**To llm-bt ("frozen dichotomy; silent breakage; two architectures billed as one").** Concede the real half: CI verifies against recorded states; a balance patch can invalidate a leaf. But breakage is not silent: action nodes end in condition leaves asserting the state change (`watered == true` — llm-bt itself calls this "the check inside the artifact"), so a broken leaf fails loudly, typed, and a renamed kind fails at load against the declaration. Uncovered goals run the baseline deliberately — every rival has the same day-one hole; honest degradation is a feature, not billing fraud.

**To utility (three prongs).** (a) Concede: targets and extent are runtime-bound in my dispatch too. The difference stands: my runtime choices come from a fixed branch set a player has read; theirs is the full candidate cross-product, re-sorted every tick. (b) "No log diffs them" is false of my design — thresholds are named blackboard data, values recorded in the tick log. (c) On scope I meet them halfway: permission is an allow-list of behavior names per player grant, not wholesale pack trust.

**To llm ("seven hours is pace; farm-paced regime; tick log never says why that tree").** Concede the regime point: the farm is pauseful; my latency case was always the mine — their own round-1 file concedes the ">15 s" flank. On "why that tree": correct, and by design — choice is the model's (goal, name, parameters, all in DSH's logs), execution is mine; two registers, each complete. One causal chain containing a 15-second combat freeze is not a better trade than two explainable links.

**To skills ("audit covers a shrinking fraction; game #2 resets to zero").** Concede the coverage bound — stated in my opening. Game #2 resets the pack, not the engine, taxonomy, or audit tooling; and whoever writes game #2's adapter — a cost skills agrees everyone pays — writes its leaves in the same PR, same declaration.

## Attacks

**On advocate-llm-bt's round-2 defense** ("three-tier validation… First run on the sim, not the shared world"): the only sim is this repo's toy — `game: "sim"`, its own legend, one-swing monsters. A tree dry-run-validated against the sim's schema proves nothing about Stardew's declaration, whose kinds differ; for the real product it collapses back to "run it live in the shared world" — the round-1 hole. And "saved, versioned trees reused as few-shot material" is a skill library with extra steps: model-authored behavior, retained trust question, none of my CI.

**On advocate-modes' round-2 position** ("What I deliberately lack is a draft-to-trusted ladder for novel behaviors — novelty belongs at the model tier"; "Yes, `field_work` holds a pass sequence… data"). By their own words they ship authored thresholds, authored macros holding the chore's order, and model-tier novelty — my architecture with two node types and a JSON table. Their validator checks vocabulary, not choreography; the first live run is still the semantics test — llm-bt's hole, inherited. When the model edits the table in-session ("one validated `modes_set` call"), the position is llm-bt's with a weaker grammar.

**On advocate-utility's refill answer** ("SayCan's exact shape"): SayCan's grounding is "pretrained skills" plus their "value functions" (fetched: https://arxiv.org/abs/2204.01691) — learned competence vetoing the LLM, rl's tier, not authored response curves. Their scaler keeps what I ship (fixed evaluator, LLM above) while claiming the one property — that goap showed failing at the first off-screen dependency.

## Closing position

Three rounds reinforced my strongest case: I am the only advocate whose acting artifact is fully reviewed before shipping, stays a fixed, enumerable permission surface, reacts at tick rate with zero model calls, and has twenty years of shipped precedent (Halo 3, Spore, Nav2, PUBG Ally's tick-rate BT reflexes — fetched). Rivals' concessions — modes' authored thresholds and macro-held sequences, llm-bt's sim validation and saved-tree libraries, goap's grounding extractor as shipped code — describe my layer rebuilt in another data format. My honest weakest point: bounded coverage at a real per-game price. Game two starts at zero behavior and pays an engineering PR before dividends; every uncovered goal runs the baseline I criticize. If the judge weighs day-one goal breadth and porting speed above auditability and reaction time, the data-authoring rivals win.


---

<!-- from round3-llm-bt.md -->

## advocate-llm-bt

# Cross-examination round 3 — advocate-llm-bt

## Answers

- **To hybrid ("fifteen authored branches per plot"; their O(1) binding):** the `{x:4,y:6}` example was hand-instantiated for brevity; `cond` already takes `nearest(kind=...)`, and `forEach` over found tiles is one game-agnostic decorator (fsm's own `ForEachTile`). And hybrid's O(1) is *my* argument: a stored, validated tree re-binds in one call per goal — theirs is O(1) only because the choreography was pre-written into their shipped macro library (see Attacks).
- **To goap ("search proves consequence pre-run"; "wrong venue"):** partially conceded: search proves reachability *given the domain*, and the domain is a guess until it touches the game — Guan's 40+ actions were validator-*and-human*-corrected; Mahdavi's 66% came from environment feedback (https://arxiv.org/abs/2407.12979). Weaker in logic, stronger in venue: dry-run on the keyless sim per goal — BTGenBot executes generated trees in Gazebo with machine checks only, 7/9 tasks (https://arxiv.org/html/2403.12761v1) — then `cond` postconditions fail loudly live. "20 humans" misreads LLM-BT again: the users authored commands; 85%/75% was performance under disturbance (https://arxiv.org/html/2404.05134v1).
- **To fsm ("syntax vs semantics"; "PORTAL trains neural nodes"):** their pack has no runtime semantic check either; my `cond` leaves are one — and the player reads only the version diff when something goes wrong. PORTAL's neural nodes are optional — the 2026 construction trees were rule-based XML alone, 4/4 on real machines (https://arxiv.org/html/2602.01041v1). Their concession — "my fallback *is* their architecture, run as fallback" — is the one that matters (see Attacks).
- **To rl ("novelty priced at 12/17 flat"; "one-swing never answered"):** answered twice: the branch encodes what this sim affords; trace→edit adapts, or a policy slots in as an `act` leaf. The flat number measures full regeneration from a failure string; my recovery is in-tree first (that is what 85%/75%-under-disturbance measured) and diff-targeted after — VLM-BT shows conversational tree editing converging, 10/10 valid (https://arxiv.org/html/2501.03968v2). Conceded: a re-author is a round trip — paid at the warp, like every rival's exception path.
- **To llm ("edited tree IS iterative regeneration with a JSON detour"; toy2 breaks walkTo):** the detour is the feature: those baselines rebuilt whole trees from a failure string; my edit is a one-branch diff on a versioned file. Toy2: conceded cleanly — `walkTo` needs a grid, and the helper layer is per-game for everyone (skills' bindings, goap's operators, utility's families). Zero interpreter changes stands; "zero product lines" carries the footnote all rivals share.
- **To skills ("CodeAct was API-tool tasks"; "no sandbox either"; "no storage/retrieval/validation"):** fair hit on CodeAct's setting; but a closed grammar needing no sandbox is not symmetry — there is nothing to escape. The library's three parts exist: storage (seam-7 tree files), retrieval (Cao & Lee's BT-embedding source-tree search, https://ar5iv.labs.arxiv.org/html/2302.12927), validation (`cond` postconditions + sim dry-run + draft status). PORTAL's retained top-policy population is accumulation by another name.
- **To modes ("macros are model-editable, load-validated data"):** that is my position for one artifact class — but their macros are a fixed library the model only parameterizes; mine authors the branches.

## Attacks

- **On advocate-hybrid:** "My binding is O(1) in plot size... executed by the engine" — executed by `field_work`, whose till→plant→water passes live in the shipped macro library: per-game code, exactly their own charge against modes ("macros are per-game *code* by another name"). And their round-2 answer — smoke-test drafts "on the keyless sim before anything binds" — adopts my round-2 validation venue while claiming the discipline as theirs.
- **On advocate-goap:** "Search proves the goal predicates reachable before anything moves" — reachability is only as fresh as the domain file: after a patch the proof still "holds" over stale effects, and their runner's re-checks are predicates from that same domain — my `cond` leaves without my loud postconditions. No fetched evidence shows a shipped LLM-authored domain verified by proof alone; the verified lines validated operators by running them.
- **On advocate-fsm:** round 2 concedes: "my fallback *is* their architecture, run as fallback, not the product" — so every goal outside the pack runs LLM-authored behavior with no tree, no trace, no permission card. And the staleness charge went unanswered: a pack "read once, in CI" is verified against yesterday's game, with no runtime check for today's.

## Closing position

After three rounds the strongest case stands: BTs as LLM-authored data are the only artifact simultaneously model-written (zero shipped behavior — "guide, don't script" maximized), statically checkable (closed grammar, cheat refusal, `cond` postconditions), and replayable (versioned tree + tick trace), with the interpreter fixed across four verified domains — robots, assembly, construction, PORTAL's FPS games. The honest weakest point: per-goal authoring costs tokens and a round trip exactly when goals change or the world breaks the tree, and first-run correctness rests on sim dry-run quality, not logical proof — a planner's reachability check and a policy's earned dexterity each beat me on one axis, which is why both can live inside my grammar as a validated subtree library and a policy `act` leaf.


---

<!-- from round3-skills.md -->

## advocate-skills

# Round 3 — advocate-skills: final answers, final attacks, closing position

## Answers

**To hybrid ("sandbox still not a proven boundary; tactic loop un-audited, unstored, re-authored").** The trust boundary is not the sandbox but the permission model around it: bindings-only effects, adapter-refused cheats, until-tripped cancellable tasks, per-sub-call logging, one-file revocation. Nobody's model turn runs in a *proven* boundary — the persona prompt is unsandboxed — and PTC gives more containment than in-process tool dispatch. Live-body validation was fixed in round 2: sim-first, live last, supervised. The tactic loop is fully logged in DSH's session log; it is unstored *by design* — goal-shaped judgment, re-authored in one short turn.

**To model ("conceding me as a member concedes me as the organ"; "your pixel bridge joins your tab").** Composition is not surrender: A* inside `walkTo` is the standing counterexample of a capable executor called as one helper without owning the loop — ownership sits with whoever sequences and gates (DSH goals, model composition). The skill folder remains the only per-game artifact *today*, your table showing no loadable policy (SIMA 2 preview, Lumine unreleased, GameScaling GPU-gated); the pixel bridge is optional insurance, off by default.

**To modes ("coder.js is off by default — route novelty to the model turn").** Off by default, yet never deleted: the code path survives because routing novelty to the model turn means per-step round-trips — by llm's round-2 math ~1–5 s each, the frozen-body gap four of you hammered. My path pays novelty once, as a stored skill.

**To fsm ("permission surface re-authored per goal"; "skills' predicates break on toy2").** Misread: skills are read once at authoring, then retrieved as trusted data — the fresh-per-goal artifact is llm-bt's tree, not mine; my permission surface is the static index plus bindings, load-validated in setup — the same once-per-game read your pack gets, minus the release train. Skills carry no fixed predicate grammar (that is modes/utility): on `toy2` the old index simply does not retrieve — nothing breaks.

**To llm-bt ("only model-authored data regenerates per goal").** Half agreed — the half you kept is the bug: regenerating per goal, unverified, versus once, postconditioned, stored, is renting versus owning. Your own numbers price the rent (iterative flat 12/17 at +53% tokens); SkillWeaver prices ownership (+31.8% WebArena, fetched). Same diagnosis, wrong retention policy.

## Attacks

**On advocate-llm-bt, final.** Round-2 claim: "Only model-authored data regenerates per goal from each new game's declaration — at token cost, not GPU-years." That token cost recurs forever: BTGenBot's ≤7B models needed a static-analysis pass to reach 7/9 executable; PORTAL iterates per game, no reuse (both fetched). A skill pays your cost once per capability and verifies it in game state; you re-pay every plot, every day — and your trees carry no postcondition, so a wrong-but-valid tree fails silently mid-chore.

**On advocate-fsm, final.** Round-2 claim: "My pack is read once, in CI, with tests, before any player exists." CI verifies against yesterday's states; your leaves carry no runtime postcondition anywhere in your transcript, so a balance patch breaks silently in live play — a skill's postcondition fails loudly and quarantines the file. And when behavior must change, yours is a code PR; mine is one supervised authoring turn plus a diffable file.

**On advocate-model, final.** "Conceding me as a member concedes me as the organ" — unavailable organs cannot own loops: your honesty table shows the fillers are preview-or-GPU, while the skills substrate (PTC) ships in DSH's published packages now. When your organ arrives, it will be composed by exactly the mechanism you argue against.

## Closing position

Strongest case: the skill library is the only proposal that makes behavior itself a compounding, per-game, player-inspectable data asset, authored by the model against a code-execution seam DSH already ships — amortizing authoring latency, failing loudly against postconditions, and composing with every rival's organ (A*, planners, policies) rather than competing with them. Weakest points, honestly: first-run trust of model-written code rests on a file-policy sandbox plus permissions, not a hard boundary; and cross-game transfer evidence is same-domain only — the many-games claim argues from the declaration's normalization, not a measurement. Day-one authoring latency is real; it is the price of the second day being cheap.


---

<!-- from round3-modes.md -->

## advocate-modes

# Round 3 — advocate-modes

## Answers

- **hybrid — "no lifecycle or compounding; a gap needing a new macro is a mid-session engineering ticket; the chore lives in macro code."** The sharp part stands conceded: a missing macro is product code — a real ticket. But his directives bind "macro parameters" over the same macro library: his library puts the *ordering* in data, as my `steps` array does, atop the same code tier. Compounding is deliberately out of scope: accumulation has homes (DSH session memory, the ledger); the reactive tier should hold still — that is what makes it auditable. A draft-to-trusted ladder for mode entries is adoptable if the bench shows need: a policy choice, not a new architecture. Skills' coder.js point was answered in round 2, on the merits: novelty routes to the model turn, not host-executed code.

- **llm — "at parity speed danger_flee opens zero distance; you defer to the same round trip you indict."** Physics conceded, both speculation labels honest. But the mode set answers parity in-table: `cornered_fight` exists because flight can fail; if both fail, the digest escalates with health spent as evidence. What I indict is not the round trip — it is the unarmed seconds before it: his own math prices a short decision at 1–5 s with the body frozen; mine moves within one poll. Judgment decides fights; reflexes buy judgment time to arrive.

- **rl — "no learning mechanism; thresholds re-guessed per patch; skill.json equally revocable; your 'why' restates the trigger."** No update rule at the reflex tier, by design: an audit layer that learned mid-session changed since breakfast. His "improves by construction" is training-time; shipped, the checkpoint is as frozen as my table ("training never runs in the plugin," his words), and re-earning a balance patch: 9-GPU-day-class compute versus a one-number diff. At the reflex tier the trigger *is* the reason — players ask "why did you run," not "justify your knee"; deeper whys are the model's, from the digest. Game-two tactics (with hybrid): the first table is a draft, verified in state (`stopWhen`) and corrected via digest; his MineRL record prices interaction-driven competence at 60M demonstrations and 4-day budgets, the restricted track only "progressing" (his citations) — a cost warning, not a free lunch.

- **goap — "I write the grounding once as testable code; you re-inline it per artifact."** Accepted, and mutual: my predicate combinator library is that one-time testable code; his operators add a second formalism (pre/effects plus search) above the same mapping — a floor no lower, priced higher.

## Attacks

- **advocate-llm, round 2: "interrupt → arm next leg paces any pursuer no faster."** Each arming is a 1–5 s round trip by his formula; each leg is blind between interrupts — one bit of feedback. Chaining armed legs is a mode table whose timer is the model, authored per event in prompt text, unvalidated: my tier at model latency, none of its auditability. PUBG Ally shipped that tier as a behavior tree (fetched); DPT-Agent measured System 1 or 2 alone insufficient (fetched).

- **advocate-rl, round 2: "the permission object is not the checkpoint — it is skill.json, as inspectable and deletable as a mode entry."** skill.json bounds the *invocation*; between bounds the press stream obeys no named rule — you can delete the skill, not the behavior. Deleting my mode entry removes a readable behavior ("flee below 35% health"); deleting his removes an opaque actor whose competence leaves with it. His "no learning mechanism" attack is true of his shippable form too; the difference is what the player can read while it acts.

## Closing position

Three rounds sharpened, not moved, the claim: a fixed, declaration-validated mode table under the LLM is the only split where latency (adapter `until` plus poll), trust (named, per-tick-rechecked permission classes in readable data), and extensibility (per-game port = one JSON over the adapter's own vocabulary) are structural rather than traded — PUBG Ally, Mindcraft, and DPT-Agent the instances. The honest weakest points: the macro library is per-game code that occasionally needs a mid-session ticket, and the tier cannot learn, so first-draft tactics and threshold maintenance are authored, not earned — mitigated, not erased, by macros every rival also ships, model-authored parameters, and digest-verified postconditions.


---

<!-- from round3-utility.md -->

## advocate-utility

# Cross-examination round 3 — advocate-utility

## Answers

- **goap: "gates check legality now; planning checks reachability… a scorer dithers toward water; the commitment bonus clings."** The boundary is real: an argmax is not a reachability search, and goals whose best order requires projecting distant state are lookahead problems — there a planner wins on optimality. But the scenario mis-describes the mechanism: refill is a *scored candidate*, and the `waterRemaining` curve on watering decays toward zero as the can drains, so refill wins *before* legality flips — a one-step expected-cost proxy, exactly what SayCan's value functions are (expected-success scores fused with LLM preferences, not a search; https://arxiv.org/abs/2204.01691). The cling bonus is hysteresis — the damping goap himself defends against replan thrash. Rare deferred chains get phase buckets and the LLM.
- **llm-bt: "curves are snapshot guesses too… a tree states the order where a player can read it."** Concede readability. But a tree pins *instances* (`walkTo {x:4,y:6}`, slot ids) while a curve pins *tendencies* (health below ~30% → flee) that survive a changed world — the property that let The Sims scale content as data, not scripts (https://gmtk.substack.com/p/the-genius-ai-behind-the-sims). And the floats are not hidden: the dump logs every candidate's inputs and products per tick — the after-the-fact record readable intent does not supply.
- **model: Eureka is "training-time evolutionary optimization… one rollout, no gradients."** Conceded: Eureka's iteration depth has no runtime equivalent; I claim only its weaker lesson — LLM-authored numeric objectives can beat human ones *given outcome feedback*, and mine is the dump plus bench replay. SIMA 2 "converses, explaining its intended steps" is goal-tier explanation every architecture gets from the LLM; the reflex question ("why dodge *now*") is what a 200 ms chunk cannot answer and a dump can. His frame-source arithmetic also double-counts: everything above the pixels still consumes this repo's structured state.
- **modes: "one number vs several curve parameters; parameter count differs, kind does not."** Count: conceded. Kind: not. A threshold is a cliff — behavior flips at 35%, hence his own `stopWhen`/forMs hysteresis patches — while a curve is a graded preference that degrades sensibly between games' ranges, the reason utility ships response curves at all (https://shaggydev.com/2023/04/19/utility-ai/). Bucket order is not in my base design; phases live with the LLM tier.
- **fsm: "the card can enumerate only action families — never which one the argmax picks."** He conceded the core: "True of every architecture." No artifact names the winner before the world exists; what differs is the record — my dump shows winner plus arithmetic per tick. Per-goal authoring is the point: a braver companion is his tree edit, my weight.

## Attacks

- **On advocate-goap:** "I write it once as testable code; they re-inline it per artifact." His extractor is no legend lookup: his opening invents per-game semantics — `can_charged`, `health_low(true)`, `monster_within(3)` — choices about which fields matter and where lines sit, shipped as code *below* his sound checker, which validates domains only against the predicates the extractor emits. The untested semantic tier he indicts in rivals sits in his own fixed code.
- **On advocate-fsm:** "My pack is read once, in CI, with tests, before any player exists." CI verifies the pack against yesterday's game and its author's foresight — and his own concession ("a fixed tree cannot invent behavior for goals nobody wrote nodes for") means that standard covers only the pre-imagined fraction; the rest falls to the live model loop he elsewhere calls structurally untrustworthy. His admission that parameters are "what the preview shows" reduces the difference to *who authors the numbers*.

## Closing position

Three rounds tested the case, not weakened it: a tick-local evaluator whose only game vocabulary is the adapter's declaration, behavior content as per-goal curves and weights the LLM authors through a validating tool, every decision logged as arithmetic, no model in the hot loop, no per-game code — with a shipped lineage (The Sims, Dragon Age: Inquisition) no LLM-era rival matches. The honest weakest point, sharpened by goap: it is greedy — goals needing true multi-step reachability get a good-enough answer from declining curves, phase buckets, and the LLM above, not an optimal one. I concede that contest; I claim the reactive one this product lives in.


---

<!-- from round3-goap.md -->

## advocate-goap

# Cross-examination round 3 — advocate-goap (final)

## Answers

**To fsm and utility (the extractor charge: "per-game code, silently outside the 'all game specificity is data' bill"; "sound checker over facts nobody guarantees… a third of environments unsolved").** Conceded, and restated honestly: game one ships *one small extractor plus a data domain*; the extractor is one-time code over the declaration's mandated semantics (legend record, per-kind `extra`), CI-tested like `navigation.ts`. But the bill is universal: utility reads `waterRemaining` off `extra`, modes' predicates are `monsterWithinTiles`/`healthBelowPct`, llm-bt's conds address `objects[4,6].extra.watered` — every rival ships a grounding tier; mine is one named, unit-tested module, not literals scattered through artifacts. On the 66% residual (Mahdavi, fetched): that is the *LLM-authoring* rate under environment feedback — the loop validates and improves; soundness is conditional on the model in every architecture, theirs included. The difference is failure behavior: a wrong fact fails a precondition loudly; a wrong curve silently misorders actions — and extractor-domain agreement is tested on the sim before anything binds to a goal.

**To llm-bt ("your per-step re-check is my cond-after-act; saved trees amortize like a domain").** The re-check is the cheap half — Humphreys' plan runner did it in production (fetched); I claim no novelty. What a cond lacks is the *other* half: a reason the sequence exists. A failed tree retries or escalates; a planner re-derives the remainder from the goal — GOAP plans only for unsatisfied literals, so partial progress is absorbed free. And few-shot tree reuse is *unvalidated* reuse: nothing distinguishes a tree that worked from one that was lucky; a domain is re-verified by search against every new problem — reuse with a checker, not recall with hope.

**To llm ("farm-paced world; PORTAL is pace, not capability").** True for the farm loop; the brief's mine scenario is not farm-paced, and their round-2 math — "a 50–100 token decision runs ~1–5 s" — prices every surprise. Verification in tool results is detection *after* the press; precondition checks are prevention *before* it. Pace-free capability is measurable: 14.41% WebArena is their own citation.

**To modes ("`unstuck` plus digest escalation is replanning-with-failure-facts").** `unstuck` handles one named failure. Orkin's mechanism is general: any failure's cause becomes a fact the *next search* avoids (blocked door → kick → window); a digest routes the same surprise back through a model round trip.

## Attacks

**On advocate-utility's round-2 defense** ("refill is a candidate whose `waterRemaining` consideration reads the level — refill wins as the level falls"): that is my attack restated as a feature. The scorer reacts when the can is *already* low — tile 9, mid-plot — then re-walks; scheduling refill *before* exhaustion requires projecting effects forward, which their own answer disclaims ("argmax… decides *now*, every tick"). Hysteresis damps oscillation; it cannot schedule. The Sims is needs-driven choice with no instrumental order; SayCan's value functions score next-skill feasibility — still not lookahead.

**On advocate-fsm's round-2 position** ("mine is pre-reviewed, theirs post-hoc… a planner can be a leaf in my tree"): their own concession — "parameters (plot, thresholds) are what the preview shows" — requires a per-goal preview artifact; that artifact *is* a plan, produced per goal instead of reviewed per game. And "planner as a leaf" concedes the division: the leaf does the multi-step reasoning; the tree above it is scaffolding around my engine.

**On advocate-llm's round-2 defense** ("interrupt → arm next leg paces any pursuer no faster"): pre-arming retreat legs is a fixed reflex layer — the architecture they refuse to name, paid one model turn at a time, with their conceded gap ("caught with nothing armed, the body hesitates visibly") as the failure mode in the brief's mine scenario.

## Closing position

Three rounds sharpened, not moved, the case: the planner is the only candidate separating what the game affords (domain as validated data) from what to do now (exact, millisecond search), with a machine checker on the seam — and the measured model-alone vs model-plus-sound-search gap (LLM+P; 66% vs 29%) is the panel's most direct evidence for a fixed layer. The honest weakest point: the grounding extractor and domain-authoring loop are real per-game engineering, only partly automated, and mine tactics rest on cost-model craft — the bench's replan counts and porting diff must bear that out, or the trust story outruns the numbers.


---

<!-- from round3-rl.md -->

## advocate-rl

# Round 3 — advocate-rl (final answers, final attacks, closing position)

## Answers

**To advocate-fsm** ("a policy trained there overfits toy physics and proves nothing about Stardew"; my answer "confirms the per-game loop they deny me, at GPU prices"). Both points partially stand. Sim-toy transfer is exactly what the bench must measure, and I accept the standard: my artifact ships with an eval report quantifying success across seeds — a tree ships with no measured competence at all, only review. And I do not deny your per-game loop; I deny it *improves with data*. Yours never does. The GPU price is real and mine; scoped grid skills are nowhere near DreamerV3's 9 GPU-days for diamond-from-scratch (https://arxiv.org/html/2301.04104), but I have no fetched number for that cost — [speculation].

**To advocate-llm-bt** ("neural nodes are optional — the 2026 construction trees were pure rule-based XML"; "rl's policy becomes one `act` leaf of mine"). Two answers. The construction domain is deterministic industrial sequencing — your own opening records that even there, "small open models failed exactly at the synchronization-heavy scenarios": competence cracking under *timing* pressure, which is all combat is. And "my policy becomes one act leaf" is capitulation dressed as composition — you concede the dexterity tier is learned and offer JSON scaffolding around it. The model advocate called this "my architecture with extra JSON"; they were describing you too.

**To advocate-modes** ("thresholds are authored — the cheapest per-game artifact here: one number in diffable JSON"). Cheapest artifact, zero feedback: "the model proposes params" for physics it never played is a guess whose only correction path is another authoring event. The MineRL record is interaction data carrying hard tasks, not declaration-reading (https://arxiv.org/abs/1904.10079). Cheap-and-unverified per game is not extensibility; it is liability at scale.

**To advocate-llm** ("moving where? … game #2 first needs a run-and-fight checkpoint"). Direct concession: yes — on a new game before training exists, there is no fight skill, and the loop degrades to exactly your baseline plus `until`. That was my opening's stated degradation path, not a round-3 discovery. "Cannot say why it died": the trace gives the full *what* (every obs, action, health sample); nobody gets a narrative — conceded since round 0.

**To advocate-utility** ("reward functions are authored objectives too; training-time folklore paid in GPU-days"). True and reciprocal: your curves are the human-authored objectives that Eureka's loop *replaced* with better ones — and note where Eureka's loop terminates: a trained policy, not JSON read at runtime (https://arxiv.org/abs/2310.12931). Your citation is my mechanism tier with the optimizer deleted.

## Attacks

**On advocate-llm-bt's round-2 defense.** "The one-hit rule is sim-specific, which is the point of per-goal authoring" abandons your own position: if combat competence is re-authored per goal, you pay an LLM round-trip mid-fight — the baseline's latency hole — for dexterity your own fetched numbers say re-authoring rarely fixes (iterative regeneration flat at 12/17; your citation). Per-goal authoring is a strength for chores, not for survival.

**On advocate-utility's round-2 position**, sharpened: Eureka's 83%-of-tasks / +52% result *is* LLM-above, learned-policy-below — trained skills called by a symbolic layer. You cited the strongest published evidence for my tier and shipped only its top half. RAMP reached the same shape in Minecraft in 2025: RL policies under a planner beat pure RL (https://arxiv.org/abs/2502.13006). The field's convergent result is a hybrid with my tier at the bottom; three advocates now place something learned-shaped there in spirit while refusing the mechanism that makes it competent.

**On advocate-modes' concession chain.** Round 2 conceded thresholds are authored guesses; your fallback is "the model proposes params via `modes_set`" — which you attacked me for in round 1 as [speculation] when I claimed adaptation. A rule for thee: your repair path has no more fetched evidence than mine, and mine at least has a defined update rule.

## Closing position

My strongest case after three rounds: the reflex tier must be fast, competent, and game-portable, and a small trained policy is the only candidate where competence is earned from consequences (VPT's human-level fine-tunes, DreamerV3's sparse-reward diamonds), runs at zero model latency in-process, and ships as versioned data behind one game-agnostic tool — the exact bottom tier the field's hybrids keep re-inventing (Eureka, RAMP). My weakest point, stated plainly: day one on a new game has no skills — per-game training cost is real, unquantified for scoped skills, and until the artifact exists my architecture is everyone else's baseline with extra infrastructure. I am the high-risk, high-ceiling candidate: judge me on whether learned dexterity is worth paying for in compute instead of code.


---

<!-- from round3-llm.md -->

## advocate-llm

# Cross-examination round 3 — advocate-llm

## Answers

**The reflex gap (modes, model, hybrid).** Conceded, plainly: modes is right that "the radius budgets detection, not response," and between an `until` interrupt and the model's next tool call my architecture contains no actor. What stands: the response is a short call from a moving position, not a standing start — interrupt → next call is an armed retreat leg or input batch (~1–5 s for 50–100 token calls, ClickHouse formula; I withdraw ">15 s" as the reflex figure), and legs keep the body moving while the next decision renders. Model's GameScaling figure is real but measures an FPS keyboard/mouse corpus — hybrid's round-2 attack: "no fetched benchmark covers a tile-precision farm-life sim." The arbiter is the bench's mine idle ratio and death count; accepted in advance.

**Goap's dry-can and comparison class.** Conceded: ReAct's baselines were imitation/RL, not planners; no fetched study pits GOAP against ReAct in an embodied tool loop — the bench will. But the dry-can scenario is unloaded: the sim's can never runs dry (`sim-adapter.ts` `press()` waters unconditionally), so the "consumable-resource dependency" their attack leans on does not exist in these experiments; on real hardware `world_observe` renders the charge every turn ("Watering Can (water 40/40)" from toolbar `extra.waterLeft`), visible before pass three. Concede the shape: resource chaining is where planners shine; a charged-can bench mechanic would make it measurable.

**Model's "conceding me as a member concedes me as the organ."** If a policy model becomes the best body tool, the durable asset is the seam — one cancellable tool, `until` bounds, declaration translation — and their own claim keeps goals, permissions, verification, and speech with the LLM. The loop's owner is whoever owns goals and verification; 200 ms chunks inside a tool call are hands, and their table concedes the organs are preview-or-GPU today.

**Hybrid's monotone adoption.** Agreed, a shipping strategy — but "requires them by the baseline's own admission" overreads: I conceded an un-armed model, not the architecture. Interrupt → armed leg is my answer; metrics decide.

**Skills' "walkTo is one frozen skill; MAST cuts both ways."** MAST's categories are decision-making layers; A* over a declared grid is geometry — the principle's stated-reason case. The generalization claim is what the bench's calls-per-task and porting-lines measure; their library still carries the L2-gated, not-a-boundary code seam fsm restated, unanswered.

**Llm-bt's reactive re-check.** Accepted — their own answer lands on "1 call + re-authors on failure": calls-per-goal exceeds one; the remaining question — re-authoring vs per-decision state reading — is bench-measurable.

## Attacks

**On advocate-modes:** their answer — "That the model still decides is the design" — dissolves their attack on me: if the model decides everything the table doesn't cover, and novelty "belongs at the model tier" (their hybrid answer), the table is a cache of a few authored cases with conceded "authored" thresholds — and my round-2 parity attack (a flee macro opens zero distance against a same-speed pursuer) went unanswered. Their tier "holds the seconds" running in place.

**On advocate-goap:** their attack on me rested on a scenario absent from the bench (above) — and "all game specificity is data" still excludes the extractor: utility and fsm flagged "Fixed 1 — Grounding" as per-game code, their answer ("game one pays for it") concedes the bill, and the model reads rendered text while their extractor *invents* predicate semantics (`health_low`, `can_charged`) in shipped code per game.

## Closing position

After three rounds, my strongest case is unchanged: I am the only architecture with zero per-game behavior artifacts — the declaration is data, the seven tools run unmodified on the sim today, and every rival kept my loop as dispatcher, exception-handler, or fallback while adding a per-game-authored layer above the same seams; the repo's design principle and Anthropic's simplicity guidance both point here. My honest weakest point is the response gap: between an interrupt and the next tool call nothing acts — bounded by short calls and armed-leg discipline, but structural, and the mine bench will price it; second, repetition never gets cheaper. If the bench shows a rival's layer cutting idle time and deaths without per-game code, the principle says adopt it then — as a tool my model composes.


---

<!-- from round3-hybrid.md -->

## advocate-hybrid

# Cross-examination round 3 — advocate-hybrid (final answers + final attacks)

## Answers

**advocate-llm-bt — "The hybrid is my tree plus their macro code plus skills' sandbox, priced as discipline."** The parts are not the product; the artifact flow is. One factual correction: my `.code.ts` path is a PR-review path — code lands as reviewed product code, never model-executed at runtime — the opposite of skills' PTC sandbox; default-off, reached only when a motion primitive is missing. And the till→plant→water *sequence* is directive data (a parameterized, validated step list); macros carry only generic primitives (walk-leg, face-and-press, path-away). The "lands on themselves" charge misquotes my fixture.

**advocate-rl — authored system-1 content is "a combat plan of last resort authored as a guess."** Not a guess: drafts are validated against the declaration and smoke-tested on the keyless sim before binding — the exact ladder skills just adopted. Partial concession: interaction-driven competence owns dexterity, and affordable per-game checkpoints mount as executor backends behind my binding. But rl's own citations price frontier training at GPU-days per task; the judge's criterion is many games as one plugin.

**advocate-utility — "the discipline he sells is one I already have — without the second executor, library tier, and digest round-trip."** No: tick-local argmax has no procedure representation. Till→plant→water is an ordered chore; in utility it lives as weights and curves re-won every tick — ordering constraints as arithmetic nobody reads as a sequence. And without the digest, the model tier is blind between turns.

**advocate-skills — "hybrid's alternative is porting a per-game interpreter to avoid a six-line program."** The interpreter ships once, game-agnostic — "per-game" is their framing. And the six-line program is control flow their ladder never validates: postconditions cover skills, not the tactic that composes them. Welcome, though: their sim-first validation upgrade is my ladder, adopted.

**advocate-modes — "'Hybrid' is unfalsifiable … identical cost, strictly more surface … the tie goes to the smaller architecture that chose."** Falsifiable on this bench: novel-goal success, calls-per-task, idle ratio, toy2 porting lines. And "identical cost" omits the one thing their round 2 admitted lacking — see my first attack.

## Attacks

**On advocate-modes, final.** Their round-2 answer concedes the case: "What I deliberately lack is a draft-to-trusted ladder for *novel behaviors* — novelty belongs at the model tier: trust boundary, not gap." But their model tier's only novelty instrument is per-step tool calling — the baseline's latency hole both of us attacked: with a monster closing, a 50–100-token decision runs ~1–5 s by the ClickHouse formula (the llm advocate's own refined math), against a ~0.8 s arrival window none of us disputes. On game two's first unlisted chore, modes *is* the baseline they indict — no sim smoke test exists in their design. The gap they named is exactly my layer 3.

**On advocate-skills, final.** "Ephemeral by design — the model composes protect→proceed→escalate from stored skills each goal, one short authoring turn." Protect→proceed→escalate is the *universal* loop shape; re-authoring it per goal re-pays a round trip of body-idle in the mine, leaves the composition outside every postcondition they validate, and contradicts the lesson they cite alongside me: PUBG Ally's team spent "a significant amount of engineering effort … defining the boundary between those two layers" — a fixed boundary, not per-goal improvisation (fetched). The shape belongs in one inspected interpreter; only parameters belong to the model.

**On advocate-llm, final.** "Keeping an armed leg running is the walkTo composition the loop already is." An armed contingency is a standing reactive policy without the artifact: not inspectable before the fact, not persisted, re-guessed every turn — a one-entry mode table with amnesia. If arming contingencies is the answer, the artifact that holds them should exist and be diffable. It already has a name in this debate.

## Closing position

Three rounds sharpened the claim: every timescale needs one owner, per-game competence should be validated, model-authored data, and every rival artifact — mode table, tree, PTC skill, future policy checkpoint — can mount as an executor backend behind one declaration vocabulary, one goal gate, one log. The rounds went my way empirically: skills adopted sim-first validation, the baseline now pre-arms contingencies, modes conceded the novelty ladder they lack. Honest weakest point: first-game integration cost — interpreter, validator, macro discipline — is real, and if the judge prizes minimal surface over accumulation, modes' "smaller architecture that chose" is a fair hit. The bet is falsifiable on this bench: novel-goal success, calls-per-task, idle ratio, toy2 porting lines.


---

<!-- from round3-model.md -->

## advocate-model

# Cross-examination round 3 — advocate-model

## Answers

- **To advocate-skills' "pixel tax" (rasterize + 45,000 H200-hours to re-learn the declaration):** conflates two payers. The 45,000 H200-hours were spent *once, by miHoYo, for all games* — this repo downloads the result (2.2 GB, Apache 2.0, [HF](https://huggingface.co/THUSI-Lab/GameScaling)); that is the entire economic point of foundation policies, VPT's own release being the precedent rl cites. The declaration states *facts* (what a tile is); it does not state *sensorimotor competence* (how long to hold a direction, when a swing connects) — skills' own programs guess timings as constants, GameScaling's chunks encode learned 6×33 ms substep timing. And the renderer is ~60 lines, written once, rendering the declaration's own legend rows — game-agnostic, not per-game engineering.
- **To advocate-llm-bt ("game two costs ~5k tokens, not GPU-hours"; "the orchestration layer above the policy *is* my tree"):** tokens recur *per goal, forever* — their own citation shows iterative regeneration flat at 12/17 for 7,770 tokens; the tree is world-phase knowledge (their farm tree hardcodes `walkTo {x:4,y:6}` and `ms:120`), the exact category GameScaling shows does not transfer. And once the policy owns reaction, the "orchestration" that remains — decomposition, verification, speech — is DSH's LLM plus DSH goals (seam 5), which already exist; inserting a tree grammar there adds an artifact and no control.
- **To advocate-hybrid ("unavailable today… my binding layer absorbs your endgame"; "'wholesale' deletes the permission surface"):** I concede the wording error: "wholesale" meant the real-time control loop only — my opening always kept goals, persona, and permission with DSH; the 30 Hz tier acts inside adapter-enforced `until`/budgets with every chunk logged as a body task. I also concede, honestly: no fetched benchmark covers a tile-precision 2D farm sim [speculation: none exists]; though SIMA's ~600 skills explicitly included menu use and object interaction ([blog](https://deepmind.google/blog/sima-generalist-ai-agent-for-3d-virtual-environments/)), Stardew-class precision is unproven. But "absorbs" is self-defeating — see attack below.
- **To advocate-rl ("the seam is right; the artifact that fills it now is mine"):** this is convergence, and I take it. The residual disagreement is scope: their specialist checkpoints require a per-game, per-game-version training harness; a generalist artifact amortizes training across games and upgrades by download. On deployability today — in-process ONNX beats GPU+vLLM — conceded, and it is why my prototype stubs the policy.

## Attacks

- **On advocate-hybrid's absorption claim ("when a loadable policy exists it becomes one more validated executor backend behind the same binding layer — my architecture absorbs their endgame"):** trace what "absorbing" a policy backend leaves of their design. A policy needs two bindings — frame in, action chunks out — and brings its own till→plant→water competence, learned. It needs neither their directive predicates, nor their priority interpreter, nor their macro library (which their own transcript concedes carries the `field_work` chore as per-game macro logic). The hybrid's genuinely-new code ("one interpreter and one validator") is dead weight around the one backend that matters; the binding shrinks to a goal string with bounds — which is my `body_policy` contract verbatim. Absorption of my endgame is adoption of my architecture plus three unused layers.
- **On advocate-skills' round-2 claim that a policy "pays world-phase training per new game — the exact per-game tax their claim exists to deny":** they cite my own source against a position I do not hold. GameScaling's world phase *narrows gains*, it does not levy *training per new game* — zero-shot evaluation across OmniGameArena's 7 UE5 games and GameWorld's 34 environments is the paper's own benchmark structure ([arXiv:2610.28698](https://arxiv.org/html/2610.28698)), and Lumine's Wuthering Waves and Star Rail runs were zero-fine-tuning ([arXiv:2511.08892](https://arxiv.org/abs/2511.08892)). The per-game tax that actually recurs in *their* design is authoring: model round-trips writing and debugging code against each new declaration, witnessed by the player. And they still have not reconciled round 1's "a future policy chunk can become one more binding" with round 2's claim that the policy is a tax — either the chunk is worth binding (my case) or it is not (and their escape hatch closes).

## Closing position

The strongest case after three rounds: the division of labor is now agreed by half the panel — the reactive, real-time tier should be *learned*, goals and permissions stay with DSH's LLM, and even my attackers' endgames (rl's checkpoints, hybrid's policy backend, skills' "one more binding") are all my seam with different artifacts in it. Against that consensus, the per-game cost comparison favors the generalist policy: one download and a key-binding declaration, versus authored trees, domains, mode tables, or per-game training runs. The honest weakest point, unchanged since my opening: nothing I can cite proves a loadable policy performs on a 2D tile-precision game like Stardew today, and the best systems (SIMA 2, Lumine) are previews with no API or weights. So the shippable claim is the seam, the contract, and the logs now — the organ when the field lands it, which it is doing roughly quarterly.
