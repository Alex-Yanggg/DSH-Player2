import { runOnce, type Approach } from "./lib/harness.ts";
import { runHandCoded } from "./lib/approach-handcoded.ts";
import { runLlmBaseline } from "./lib/approach-llm.ts";
import { runSkills } from "./lib/approach-skills.ts";
import { runLlmBt } from "./lib/approach-llm-bt.ts";
import { runModes } from "./lib/approach-modes.ts";
import { runGoap } from "./lib/approach-goap.ts";
import { runHybrid } from "./lib/approach-hybrid.ts";
import { toy2Approaches } from "./toy2/ports.ts";

/** Plumbing smoke tests, not recorded results. Usage: npx tsx smoke.ts farm|mine|llmfarm|llmmine|skillsfarm|skillsmine [seed] */

const handCoded: Approach = { id: "handcoded", label: "Hand-coded FSM", blurb: "fixed state machines", run: runHandCoded };
const llmBaseline: Approach = { id: "llm", label: "Pure LLM tool calling", blurb: "today's baseline", run: runLlmBaseline };
const skills: Approach = { id: "skills", label: "LLM-written code skills", blurb: "Voyager-style library", run: runSkills };
const llmBt: Approach = { id: "llm-bt", label: "LLM-authored behavior trees", blurb: "BT as data", run: runLlmBt };
const modes: Approach = { id: "modes", label: "Reflex/modes layer", blurb: "system 1 + system 2", run: runModes };
const goap: Approach = { id: "goap", label: "GOAP planner + LLM goals", blurb: "plan-then-execute", run: runGoap };
const hybrid: Approach = { id: "hybrid", label: "LLM directive + reflex executor + skills", blurb: "composed layers", run: runHybrid };
const APPROACH_REGISTRY: Record<string, Approach> = { llm: llmBaseline, "llm-bt": llmBt, modes, skills, goap, hybrid, handcoded: handCoded };

const which = process.argv[2] ?? "farm";
const seed = Number(process.argv[3] ?? "1");

const registry: Record<string, { approach: Approach; scenario: "farm" | "mine" | "toy2"; fast: boolean }> = {
  farm: { approach: handCoded, scenario: "farm", fast: true },
  mine: { approach: handCoded, scenario: "mine", fast: false },
  llmfarm: { approach: llmBaseline, scenario: "farm", fast: true },
  llmmine: { approach: llmBaseline, scenario: "mine", fast: false },
  skillsfarm: { approach: skills, scenario: "farm", fast: true },
  skillsmine: { approach: skills, scenario: "mine", fast: false },
  btfarm: { approach: llmBt, scenario: "farm", fast: true },
  btmine: { approach: llmBt, scenario: "mine", fast: false },
  modesfarm: { approach: modes, scenario: "farm", fast: true },
  modesmine: { approach: modes, scenario: "mine", fast: false },
  goapfarm: { approach: goap, scenario: "farm", fast: true },
  goapmine: { approach: goap, scenario: "mine", fast: false },
  hybridfarm: { approach: hybrid, scenario: "farm", fast: true },
  hybridmine: { approach: hybrid, scenario: "mine", fast: false },
  toy2hand: { approach: toy2Approaches(APPROACH_REGISTRY).handcoded, scenario: "toy2", fast: true },
  toy2llm: { approach: toy2Approaches(APPROACH_REGISTRY).llm, scenario: "toy2", fast: true },
  toy2goap: { approach: toy2Approaches(APPROACH_REGISTRY).goap, scenario: "toy2", fast: true },
  toy2skills: { approach: toy2Approaches(APPROACH_REGISTRY).skills, scenario: "toy2", fast: true },
  toy2bt: { approach: toy2Approaches(APPROACH_REGISTRY)["llm-bt"], scenario: "toy2", fast: true },
  toy2modes: { approach: toy2Approaches(APPROACH_REGISTRY).modes, scenario: "toy2", fast: true },
  toy2hybrid: { approach: toy2Approaches(APPROACH_REGISTRY).hybrid, scenario: "toy2", fast: true },
};
const entry = registry[which] ?? registry.farm;
const record = await runOnce(entry.approach, entry.scenario, seed, entry.fast ? { fast: true } : { tickMs: 17 });
console.log(JSON.stringify({ ...record, log: record.log.slice(0, 60) }, null, 2));
