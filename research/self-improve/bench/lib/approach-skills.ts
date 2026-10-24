import vm from "node:vm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderObservation } from "../../../../packages/dsh-companion-plugin/src/body/tools.ts";
import type { RunContext } from "./harness.ts";
import { controls, goto, pressSteps, workTile, faceAndPress, type Controls } from "./capabilities.ts";
import type { BodyInputStep } from "@dsh-player2/contracts";

/**
 * The "LLM-written code skills + skill library" prototype, after the skills
 * advocate's sketch: a small game-agnostic skill runtime (the bench stand-in
 * for DSH's PTC/run_code seam) exposes bindings over the body port; the model
 * authors a skill as an async function ONCE per game+goal; the skill is stored
 * on disk (results/skills/<scenario>.js) and later runs retrieve it with zero
 * authoring calls. The model is not in the loop while a skill executes.
 *
 * The runtime executes model-authored code in a fresh node:vm context with no
 * globals beyond the bindings — a bench stand-in for PTC's fresh-process
 * sandbox, documented as such (vm is not a hard security boundary).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_DIR = path.join(ROOT, "results", "skills");

export interface SkillBindings {
  observe(): Promise<string>;
  state(): Promise<Record<string, unknown>>;
  body(): Promise<{ x: number; y: number; health: number; facing: string; slot: number } | null>;
  monsters(): Promise<{ name: string; x: number; y: number }[]>;
  items(): Promise<{ slot: number; name: string; stack: number }[]>;
  walkTo(x: number, y: number, mode?: "stand" | "adjacent"): Promise<{ ok: boolean; reason: string }>;
  press(steps: { hold?: string[]; press?: string[]; ms: number }[]): Promise<{ status: string; events: string[] }>;
  selectSlot(slot: number): Promise<{ status: string; events: string[] }>;
  workTile(x: number, y: number, slot: number, button: string): Promise<{ ok: boolean; detail: string }>;
  faceAndPress(x: number, y: number, button: string, slot?: number): Promise<{ ok: boolean; detail: string }>;
  buttons(): Promise<{ id: string; kind: string; description: string }[]>;
  wait(ms: number): Promise<void>;
  log(line: string): void;
}

export function makeBindings(ctx: RunContext, controlsRef: Controls): SkillBindings {
  const signal = ctx.signal;
  const trace = (line: string) => ctx.log(`[bind] ${line}`);
  return {
    async observe() {
      const state = await ctx.port.state();
      const text = renderObservation(state, 12);
      return state.body !== null && state.body.health < 100 ? `${text}\nYour health: ${Math.round(state.body.health)}/100.` : text;
    },
    async state() {
      return JSON.parse(JSON.stringify(await ctx.port.state())) as Record<string, unknown>;
    },
    async body() {
      const state = await ctx.port.state();
      const body = state.body;
      return body === null ? null : { x: body.x, y: body.y, health: body.health, facing: body.facing, slot: body.selectedSlot };
    },
    async monsters() {
      const state = await ctx.port.state();
      return state.characters.filter((c) => c.kind === "monster").map((c) => ({ name: c.name, x: c.x, y: c.y }));
    },
    async items() {
      const state = await ctx.port.state();
      return (state.body?.items ?? []).map((item) => ({ slot: item.slot, name: item.name, stack: item.stack }));
    },
    async walkTo(x, y, mode = "stand") {
      const result = await goto(ctx.port, controlsRef, { x, y }, { mode, signal });
      trace(`walkTo(${x},${y},${mode}) -> ok=${result.ok} ${result.reason.slice(0, 80)}`);
      return { ok: result.ok, reason: result.reason };
    },
    async press(steps) {
      const run = await pressSteps(ctx.port, steps as BodyInputStep[], signal);
      trace(`press(${JSON.stringify(steps).slice(0, 90)}) -> ${run.status} ${run.events.map((event) => `${event.kind}:${event.detail}`).join("; ").slice(0, 120)}`);
      return { status: run.status, events: run.events.map((event) => `${event.kind}: ${event.detail}`) };
    },
    async selectSlot(slot) {
      const run = await pressSteps(ctx.port, [{ press: [`Slot${slot + 1}`], ms: 0 }], signal);
      trace(`selectSlot(${slot}) -> ${run.status}`);
      return { status: run.status, events: run.events.map((event) => `${event.kind}: ${event.detail}`) };
    },
    async workTile(x, y, slot, button) {
      const result = await workTile(ctx.port, controlsRef, { x, y }, slot, button, signal);
      trace(`workTile(${x},${y},slot${slot},${button}) -> ${result.detail.slice(0, 110)}`);
      return result;
    },
    async faceAndPress(x, y, button, slot) {
      const result = await faceAndPress(ctx.port, controlsRef, { x, y }, button, slot, signal);
      trace(`faceAndPress(${x},${y},${button}${slot === undefined ? "" : `,slot${slot}`}) -> ${result.detail.slice(0, 110)}`);
      return result;
    },
    async buttons() {
      return (await ctx.port.declaration()).inputs.map((input) => ({ id: input.id, kind: input.kind, description: input.description }));
    },
    async wait(ms) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(ms, 2_000));
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    },
    log(line) {
      ctx.log(`[skill] ${line}`);
    },
  };
}

const BINDINGS_DOC = `Bindings object "b" (all async unless noted):
- await b.observe() -> the full observation text (position, toolbar, objects, characters, health)
- await b.body() -> {x, y, health, facing, slot} or null
- await b.monsters() -> [{name, x, y}]
- await b.items() -> toolbar items [{slot (0-based), name, stack}]
- await b.walkTo(x, y, mode) -> {ok, reason}; mode "stand" or "adjacent" (adjacent stops next to the tile and faces it — use before working a tile)
- await b.press([{hold: ["DPadRight"], ms: 500}]) or await b.press([{press: ["ControllerX"], ms: 0}]) -> {status, events}
- await b.selectSlot(slot) -> select toolbar slot (0-based)
- await b.workTile(x, y, slot, button) -> stand adjacent to (x,y), select slot, press button; returns {ok, detail}
- await b.faceAndPress(x, y, button, slot?) -> face the orthogonal-adjacent tile (x,y) and press button (optionally selecting slot first)
- await b.buttons() -> the body's declared buttons
- await b.wait(ms)
- b.log(text)
Write plain JavaScript (no imports, no globals beyond b).`;

function skillPath(scenario: string): string {
  return path.join(SKILL_DIR, `${scenario}.js`);
}

async function authorSkill(ctx: RunContext, previous?: { code: string; error: string; logTail?: string[] }): Promise<{ skill: string; check: string }> {
  const declaration = await ctx.port.declaration();
  const state = await ctx.port.state();
  const observation = renderObservation(state, 14);
  const buttons = declaration.inputs.map((input) => `${input.id} (${input.kind}): ${input.description}`).join("\n  ");
  const user = [
    `Goal:\n${ctx.task.goalText}`,
    `\nCurrent observation:\n${observation}`,
    `\nDeclared buttons:\n  ${buttons}`,
    previous === undefined ? "" : `\nYour previous attempt was:\n${previous.code}\n\nIt failed with:\n${previous.error}\n${previous.logTail === undefined || previous.logTail.length === 0 ? "" : `\nWhat actually happened at runtime (binding call log):\n${previous.logTail.slice(-40).join("\n")}\n`}\nObservation after the failed run:\n${renderObservation(await ctx.port.state(), 14)}\nDiagnose from the events and the state, then write a corrected version.`,
    `\n${BINDINGS_DOC}`,
    ``,
    `Reply with ONLY a JSON object (no markdown fences):`,
    `{"skill": "async (b) => { ... completes the goal, returns true ... }",`,
    ` "check": "async (b) => { ... verifies from b.state()/b.observe() whether the goal is truly met; returns {ok: true|false, detail: '...'} ... }"}`,
    `Rules: plain JavaScript, no imports, no globals beyond b. The skill must not trust an action's ok flag alone — verify effects through b.state() or returned events. Keep each function under 50 lines.`,
  ].filter((part) => part !== "").join("\n");
  const reply = await ctx.model.chat(
    [{ role: "system", content: "You write small, correct JavaScript skill programs for a game-playing body runtime. You reply with a JSON object only." }, { role: "user", content: user }],
    [],
    { maxTokens: 2_200 },
  );
  const parsed = parseSkillReply((reply.content ?? "").trim());
  if (parsed === undefined) throw new Error(`the model did not return the expected JSON: ${(reply.content ?? "").slice(0, 160)}`);
  return parsed;
}

function parseSkillReply(text: string): { skill: string; check: string } | undefined {
  const stripped = stripFences(text).replace(/^```json\s*/i, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as { skill?: unknown; check?: unknown };
    if (typeof parsed.skill !== "string" || typeof parsed.check !== "string") return undefined;
    if (!parsed.skill.includes("async") || !parsed.check.includes("async")) return undefined;
    return { skill: parsed.skill, check: parsed.check };
  } catch {
    return undefined;
  }
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/);
  return (fenced === null ? text : fenced[1]).trim();
}

export async function executeSkill(ctx: RunContext, code: string, controlsRef: Controls): Promise<boolean> {
  const bindings = makeBindings(ctx, controlsRef);
  const script = new vm.Script(`(${code})`);
  const fn = script.runInNewContext({}, { timeout: 1_000 }) as (b: SkillBindings) => Promise<boolean>;
  const result = await fn(bindings);
  return result === true;
}

async function executeCheck(ctx: RunContext, code: string, controlsRef: Controls): Promise<{ ok: boolean; detail: string }> {
  const bindings = makeBindings(ctx, controlsRef);
  const script = new vm.Script(`(${code})`);
  const fn = script.runInNewContext({}, { timeout: 1_000 }) as (b: SkillBindings) => Promise<{ ok: boolean; detail: string }>;
  const result = await fn(bindings);
  return result === null || typeof result !== "object" ? { ok: false, detail: String(result) } : result;
}

export async function runSkills(ctx: RunContext): Promise<boolean> {
  const controlsRef = await controls(ctx.port);
  const log: string[] = [];
  const inner: RunContext = { ...ctx, log: (line: string) => { log.push(line); ctx.log(line); } };
  const file = skillPath(ctx.task.scenario);
  let stored: { skill: string; check: string } | undefined;
  try {
    stored = JSON.parse(await readFile(file, "utf8")) as { skill: string; check: string };
    ctx.log(`retrieved skill ${file} (no authoring call)`);
  } catch {
    // No stored skill yet: the first run authors it.
  }
  let previous: { code: string; error: string; logTail?: string[] } | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (ctx.signal.aborted) return false;
    if (stored === undefined) {
      stored = await authorSkill(ctx, previous);
      ctx.log(`authored skill (${stored.skill.split("\n").length} lines) + postcondition check`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(stored, null, 2), "utf8");
    }
    try {
      const claimedDone = await executeSkill(ctx, stored.skill, controlsRef);
      if (!claimedDone) {
        previous = { code: `${stored.skill}\n// check: ${stored.check}`, error: "the skill returned false before finishing" };
        ctx.noteRecovery("skill returned false; re-authoring");
      } else {
        const check = await executeCheck(inner, stored.check, controlsRef).catch((error: unknown) => ({ ok: false, detail: `check threw: ${String(error)}` }));
        if (check.ok) return true;
        previous = { code: `${stored.skill}\n// check: ${stored.check}`, error: `the skill claimed success but the postcondition check failed: ${check.detail}` };
        ctx.noteRecovery(`postcondition failed: ${check.detail.slice(0, 120)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${String(error.stack ?? "").split("\n").slice(0, 4).join("\n")}` : String(error);
      previous = { code: `${stored.skill}\n// check: ${stored.check}`, error: message };
      ctx.noteRecovery(`skill threw: ${message.split("\n")[0]}`);
    }
    stored = undefined;
  }
  return false;
}
