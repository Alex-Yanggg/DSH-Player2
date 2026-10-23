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
