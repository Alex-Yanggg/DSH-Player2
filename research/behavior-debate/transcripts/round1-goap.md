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
