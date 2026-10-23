# Finalists

Picked by the orchestrator after the three cross-examination rounds, by the
criteria below. The advocates do not pick a winner, and neither does this
file — a separate judge does, from `../REPORT.md`.

## Criteria (in order)

1. **DSH-plugin fit (hard gate).** The architecture must be implementable
   behind the seven seams (tools, prompt sections, turn-flow hooks, setup
   callback, DSH goals, body port + helper libraries, local files) with no
   second harness and no side process owning behavior. Every advocate mapped
   their seams in their opening; round attacks probed the honest ones.
2. **Extensibility across many games while staying a DSH plugin** — the
   judge's top-weighted criterion. Evidence used: the per-game surface in
   code vs data vs runtime-authored artifacts; the toy2 port result (a second
   toy game with a different state and input vocabulary); the porting line
   counts in `../results/loc.json`.
3. **Bench promise on both scenarios** — pilot signals from the smoke runs
   (success on farm and mine, model calls, reactivity under monsters), later
   confirmed by the full matrix in `../results/metrics.csv`.
4. **Claims that survived cross-examination** — which of the advocate's load-
   bearing claims were answered, conceded, or refuted across rounds 1-3.
5. **Span** — the finalist set should span the design space (an incumbent
   tool-loop, a reactive data-driven executor, a planner, an accumulating
   library, a composed architecture) so the judge can trade them off rather
   than choose among clones.

## The five finalists

| Finalist | Advocate | Why it is here (one line each) |
| --- | --- | --- |
| **llm** — pure LLM tool calling | advocate-llm | Today's shipped architecture and the incumbent anchor: zero per-game code, the adapter declaration is the only per-game surface, and it was the only LLM-bound approach that solved toy2 interactively (36 calls); its latency/idle and mine-survivability weaknesses survived rounds but did not disqualify it. |
| **modes** — data-driven reflex/modes layer under the LLM | advocate-modes | The reactive representative: interrupting priority modes over the port's `until`/fastState substrate, strongest on the mine scenario, per-game cost is a validated JSON table; its toy2 authoring failure is carried into the report as an open risk. |
| **goap** — GOAP planner with LLM goal translation | advocate-goap | The planner representative: the fixed planner composed toy2's lock-and-key dependency in one goal-translation call where every authored-data approach failed; pays a real port cost (213 lines, counted) that the judge can weigh. |
| **skills** — LLM-written code skills + library | advocate-skills | The accumulation representative: Voyager-style amortization (author once, retrieve at zero calls — visible in the per-seed records), runs on DSH's own PTC seam; sandbox-trust and authoring-failure risks survived as honest open questions. |
| **hybrid** — LLM directive + reflex executor + skill library | advocate-hybrid | The composition representative: one authoring turn emits table + skills over one shared vocabulary with validation before live binding; empirically the most repair-churn in the bench, which is itself decision-relevant data. |

## Not finalists (kept as reference rows in the metric table)

- **llm-bt** (advocate-llm-bt): strong BT-as-data evidence (LLM-BT, PORTAL),
  but in this bench it converged to the same shape as modes with a heavier
  artifact, its own cited numbers lean on human-in-the-loop repair, and its
  toy2 authoring failed like the other one-shot authored-data approaches.
  Its prototype and numbers are reported for completeness.
- **handcoded** (advocate-fsm): the fixed-code reference point — zero model
  calls, fastest and most reliable on both scenarios, but a full controller
  rewrite per game (49 new lines for toy2, zero transfer), which is the exact
  extensibility bill the judge weighs against it.

## What the finalists owe the judge

Each finalist's strongest arguments, the attacks that survived against it, its
row in the metric table (real API calls, marked), its toy2 port cost, and its
open risks — all in `../REPORT.md`. No winner is picked here.
