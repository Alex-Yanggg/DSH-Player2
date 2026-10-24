# RSI research notes — RSIAgent and the Zhipu/Tsinghua open-source release

Research date: 2026-10-24. Compiled from live web fetches (see `sources-rsi.json` for every URL actually fetched).
Rule followed: nothing below is invented; anything not directly verified is labeled **speculation** or **uncertain**.

---

## Target 1 — arXiv 2609.15364: RSIAgent

### Bibliographic facts
- **Exact title:** "RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments" — https://arxiv.org/abs/2609.15364
- **Authors:** Sibo Zhu, Shicheng Fan, Xinyue Wang, Wenyi Wu, Kun Zhou (corresponding author and project leader), Biwei Huang.
- **Affiliations (from full text, https://arxiv.org/html/2609.15364v2):** Aether AI; University of California San Diego; University of Illinois Chicago. Several first authors marked as interns at Aether AI.
- **Is it Zhipu AI / Z.ai?** **No.** No affiliation with Zhipu AI, Z.ai, or Tsinghua appears anywhere on the abstract page or in the full text. GLM-5.3 and Kimi-K3 are only *used* as component models, not affiliated. (Any assumption that this is Zhipu work is wrong.)
- **Dates:** v1 submitted 2026-09-14, v2 revised 2026-09-18. Categories: cs.AI, cs.CL, cs.CV. Comments: "50 pages", no code URL given on arXiv.

### How the paper defines RSI for agents
- RSI here is **"recursive self-improvement of an agent system in a new environment without updating model parameters"** — the agent autonomously explores, builds a persistent memory M of reusable environment-specific knowledge (including "reusable causal relationships between actions, conditions, and consequences"), then reuses that memory on downstream tasks. Weights stay frozen; what improves is **memory/context only** (abstract + intro, https://arxiv.org/abs/2609.15364).
- Framing question: can an agent "autonomously discover causal relations from a new environment into a reusable memory to improve itself?" (full text, https://arxiv.org/html/2609.15364v2).

### Concrete mechanism / loop
Three agent roles in a training-free multi-agent harness (built on a structured workflow called StructAgent), plus a persistent memory:
1. **Curriculum agent** — decides what to explore next: generates practice tasks, selects "prerequisite skills, informative variants, failure-driven practice, and stress-test cases", and decides when to stop.
2. **Actor agent** — executes code-as-policy actions (Python/Bash programs); owns and updates the evolvable memory, but only after verification.
3. **Verifier agent** — independent evaluator grounded in **environment feedback**, deliberately isolated from the actor's private reasoning; returns PASS/FAIL (and UNVERIFIED at target-task time).

Two-stage exploration strategy:
- **Stage 1 — Broad Recursive Self-exploration (BRS):** parallel exploration waves; the curriculum proposes multiple tasks across directions; snapshot-and-reconcile memory updates after each wave.
- **Stage 2 — Deep Recursive Self-exploration (DRS):** sequential, escalating difficulty targeting "corner cases, hidden constraints, and boundary conditions".
- **Test-time reuse:** memory is **frozen** (hash-checked), curriculum disabled; only the actor–verifier loop runs on the target task, with no writeback.

**What gets improved:** the memory files. **Signals driving improvement:** verifier verdicts, execution feedback, environment observations, and the actor's learning diagnosis handed to the curriculum agent (https://arxiv.org/html/2609.15364v2).

### Memory structure
- Free-form, actor-authored files with "no required schema, file count, or length". Two-step learning: **distillation** (extract procedures, constraints, failure lessons) then **reconciliation** (revise contradictions, qualify unsupported claims).
- Case-study growth figures: T044 memory grew from ~110 kB (10 BRS projects) to 316,541 bytes at freeze; T049 89,086→141,312 bytes; T065 159,065→281,085 bytes (https://arxiv.org/html/2609.15364v2).

### Benchmarks and headline results (Table 1, https://arxiv.org/html/2609.15364v2)
- Benchmarks: **OSWorld 2.0** ("0808 offline", 82 tasks; abstract calls it OSWorld-v2) and **ALE Near-term** (Agent's Last Exam, 67 tasks), scored partial/binary. Configuration: **GLM-5.3 as actor; Kimi-K3 as verifier and curriculum agents.**
- **RSIAgent:** OSWorld 78.98 / 42.68; ALE 84.82 / 50.75.
- **RSIAgent (w/o RSI):** OSWorld 71.97 / 37.80; ALE 83.75 / 49.25 → RSI loop adds ~7 points partial on OSWorld.
- **GPT-6 Astra:** OSWorld 72.60 / —; ALE 82.26 / 52.24 (RSIAgent exceeds it by 6.38 partial on OSWorld; GPT-6 still leads ALE binary 52.24 vs 50.75).
- **Claude Opus 5:** 70.19 / 34.72; 79.54 / 46.27. **GPT-5.6 Sol:** 64.13 / 28.10; 78.82 / 47.76. Raw **Kimi-K3:** 58.30 / —; 71.60 / 40.30.
- Abstract headline: "enabling Kimi-K3 and GLM-5.3 to outperform frontier closed-source models including GPT-6" (https://arxiv.org/abs/2609.15364).
- **Caveat the paper itself flags (Appendix 10.4):** the RSI comparison rows mix reported RSI scores (41 on OSWorld, 19 on ALE) with retained baselines — "not a matched-protocol comparison."

### Ablations
- Four-task stage ablation (T080, T085, T089, T106): full RSI mean 74.54%; broad-only (w/o DRS) 65.52%; deep-only (w/o BRS) 56.50% — both stages contribute; deep-only fell below baseline on two tasks.
- RSI rounds (T044, T049, T065): by step 8, scores of 100%, 80%, 100%.
- Games (40 GameCraft-Bench tasks): GLM-5.3-Flash generator Overall 30.55 baseline → 38.25 Play2Code → 44.73 w/o RSI → **48.72 full RSIAgent**; Kimi-K2.6 generator: 31.28 → 46.37 (https://arxiv.org/html/2609.15364v2).

### Stated limitations (Section 7)
1. Substantial test-time compute cost. 2. Dependence on exploration budgets, stopping policies, and memory quality. 3. The model-based verifier can make incorrect judgments that propagate. 4. Components are not fully isolated per environment. Plus ethical risks (unintended actions, unauthorized access, privacy leakage), mitigated by running in controlled environments.

---

## Target 2 — the open-source agent RSI release this week (2026-10-17 → 2026-10-24): HarnessPro

**Found: yes.** The release is **HarnessPro** — "Recursive Harness Self-Improvement with Pareto Optimization for Performance-Cost Trade-offs".

### Identification trail
- Chinese tech media (QbitAI via Sohu), 2026-10-23: "智谱唐杰署名RSI新成果开源！Agent自我进化成本还狂降53%" ("Zhipu's Tang Jie signs a new open-source RSI result; agent self-evolution cost cut 53%") — https://www.sohu.com/a/1091850030_610300
- Paper: **arXiv 2610.26770**, v1 submitted 2026-10-19, v2 2026-10-20, cs.LG/cs.CL, "41 pages, 4 figures, 4 tables, under review" — https://arxiv.org/abs/2610.26770
- Code: **https://github.com/pzs19/HarnessPro** (public, MIT license in repo, plus THIRD_PARTY_NOTICES.md; 65 stars / 7 forks / 1 commit as of 2026-10-24) — https://github.com/pzs19/HarnessPro
- Project page: https://pzs19.github.io/HarnessPro/

### Is it actually "Zhipu's" release?
- Full-text affiliations (https://arxiv.org/html/2610.26770v2): Zhuoshi Pan, ZhiYuan Feng, H. Vicky Zhao, Jie Tang — Tsinghua University; Yukuo Cen — **Z.AI**; Honglin Lin — Shanghai Jiao Tong University; Junru Lu — University of Warwick; Zhongxia Chen, Shuo Yang — Kling AI (equal contribution/corresponding).
- So **Z.AI (Zhipu) is among the affiliations** via Yukuo Cen, and co-author Jie Tang is Tsinghua CS professor widely described (including by QbitAI) as Zhipu AI's chief scientist. But the repo lives under a personal account (`pzs19`), **not** https://github.com/zai-org — I checked zai-org on 2026-10-24 and none of its 53 repos mentions RSI/self-evolution (https://github.com/zai-org). Whether Zhipu AI as an institution backs this release is **uncertain**; "Tsinghua-led with a Z.AI co-author and Zhipu chief scientist signing" is the accurate framing.

### How the paper defines RSI
- A **harness** is "the software infrastructure that manages interactions between a large language model (LLM) and its environment" — "prompts, tools and skills, context and memory mechanisms, hooks, and verification policies".
- RSI = using "trajectories from previous tasks to guide harness evolution and improve performance on future tasks" (https://arxiv.org/html/2610.26770v2). What improves is the **harness artifacts** (instructions, tools, runtime policies, verification helpers), not weights and not a memory blob.

### Mechanism / loop (Algorithm 1)
Per epoch, four specialized agents over G=3 rollouts per candidate harness per training task:
1. **Trajectory analyzer** — diagnoses execution traces: identified problems, their performance/cost impact, evidence with file paths/event ranges; capped at 64K tokens.
2. **Evolution planner** — proposes three plans per candidate under cost-focused (I1), balanced (I2), performance-focused (I3) instructions; compares candidates via code diffs; plans must be "generalizable, rather than task-specific".
3. **Harness editor** — implements each plan in a separate Git-committed workspace as an executable candidate.
4. **Test synthesizer** — generates executable tests from task descriptions plus initial-harness trajectories, generated **once and fixed** throughout (label-free: no ground-truth solutions, no official tests). A preliminary experiment shows failure-case recall rising from **41.7% to 83.3%** vs direct LLM judgment, because LLM judges are overly optimistic (this is RHO's selection mechanism). (The Sohu article says "10 executable unit tests per task"; the fetched paper text does not state a per-task count.)
- **Selection:** Pareto filtering (drop candidates below the initial pass-rate floor or dominated), then normalized weighted squared-distance selection J_m(h)=α_m·d_perf²+β_m·d_cost² with weights (1,2)=Lite, (1,1)=Medium, (2,1)=Heavy; argmin picks each tier's representative, and selected harnesses feed the next epoch. Objective: min(−PR(h), C(h)) s.t. PR(h) ≥ PR(h0).
- **What gets improved:** the entire harness. **Signals:** pass/fail on synthesized tests, token-based cost, latency.

### Benchmarks and headline results (Table 2, GPT-5.5 × Codex; also GLM-5.2 × Claude Code)
Benchmarks: **Terminal-Bench 2** (59 test tasks), **SWE-Bench Pro** (100), **ProgramBench** (100).
- Terminal-Bench 2: Vanilla 69.5%/$0.89/260s; RHO 76.3%/$1.09; **Heavy 80.8%±1.0/$0.72** → +4.5 pp and 33.9% cheaper than RHO.
- SWE-Bench Pro: Vanilla 59.0%/$1.88; RHO 80.0%/$2.68; **Medium 79.0%±1.0/$1.26** → 53.0% cost cut at −1.0 pp; Heavy 80.7%±0.6/$1.97.
- ProgramBench: Vanilla 60.3%/$2.65; RHO 68.8%/$3.59; Heavy 69.6%±1.03/$2.95 (17.8% cheaper).
- GLM-5.2 × Claude Code, Terminal-Bench 2: Vanilla 74.6%/$0.92; RHO 78.0%/$1.00; Heavy **81.4%±1.7/$0.62**.
- Abstract headline: Heavy mode gains **+2.0 pp average pass rate** and cuts per-task cost **26.1%** vs RHO, across all three benchmarks and both model setups (https://arxiv.org/abs/2610.26770).
- Media frame: existing RSI makes agents stronger but costlier (SWE-Bench Pro per-task $1.88 → $2.68, +42.6% for RHO); HarnessPro makes evolution cheaper each epoch ("Agent越进化越便宜") — https://www.sohu.com/a/1091317913_121119001 (found via search; not fetched — number cross-checked on the fetched article and arXiv page).

### Ablations (Table 3)
- Removing the planner: cost up, pass rate down (SWE-Bench Pro Medium 79.0%→73.0%, $1.26→$1.42). Removing the test synthesizer: pass rates drop 3.4–10.0 pp.
- Single fixes (RHO + dynamic routing / + budget hooks / + low reasoning effort) each cut cost but are Pareto-dominated by fully evolved harnesses — the loop's synergy, not any one trick, produces the gains.
- Evolved harnesses learned: dynamic routing across 5 reasoning-effort presets, runtime budget hooks (warnings at 14/26 tool calls, blocking at 44), and log folding/compression preserving prompt-cache reuse (https://www.sohu.com/a/1091850030_610300, https://arxiv.org/html/2610.26770v2).

### License and limitations
- **License:** repo is **MIT** (GitHub LICENSE page); arXiv lists CC BY 4.0 for the paper. Repo layout: `harnesses/` (nine harnesses across three benchmarks), `scripts/`, `splits/`, `src/rho/`, `tests/`, `third_party/`; requires Linux, Python 3.12/3.13, uv, Docker, Codex CLI 0.147.0 (https://github.com/pzs19/HarnessPro).
- **Limitations:** no dedicated limitations section in the main text. Noted constraints: latency only an auxiliary metric; Pareto filtering may retain "fewer than three distinct harnesses"; routing calls "can be net-negative on very small tasks". Appendix content (evolved artifacts) truncated in fetch.

### Z.ai's closest official RSI work (context — *not* the release itself)
- Z.ai blog, 2026-09-17: "Toward Recursive Self-Improvement: How GLM Built Its Inference Infrastructure" — a GLM-5.3-powered "Infra Agent" that helped build Zhipu's own inference infrastructure on a 100k-GPU cluster (found via search; not fetched): https://z.ai/blog/glm-built-its-inference-infrastructure and coverage https://news.ifeng.com/c/8wV6HUadv9Z.
- Other RSI work encountered that is **not** the release: RSIAgent (Target 1, Aether AI/UCSD/UIC); AIDE² (arXiv 2609.26457, agent improving its own code); RSI-Harness (reported Sept 2026, meta-RSI: Model/Data/Harness-RSI); lobehub/awesome-rsi (curated map, https://github.com/lobehub/awesome-rsi). All from search snippets only.

### Search queries tried for Target 2 (4 distinct)
1. "Zhipu RSI agent open source recursive self-improvement October 2026"
2. "HarnessPro \"harness self-improvement\" Pareto agent Tsinghua \"Jie Tang\""
3. "Zhipu AI self-improving agent release October 2026 open source GLM"
4. "智谱 唐杰 HarnessPro 递归自我改进 开源 agent 进化"

---

## Relevance to a self-improving game companion (DSH-Player2)

What transfers, mapped to our architecture and product rules:

1. **Verifier-in-the-loop, isolated from the actor.** RSIAgent's verifier only trusts environment feedback, never the actor's own reasoning, and returns PASS/FAIL. For Player2: a lesson or plan should only be retained when the *game's own observable state* confirms the outcome — never on the model's claim that it worked. This directly matches our rule against replacing a missing/invalid native result with a plausible local fallback; the verifier should surface the missing signal as failure, not paper over it.

2. **Actor-authored, free-form memory with distill + reconcile, then freeze.** RSIAgent's lesson library has no schema, grows via distillation of procedures/constraints/failure lessons, gets reconciled for contradictions after each wave, and is hash-checked and frozen before reuse. For Player2: a per-save "playbook" the companion writes after verified sessions — snapshot-and-reconcile prevents lesson drift and self-contradiction, and freezing before reuse gives an inspectable, testable artifact (fits "explicit, inspectable game permissions").

3. **Curriculum agent with broad-then-deep exploration.** Generate practice tasks across the whole game system first (broad), then targeted hard cases — boundary conditions, hidden constraints (deep). The ablation (broad-only 65.52%, deep-only 56.50%, full 74.54%) says both are needed, and deep-only can fall *below* baseline — a caution against only drilling hard cases. For Player2: structured practice of game skills (fail-driven practice on the cases the companion itself failed), with an explicit stopping policy.

4. **Improve the harness, not the model — and keep cost in the loop.** HarnessPro shows the highest-leverage self-improvement surface is the harness: instructions, tool configs, hooks, verification policies — evolved from trace diagnosis against *both* performance and cost (Pareto selection). For Player2/DSH: iterate persona instructions, tool/permission configs, and checklists from play-session traces, and treat token cost as a first-class objective so the companion doesn't get smarter only by getting more expensive (RHO's +42.6% cost vs HarnessPro's −26.1% is exactly the trap to avoid).

5. **Self-written executable tests before accepting a change.** HarnessPro's test synthesizer turns subjective self-grading (41.7% failure recall) into executable checks (83.3%). For Player2: before a modified routine/lesson is accepted, the companion should generate concrete, re-runnable verification steps a human (or a script) can run in the game — an inspectable acceptance gate, aligned with "every user-visible capability needs a clear permission boundary, failure behavior, and way to verify it".

6. **Causal action→condition→consequence lessons.** RSIAgent explicitly distills "reusable causal relationships between actions, conditions, and consequences" — precisely the shape of game knowledge (e.g., "if it rained yesterday, crops grow today"). That is a better memory unit for a game companion than raw transcripts.

7. **Cautions.** (a) Model-based verifier errors propagate (RSIAgent limitation #3) — in a game with real stakes, keep a human-visible log of verdicts and allow overrides. (b) Test-time compute cost is "substantial" — budgets and stopping policies must be explicit. (c) HarnessPro has no dedicated limitations section and is "under review" with a single-commit repo (65 stars) — early-stage; treat its numbers as unreplicated. (d) RSIAgent itself flags its RSI comparison as "not a matched-protocol comparison" — don't quote 78.98 vs GPT-6 without that caveat. (e) Both papers' autonomy loops ran in controlled environments; our product rules additionally forbid unbounded unattended farming, so any transferred loop must be scoped by explicit game permissions.
