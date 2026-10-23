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
