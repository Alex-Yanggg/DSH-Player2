# Notes: six classic agent-learning papers (compiled 2026-10-24)

Research notes for the AI-companion architecture study. Every paper's arXiv id was verified against its `abs` page the day of compilation; full-text details come from the arXiv HTML / ar5iv versions listed in `sources-classics.json`. Nothing here is quoted from memory alone — numbers carry inline URLs. Anything not directly supported by a fetched page is labeled **speculation** or **uncertain**.

---

## 1. Reflexion: Language Agents with Verbal Reinforcement Learning

- arXiv: [2303.11366](https://arxiv.org/abs/2303.11366) (v1 2023-03-20, v4 2023-10-10; verified on abs page).
- Authors: Noah Shinn, Federico Cassano, Edward Berman, Ashwin Gopinath, Karthik Narasimhan, Shunyu Yao ([abs page](https://arxiv.org/abs/2303.11366); the NeurIPS proceedings record lists an earlier author order with Beck Labash — [proceedings page](https://proceedings.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html)).
- Venue: NeurIPS 2023 (37th Conference on Neural Information Processing Systems — [proceedings page](https://proceedings.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html); the arXiv comments field itself does not state a venue).

### Core mechanism ([full text](https://ar5iv.labs.arxiv.org/html/2303.11366))
- Three roles in a trial loop: an **Actor** (LLM, e.g. CoT or ReAct variant) acts; an **Evaluator** scores the trajectory (exact match, hand-written heuristics, an LLM judge, or — for code — self-generated unit tests, max 6, AST-filtered); a **Self-Reflection model** turns the trajectory + sparse reward into verbal lessons ("amplifies" the signal).
- **Stored:** only the verbal reflections go into an episodic memory buffer (raw trajectories are not persisted). Short-term memory = the current trajectory.
- **Retrieved when:** at the start of every new trial of the *same task*; the Actor conditions on short-term + long-term memory.
- Memory is bounded: a sliding window keeping the most recent Ω reflections, "usually set to 1-3" (3 for AlfWorld/HotPotQA, 1 for programming). Paper suggests future work could move to vector-embedding or SQL storage.
- Loop repeats until the evaluator passes or max trials (up to 12 trials on AlfWorld; HotPotQA stops after 3 consecutive failed attempts).

### Headline numbers
- HumanEval pass@1 **91.0%** vs GPT-4's 80.1% ("surpassing the previous state-of-the-art GPT-4 that achieves 80%", [abs](https://arxiv.org/abs/2303.11366); full text: 91.0 vs 80.1, CodeT+GPT-3.5 at 65.8).
- ALFWorld: +22% absolute over strong baselines; ReAct+Reflexion solved **130/134** tasks ([full text](https://ar5iv.labs.arxiv.org/html/2303.11366)).
- HotPotQA: ~+20% absolute over baselines (0.60 → 0.77 in one setting).
- Cost of the machinery: without self-reflection, Rust HumanEval (50 hardest, GPT-4) stays at 0.60 vs 0.68 full Reflexion — "blind trial and error debugging techniques without self-reflection are ineffective" ([full text](https://ar5iv.labs.arxiv.org/html/2303.11366)).

### Stated limitations / failure modes ([full text](https://ar5iv.labs.arxiv.org/html/2303.11366))
- Relies on LLM self-evaluation; no formal success guarantee; can land in "non-optimal local minima".
- Flaky unit tests cause false positives (MBPP Python FP rate 16.3% vs HumanEval 1.4%), which explains its only regression (77.1 vs GPT-4's 80.1). False negatives are preferred since reflection can catch bad tests.
- **WebShop: gave up after only 4 trials with no improvement** — the paper says Reflexion "is unable to solve tasks that require a significant amount of diversity and exploration".
- Weak models don't benefit: starchat-beta showed no gain (0.26 → 0.26); self-correction appears to be an emergent capability of stronger models.

### Memory scope
**Within-episode**: reflections persist across trials of one task instance and are discarded between tasks. No cross-task library.

---

## 2. Voyager: An Open-Ended Embodied Agent with Large Language Models

- arXiv: [2305.16291](https://arxiv.org/abs/2305.16291) (v1 2023-05-25, v2 2023-10-19; verified on abs page).
- Authors: Guanzhi Wang, Yuqi Xie, Yunfan Jiang, Ajay Mandlekar, Chaowei Xiao, Yuke Zhu, Linxi Fan, Anima Anandkumar ([abs page](https://arxiv.org/abs/2305.16291)).
- Venue: arXiv preprint; the abs page and the official repo README cite no peer-reviewed venue ([GitHub README citation is `journal = {arXiv preprint arXiv: Arxiv-2305.16291}`](https://github.com/MineDojo/Voyager)). A TMLR submission record exists on OpenReview ([forum](https://openreview.net/forum?id=ehfRiF0R3a)) but its acceptance status could not be verified from fetched pages (**uncertain**; the repo fetched on 2026-10-24 shows ~7.3k stars).

### Core mechanism ([full text](https://ar5iv.labs.arxiv.org/html/2305.16291); [project page](https://voyager.minedojo.org) linked from the abs page)
- Three components, GPT-4 used as a black box (no fine-tuning):
  1. **Automatic curriculum**: GPT-4 proposes the next task from the agent state (inventory, nearby blocks/entities, biome, health, ...), completed/failed task lists, and a directive to "discover as many diverse things as possible" — described as "an in-context form of novelty search", unfolding bottom-up. A warm-up schedule drip-feeds state info (nearby entities after 5 tasks, biome after 10, health/hunger/time after 15). Tasks must be verifiable from agent state; repetition is allowed only for resource collection. If a task fails after 4 rounds of code generation it is parked on a failed list and the curriculum moves on (retry possible later).
  2. **Skill library**: each skill is executable JavaScript (Mineflayer APIs) stored in a vector DB — key = embedding of the program description (GPT-3.5, ada-002), value = the code. On a new task the **top-5 relevant skills** are retrieved as context. New skills are generated by GPT-4 (guided by control-primitive APIs, retrieved skills, prior code), then a separate **GPT-4 self-verification critic** checks success and critiques failures; only verified programs are committed. Complex skills compose simpler ones, which "compounds the agent's capabilities rapidly over time and alleviates catastrophic forgetting".
  3. **Iterative prompting**: per task, a loop over three feedback types — environment feedback, execution errors from the code interpreter, and self-verification — until success; after 4 stuck rounds the curriculum is queried for a new task.
- **Stored:** the code skill library (cross-task) + within-task trajectories/prompt state. **Retrieved when:** every new task (top-5 by description-embedding similarity), and during skill generation.

### Headline numbers ([abs](https://arxiv.org/abs/2305.16291), [full text](https://ar5iv.labs.arxiv.org/html/2305.16291))
- "**3.3x more unique items**" (63 items within 160 prompting iterations), "travels **2.3x** longer distances", and unlocks tech-tree milestones "up to **15.3x faster**" than prior SOTA.
- Voyager is "the only one to unlock the diamond level" (102 iterations, 1/3 seeds); AutoGPT/ReAct/Reflexion got 0/3 on diamond.
- Zero-shot to a **new world** with cleared inventory: solves all 4 test tasks 3/3 seeds (e.g. diamond pickaxe in 19±3 iterations) while ReAct/Reflexion/AutoGPT get 0/3; AutoGPT given Voyager's library partially succeeds (compass 2/3) — the library is "a plug-and-play asset".
- Ablations: random curriculum drops discovered items by **93%**; removing self-verification costs **−73%**; GPT-3.5 instead of GPT-4 for code generation yields **5.7x fewer** unique items.

### Stated limitations ([full text](https://ar5iv.labs.arxiv.org/html/2305.16291))
- **Cost**: heavy GPT-4 usage — "It is 15x more expensive than GPT-3.5"; GPT-3.5 and open models "cannot provide" the needed code quality.
- Gets stuck on some skills; self-verification can miss success signals (spider string example).
- Hallucinations: curriculum proposes nonexistent items ("copper sword"); GPT-4 invents API calls.
- No visual perception (text-only GPT-4 API at the time); 3D builds (Nether portal, house) needed human feedback as critic/curriculum.

### Memory scope
**Cross-task** (and cross-world): the skill library persists across the entire open-ended run and was demonstrably transferred to fresh Minecraft worlds.

---

## 3. ExpeL: LLM Agents Are Experiential Learners

- arXiv: [2308.10144](https://arxiv.org/abs/2308.10144) (v1 2023-08-20, v3 2024-12-20; verified on abs page).
- Authors: Andrew Zhao, Daniel Huang, Quentin Xu, Matthieu Lin, Yong-Jin Liu, Gao Huang ([abs page](https://arxiv.org/abs/2308.10144)).
- Venue: AAAI-24 — abs comments field: "Accepted by the 38th Annual AAAI Conference on Artificial Intelligence (AAAI-24)" ([abs page](https://arxiv.org/abs/2308.10144)).

### Core mechanism ([full text](https://ar5iv.labs.arxiv.org/html/2308.10144))
- **Experience-gathering phase (training tasks)**: a ReAct base policy runs each training task up to Z attempts with Reflexion-style self-reflection on failure (max 3 retries). Every trajectory goes into an experience pool; success/failure pairs on the same task become comparison data.
- **Insight extraction**: an insight LLM (gpt-4-0613; gpt-3.5 "hallucinate[d] more") iteratively processes success/fail pairs and lists of L successes across tasks (L=8 HotpotQA/ALFWorld, L=4 WebShop) and edits a natural-language insight set via four operators: **ADD, EDIT, UPVOTE, DOWNVOTE**. New insights start with importance count 2; edits/upvotes increment, downvotes decrement; **count reaching zero removes the insight** (guards against misleading trajectories).
- **Inference (single attempt, no retries)**: task spec is augmented with the concatenated insight list; a Faiss + all-mpnet-base-v2 kNN retriever (k=6 HotpotQA, k=2 ALFWorld/WebShop) pulls the **top-k most task-similar successful trajectories** as in-context examples.
- **Transfer**: insights from a source domain are re-grounded with a few target-task demos (via GPT-4) before use.
- The paper's own analogy: "a student studying for an exam and then taking it on a single attempt".
- **Stored:** insight list + pool of trajectories (including manual few-shot seeds). **Retrieved when:** at test time, per new task (insights always; trajectories by kNN task similarity).

### Headline numbers ([full text](https://ar5iv.labs.arxiv.org/html/2308.10144); gpt-3.5-turbo-0613 actor, greedy)
- ALFWorld: **59.0 ±0.3 vs ReAct 40.0 ±0.3** — and beats Reflexion (54% at retry-3) despite using one attempt.
- HotpotQA: **39.0 ±1.7 vs ReAct 28.0 ±1.4**; roughly matches Reflexion (40% at R3).
- WebShop: 0.701 reward vs ReAct 0.665.
- Ablations: insights-only 36% / retrieval-only 31% on HotpotQA (50%/55% on ALFWorld) vs 59.0 combined — both mechanisms are needed. Reflections fed as insights *hurt* (29.0 ±0.4 vs 39.0). Random-trajectory retrieval 42.5 vs task-similarity 59.0 on ALFWorld.
- Cross-domain transfer HotpotQA → FEVER: 70 ±0.7 vs ReAct 63 ±0.4 (positive forward transfer).
- Stacking Reflexion on top: ALFWorld 59.0 → 64.2 at R3 (vs 54.4 for ReAct+Reflexion).

### Stated limitations ([full text](https://ar5iv.labs.arxiv.org/html/2308.10144))
- Text-only observations; vision left to future work.
- Closed-source API models used; open-source agents are future work.
- The insight list currently fits in context; "truly lifelong agents" would need retrieval over the insights themselves to manage the context window.
- Prompting lacks RL's theoretical grounding; possible efficiency gap.

### Memory scope
**Cross-task**: insights and successful trajectories are learned on a training task set and applied to held-out test tasks (and transferred across domains).

---

## 4. Agent Workflow Memory (AWM)

- arXiv: [2409.07429](https://arxiv.org/abs/2409.07429) (v1 2024-09-11, single version; verified on abs page).
- Authors: Zora Zhiruo Wang, Jiayuan Mao, Daniel Fried, Graham Neubig ([abs page](https://arxiv.org/abs/2409.07429)).
- Venue: ICML 2025 — PMLR 267:63897–63911, "Proceedings of the 42nd International Conference on Machine Learning" ([PMLR page](https://proceedings.mlr.press/v267/wang25bx.html), verified directly; the arXiv abs page itself lists no venue).

### Core mechanism ([full text](https://arxiv.org/html/2409.07429v1))
- An induction module maps past experiences (instruction + trajectory) to **workflows**: reusable, sub-task-granular routines. LM-based induction finds "repetitive action subsets" across tasks and abstracts example-specific values into variables ("dry cat food" → "{product-name}"); a rule-based variant dedupes by abstract action sequence and drops non-executable steps. Each workflow = natural-language description + step list (state description, thought, executable action); each must have ≥2 steps.
- **Stored:** workflows in agent memory, added as auxiliary context (system prompt); a variant (AWM_AS) instead wraps them as high-level callable actions (e.g. `login(username, password)`).
- **Retrieved when:** on every subsequent task, as in-context guidance.
- **Offline vs online**: offline induces workflows once from training examples, then freezes them. **Online** is supervision-free: test tasks stream in, and after each one an LM-based evaluator outputs a binary success label; **only judged-successful trajectories induce workflows** for the next task. Workflows are kept per-website to stay small and relevant.

### Headline numbers ([abs](https://arxiv.org/abs/2409.07429), [full text](https://arxiv.org/html/2409.07429v1))
- "improves success rates by **24.6% and 51.1%** respectively" on Mind2Web and WebArena — these are **relative** gains over baselines.
- WebArena (gpt-4): **35.5 total success rate** vs BrowserGym 23.5 (+12.0 absolute, +51.1% relative) and vs SteP's human-written workflows 33.0; up to 22.5 absolute points over a vanilla agent after "rolling over only tens of examples" (online).
- Mind2Web (gpt-4): step success rate **45.1 vs MindAct 36.2** (+24.6% relative); online gains of 8.9–14.0 absolute step-SR points as train-test gaps widen (up to 16.9 cross-domain: MindAct 18.6 → AWM_online 35.5).
- **Fewer steps**: AWM averages **5.9 steps** vs 7.9 (BrowserGym_ax-tree) and 46.7 (AutoEval) per WebArena example — direct latency/cost saving.
- Workflow quality: ~7.3–7.4 workflows induced per example, utility rate 0.91–0.94.

### Stated limitations / failure modes ([full text](https://arxiv.org/html/2409.07429v1))
- Workflows can mislead: on Mind2Web action F1 (57.3) is *lower* than the workflow-free baseline (60.6) because agents struggle "in identifying places to diverge from the workflow guidelines".
- Online induction from model-predicted trajectories "can lead to incorrect workflows that degrade model performance" (mitigated by the success-gate).
- Rigid action-sequence workflows fail in dynamic environments (flight-booking pop-ups); agents invoked workflow-actions in only 18.5% of tasks in the AWM_AS variant.
- Combining offline + online workflows is not additive — offline ones "seem to impair the generative quality ... of online workflows".

### Memory scope
**Cross-task**: workflows induced from earlier tasks are reused on later tasks, other websites, and other domains (both offline-trained and online/test-time growth).

---

## 5. CLIN: A Continually Learning Language Agent for Rapid Task Adaptation and Generalization

- arXiv: [2310.10134](https://arxiv.org/abs/2310.10134) (v1 2023-10-16, single version; verified on abs page after correcting two wrong search-suggested ids — see sources JSON).
- Authors: Bodhisattwa Prasad Majumder, Bhavana Dalvi Mishra, Peter Jansen, Oyvind Tafjord, Niket Tandon, Li Zhang, Chris Callison-Burch, Peter Clark ([abs page](https://arxiv.org/abs/2310.10134); [project page](https://allenai.github.io/clin/)).
- Venue: COLM 2024 ("Published as a conference paper at COLM 2024" — the paper PDF hosted at [UPenn](https://www.cis.upenn.edu/~ccb/publications/clin-continual-learning-from-interactions.pdf); COLM 2024 accepted-papers listing on [OpenReview](https://openreview.net/group?id=colmweb.org/COLM/2024/Conference)). The arXiv abs page lists no venue; the PDF header quote comes from a search-index snippet of the UPenn PDF since WebFetch cannot parse PDFs (**venue well-corroborated but header not seen verbatim by me**).
- Note on naming: "CLIN" expands to "Continual Learning from Interactions", but the exact title is the longer one above; the arXiv abstract does not use the phrase "meta-controller" — the updating module is the **memory generator**, plus a **meta-memory** mechanism for cross-episode generalization ([full text](https://ar5iv.labs.arxiv.org/html/2310.10134), [project page](https://allenai.github.io/clin/)).

### Core mechanism ([full text](https://ar5iv.labs.arxiv.org/html/2310.10134))
- Frozen models only — all learning lives in a **persistent, dynamic textual memory of causal abstractions**, not raw traces.
- Each memory entry is a semi-structured sentence: "X is NECESSARY to Y" or "X DOES NOT CONTRIBUTE to Y", with certainty markers ("X may ..." = higher uncertainty, "X should ..." = lower). Entries carry no explicit task-id/reward fields; the memory is tied to task context during generation, captures past mistakes, and is pruned by saliency (kept far smaller than the action count).
- **Update loop**: after each trial, a **memory generator** (frozen LLM) receives the latest trial (goal–action–observation tuples + final reward converted to natural-language feedback) and the memories from the three most recent trials, and emits an updated memory. There is no reward model and no parameter update.
- **Cross-episode generalization**: **meta-memory** uses "Auto-curriculum Selection" (prioritized replay; archive of size 10, best trial per episode) to condense starred memories from prior episodes into generalized abstractions — separate prompts for generalizing across environments (Gen-Env) vs tasks (Gen-Task).
- **Retrieval when acting**: a **controller** (frozen LLM) generates the next goal; it "first selects one or more memory items given the current state" and appends them to context if useful, else falls back to trial history; an **executor** turns goals into admissible actions (invalid candidates matched via sentence-transformer embeddings at 0.9 similarity, else up to 5 refinement tries).

### Headline numbers ([abs](https://arxiv.org/abs/2310.10134), [full text](https://ar5iv.labs.arxiv.org/html/2310.10134); ScienceWorld, GPT-4)
- Outperforms "reflective language agents like Reflexion by **23 absolute points**" on ScienceWorld. The full-text extract gives Gen-Adapt averages of 69.5 (CLIN) vs 39.4 (Reflexion) — a 30.1 gap; **uncertain** which exact task subset matches the abstract's 23 (the same-task Adapt setting 62.2 vs 39.4 ≈ 23 fits, but I could not verify the alignment).
- Same-task adaptation: Base 48.6 → 62.2; avg 3.3 trials to success.
- Transfer to unseen environments (Gen-Env): zero-shot +4 points (52.7 vs 48.6), then **+17 more** via continued memory updates (→ 69.5).
- Transfer to unseen tasks (Gen-Task): zero-shot **+13 points**, then **+7 more** via adaptation.
- Ablations: removing the goal-generating controller costs **−18.1 points** (drop in 44.8% of episodes); free-form advice instead of causal templates costs −6.2.

### Stated limitations ([full text](https://ar5iv.labs.arxiv.org/html/2310.10134))
- **Exploration bottleneck**: insights come only from self-experience; if the agent never reaches the relevant area (art studio example), it never forms the needed memory and keeps failing.
- **Stale-memory retrieval**: for boiling gallium (needs an oven, not a stove) CLIN "repeatedly retrieves" the outdated stove insight; better memory representation is left as future work.

### Memory scope
**Hybrid**: same-task continual improvement across trials (Gen-Adapt) plus explicit cross-environment and cross-task transfer via meta-memory.

---

## 6. Generative Agents: Interactive Simulacra of Human Behavior

- arXiv: [2304.03442](https://arxiv.org/abs/2304.03442) (v1 2023-04-07, v2 2023-08-06; verified on abs page).
- Authors: Joon Sung Park, Joseph C. O'Brien, Carrie J. Cai, Meredith Ringel Morris, Percy Liang, Michael S. Bernstein ([abs page](https://arxiv.org/abs/2304.03442)).
- Venue: UIST 2023 (ACM Symposium on User Interface Software and Technology, Oct 29–Nov 1, 2023) per the search-indexed listing of the official PDF ([3dvar.com PDF](https://3dvar.com/Park2023Generative.pdf), [Stanford HCI listing](https://hci.stanford.edu/publications/paper.php?id=482)); the arXiv abs page itself shows no venue field.

### Core mechanism ([full text](https://ar5iv.labs.arxiv.org/html/2304.03442))
- **Memory stream**: per-agent list of memory objects — natural-language description, creation timestamp, most-recent-access timestamp. Observations (own actions, others' actions, object states) are the leaves; plans and reflections are written back into the same stream. Seed memories come from a one-paragraph character description.
- **Retrieval function** scores all memories as a weighted sum (all weights α = 1) of three min-max-normalized components:
  - **Recency**: exponential decay with factor **0.995** per sandbox hour since last retrieval;
  - **Importance**: LLM-assigned poignancy 1–10 at creation ("1 is purely mundane (e.g., brushing teeth...) and 10 is extremely poignant (e.g., a break up...)") — "cleaning up the room" scored 2, "asking your crush out on a date" 8;
  - **Relevance**: cosine similarity between memory and query embeddings.
  Top-ranked memories that fit the context window enter the prompt.
- **Reflection**: triggered when "the sum of the importance scores for the latest events ... exceeds a threshold (150 in our implementation)" — roughly 2–3 reflections per day. The LLM is given the 100 most recent records, produces "3 most salient high-level questions", uses them as retrieval queries, and synthesizes 5 high-level insights with citations to evidence records. Reflections feed further reflections, forming a tree (leaves = raw observations, higher nodes = abstractions).
- **Planning**: top-down and recursive (day agenda → hour chunks → 5–15-minute actions), stored in the memory stream; agents re-plan when they react to unexpected events.
- **Stored:** the memory stream (persona-level, persists across in-game days). **Retrieved when:** every dialogue/planning/acting decision, via the three-factor score.

### Headline numbers ([abs](https://arxiv.org/abs/2304.03442), [full text](https://ar5iv.labs.arxiv.org/html/2304.03442))
- Believability (TrueSkill over 100 human evaluators): full architecture **μ = 29.89** vs no-reflection 26.88, observations-only 25.64, crowdworker-written behavior 22.95, and fully-ablated prior-SOTA-style 21.21 — full vs worst is an effect size of d = 8.16. Ablation of every component hurts; Kruskal-Wallis H(4)=150.29, p<0.001.
- Emergent social behavior: from a single seed ("one agent wants to throw a Valentine's Day party"), invitations spread autonomously; party knowledge grew from 1 agent (4%) to 13 (52%) over two days; 5 of 12 invited agents attended ([abs](https://arxiv.org/abs/2304.03442) + full text).

### Stated limitations ([full text](https://ar5iv.labs.arxiv.org/html/2304.03442))
- Retrieval failures (agents miss relevant memories or retrieve only fragments); hallucinated embellishments (rare fabrications, but agents invent plausible-sounding details).
- Behavioral norms break (odd venues, entering closed shops); instruction-tuned models produce overly formal, overly cooperative dialogue.
- **Cost**: simulating 25 agents for two game days cost "thousands of dollars in token credits" and took days of runtime.
- Robustness unknown against prompt- and "memory hacking"; inherits LLM biases and stereotype issues.

### Memory scope
**Cross-episode within one environment, per persona**: the memory stream and reflection tree persist across in-game days for each of the 25 agents; there is no cross-task benchmark (the "task" is believability of ongoing life).

---

## What transfers to a self-improving game companion

### (a) Stuck-detection + reflection: write lessons, not logs
- **Gate reflections on a signal, and only keep a few.** Reflexion's evaluator → verbal-lesson step is the transferable core: on task failure, write a short lesson ("amplify" the sparse signal) and keep only the most recent 1–3 lessons in context ([Reflexion](https://ar5iv.labs.arxiv.org/html/2303.11366)). A bounded window both preserves signal and caps prompt growth.
- **Stuck detection needs an explicit round budget.** Voyager marks a task failed after **4 stuck rounds** of code generation and moves the curriculum on, parking the task for a later retry ([Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291)); Reflexion's WebShop run shows the opposite failure — silently grinding with no exploration ([Reflexion](https://ar5iv.labs.arxiv.org/html/2303.11366)). A game companion should have a visible "I'm stuck, switching goal" behavior.
- **The evaluator is the weak link — prefer false negatives.** Reflexion's only regression came from flaky unit tests giving false success (16.3% FP on MBPP); AWM only grows memory from evaluator-approved successes ([AWM](https://arxiv.org/html/2409.07429v1)) for the same reason: lessons written from failed runs poison the library. For a companion: reflect on *verified* failures, and let reflection audit false positives before they enter memory.
- **Blind retries add nothing.** Reflexion's ablation: without the reflection step, retrying stays at baseline (0.60 vs 0.68) — retries must *write something down* ([Reflexion](https://ar5iv.labs.arxiv.org/html/2303.11366)).
- **Structured lessons beat free-form advice.** CLIN's causal-template memory ("X is NECESSARY to Y", with uncertainty markers) beats free-form advice by 6.2 points in its ablation ([CLIN](https://ar5iv.labs.arxiv.org/html/2310.10134)); and raw reflections fed as insights actually *hurt* ExpeL (29.0 vs 39.0 on HotpotQA) ([ExpeL](https://ar5iv.labs.arxiv.org/html/2308.10144)). Lessons should be distilled, typed, and confidence-marked — not raw reflection dumps.
- **Weaker models may not benefit at all**: Reflexion showed no gain with starchat-beta — self-reflection quality is model-dependent ([Reflexion](https://ar5iv.labs.arxiv.org/html/2303.11366)).

### (b) Cross-session persona-level libraries (lessons + skills)
- Two complementary stores emerge across the papers: **declarative lessons** (Reflexion's reflections; ExpeL's ADD/EDIT/UPVOTE/DOWNVOTE insight list with importance-count decay and zero-count eviction; CLIN's causal abstractions) and **procedural skills** (Voyager's verified code skills; AWM's workflows — description + abstracted step list, with a callable-action variant) ([ExpeL](https://ar5iv.labs.arxiv.org/html/2308.10144), [Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291), [AWM](https://arxiv.org/html/2409.07429v1)).
- **Eviction matters as much as addition**: ExpeL's importance-count decay (start at 2, remove at 0) is a minimal, inspectable forgetting mechanism; AWM keeps per-website collections small and relevant; CLIN prunes by saliency so memory stays "far smaller than the action count".
- **Only promote what succeeded.** Voyager commits a skill only after the self-verification critic passes; AWM online induces workflows only from evaluator-labeled successes. A companion's cross-session library should accept entries from verified-success episodes, not from uncertain ones (speculation on the generalization; the gates themselves are cited above).
- **Skills transfer as plug-and-play assets**: Voyager's library, dropped into a fresh world with a different base agent, still solved tasks (AutoGPT + Voyager library: compass 2/3) ([Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291)) — an existence proof that a game companion's learned skills can outlive the session and even the policy.
- **Generalization across contexts needs a separate condensation step**: CLIN's meta-memory condenses starred per-episode memories into cross-environment/cross-task abstractions, and this is where its transfer gains come from (zero-shot +4/+13, then +17/+7 more from continued updates) ([CLIN](https://ar5iv.labs.arxiv.org/html/2310.10134)). Persona-level continuity (Generative Agents' reflection tree over a memory stream, reflections referencing raw observations as evidence with citations) is the believability-side counterpart ([Generative Agents](https://ar5iv.labs.arxiv.org/html/2304.03442)).
- **Retrieval-time composition**: all of these feed stores back in context (ExpeL: insights always + top-k similar successes; Voyager: top-5 skills; Generative Agents: recency × importance × relevance weighted sum). A companion needs both a similarity query and a way to keep the prompt bounded (ExpeL flags that "truly lifelong agents" will need retrieval *over the insights themselves*) ([ExpeL](https://ar5iv.labs.arxiv.org/html/2308.10144)).
- **Stale memories are a real hazard**: CLIN repeatedly retrieved an outdated stove insight and failed the gallium task — cross-session libraries need invalidation paths, not just append ([CLIN](https://ar5iv.labs.arxiv.org/html/2310.10134)).

### (c) Exploration-first automatic curricula
- Voyager's curriculum is the reference design: the model itself proposes the next task, prompted for novelty ("should be novel and interesting... I should not be doing the same thing over and over again"), grounded in the agent's own state and completed/failed lists, and described as "an in-context form of novelty search" ([Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291)). Ablation: a random curriculum **drops discovered items by 93%** — the curriculum, not raw compute, drives the growth curve.
- Tasks must be **verifiable from agent state** so the loop can self-check (Voyager excludes non-verifiable build/place tasks). This is the same discipline as Reflexion's evaluator and AWM's success gate: no self-improvement without a checkable outcome signal.
- **A warm-up schedule paces information**: Voyager only shows nearby entities after 5 tasks, biome after 10, health/hunger/time after 15 — an anti-overwhelm mechanism for context and curriculum quality.
- **Failed tasks are deferred, not dropped**: Voyager parks them on a failed list for later retry; Reflexion's WebShop failure shows what happens without a diversity mechanism — 4 trials, then surrender ([Reflexion](https://ar5iv.labs.arxiv.org/html/2303.11366)).
- Generative Agents contributes the *persona* flavor of this: day-level plans (5–8 chunks) recursively decomposed to 5–15-minute actions, re-planned on reaction — exploration structured as a plan rather than a task queue ([Generative Agents](https://ar5iv.labs.arxiv.org/html/2304.03442)).

### (d) Cost/latency: skill reuse = fewer LLM round-trips
- **AWM is the cleanest evidence**: workflows cut WebArena steps from 7.9 to **5.9** per task (and 46.7 → 5.9 vs AutoEval) — fewer steps means proportionally fewer perception+decision LLM calls, while *raising* success ([AWM](https://arxiv.org/html/2409.07429v1)). For a game companion, promoting a repeated routine into one retrieved workflow is a direct per-session latency win.
- **ExpeL amortizes learning to training time and infers in a single attempt** ("a student studying for an exam and then taking it on a single attempt"), where retrieval of insights + similar successes substitutes for retry loops ([ExpeL](https://ar5iv.labs.arxiv.org/html/2308.10144)) — the inverse trade of Reflexion, which pays 3–12 full trajectory costs per task.
- **Reflection has a per-trial price too**: CLIN adds a memory-generator call after every trial; Generative Agents bound reflection cost by the importance-sum threshold (150), yielding only 2–3 reflections per agent-day — the transferable pattern is *budgeted* reflection, not per-event reflection ([CLIN](https://ar5iv.labs.arxiv.org/html/2310.10134), [Generative Agents](https://ar5iv.labs.arxiv.org/html/2304.03442)).
- **But the ceiling is set by the base model's generation quality**: Voyager pays "15x more expensive than GPT-3.5" for GPT-4 code generation, and GPT-3.5 produces 5.7x fewer usable items — cost-of-learning is dominated by model choice, and the amortization only pays off if skills are actually reused across many later tasks ([Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291)).
- **Multi-agent persona scale is not free**: 25 Generative Agents for two in-game days cost "thousands of dollars in token credits" and days of wall-clock time ([Generative Agents](https://ar5iv.labs.arxiv.org/html/2304.03442)) — a single-companion design avoids the N-agent multiplier but inherits the same per-decision retrieval + reflection costs.

### Memory-scope classification (summary table)

| Paper | Scope of what persists |
|---|---|
| Reflexion | Within-episode: reflections across trials of one task, discarded between tasks |
| Voyager | Cross-task (and cross-world): skill library persists across the whole open-ended run, transfers to fresh worlds |
| ExpeL | Cross-task: insights + successful trajectories learned on training tasks, applied to held-out tasks and other domains |
| Agent Workflow Memory | Cross-task: workflows reused across tasks, websites, domains; grows online during test stream |
| CLIN | Hybrid: same-task trial-to-trial improvement + cross-environment/cross-task transfer via meta-memory |
| Generative Agents | Cross-episode, per-persona, single environment: memory stream + reflection tree across in-game days; no cross-task benchmark |
