import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunContext } from "./harness.ts";
import { controls, type Controls } from "./capabilities.ts";
import { renderObservation } from "../../../../packages/dsh-companion-plugin/src/body/tools.ts";
import { authorTable, drive, validateTable, type ModeTable } from "./approach-modes.ts";
import { executeSkill, makeBindings } from "./approach-skills.ts";

/**
 * The hybrid prototype, after the hybrid advocate's sketch: one LLM turn
 * (system 2) authors a whole DIRECTIVE — a reactive mode table plus, when a
 * long sequence is needed, named code skills — validated once, stored in the
 * library (first run authors, later runs retrieve with zero calls). The fixed
 * executor (system 1) is the modes selector: it owns control between model
 * turns, lets higher-priority modes interrupt instantly, runs skills as
 * macros, and gates everything on DSH-style goal rounds. On stuck or an unmet
 * goal the model gets the mode-event digest and revises the directive.
 *
 * This is deliberately a composition of the debate's own parts: the mode
 * table grammar from the modes prototype, the skill runtime from the skills
 * prototype, the goal-round pattern from the harness — with one authoring
 * call instead of several, and the library amortizing per-game authoring.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HYBRID_SKILL_DIR = path.join(ROOT, "results", "skills");

interface HybridSkill {
  name: string;
  skill: string;
  check: string;
}
interface Directive {
  table: ModeTable;
  skills: HybridSkill[];
}

const MODE_SCHEMA_DOC = `Mode table (inside the directive):
{ "doneWhen": { "all": [ {"path": "...", "op": ">=", "value": 6} ] },
  "modes": [
    { "id": "work", "priority": 10,
      "when": { "all": [ conditions ] },
      "macro": "workRectTiles" | "walkTo" | "guardedWalkTo" | "faceAndPress" | "retreatFromMonster" | "wait" | "skill",
      "params": {...},
      "stopWhen": { "all": [ conditions ] } } ] }
Every mode NEEDS "id" and "priority" (higher = checked first). "when" omitted = always; "stopWhen" omitted = stop when "when" stops holding.
Condition paths: body.x, body.y, body.health, body.facing, body.location, body.slot, objects[X,Y].kind, objects[X,Y].extra.watered, objects[X,Y].extra.crop, nearest(monster).dist, nearest(monster).x, nearest(monster).y, countObjects(kind=dirt, crop=Parsnip, watered=true), items.<Exact Name>.count. Ops: ==, !=, >, >=, <, <=, absent, present.
Macros:
- walkTo {"x","y","mode":"stand"|"adjacent"} (x/y may be "nearest(monster)") — robust walk
- guardedWalkTo {"x","y","monsterWithin":2} — walk that bails when a monster comes within N tiles
- workRectTiles {"rect":{"x0","y0","x1","y1"}, "steps":[{"slot","button"},...], "doneFilter":{"kind","crop","watered"}} — work every tile in the rect not matching doneFilter
- faceAndPress {"x","y","slot","button"} — face an adjacent tile (x/y may be "nearest(monster)"), select slot (0-based), press
- retreatFromMonster {"minDistanceTiles":4} — step away from the nearest monster
- wait {"ms":300}`;

const HYBRID_EXTRA_DOC = `Additionally, the "modes" array may use one more macro:
- {"macro": "skill", "params": {"name": "field-work"}} — run a named skill (code you also write, see below)
And at the top level you may add:
"skills": [ { "name": "field-work", "skill": "async (b) => { ... }", "check": "async (b) => ({ok: true|false, detail: '...'})" } ]
The skill is plain JavaScript with a bindings object "b" (async, no imports, no other globals):
- await b.observe() -> full observation text; await b.body() -> {x, y, health, facing, slot}
- await b.monsters() -> [{name, x, y}]; await b.items() -> toolbar [{slot (0-based), name, stack}]
- await b.walkTo(x, y, "stand"|"adjacent") -> {ok, reason} ("adjacent" stops next to the tile facing it)
- await b.press([{press: ["ControllerX"], ms: 100}]) -> {status, events}; await b.selectSlot(slot)
- await b.workTile(x, y, slot, button) -> stand adjacent, select slot, press button -> {ok, detail}
- await b.faceAndPress(x, y, button, slot?) -> face an adjacent tile and press
- await b.wait(ms); b.log(text)
Use a skill for LONG SEQUENCES (e.g. working every tile of a plot); use reactive modes for danger (fight, flee).`;

function directivePath(scenario: string): string {
  return path.join(HYBRID_SKILL_DIR, `hybrid-${scenario}.json`);
}

async function authorDirective(ctx: RunContext, previous?: { directive: string; error: string }): Promise<Directive> {
  // The mode-table authoring prompt, extended with the skill macro and the skills array.
  const declaration = await ctx.port.declaration();
  const observation = renderObservation(await ctx.port.state(), 14);
  const buttons = declaration.inputs.map((input) => `${input.id} (${input.kind}): ${input.description}`).join("\n  ");
  const user = [
    `Goal:\n${ctx.task.goalText}`,
    `\nCurrent observation:\n${observation}`,
    `\nDeclared buttons:\n  ${buttons}`,
    previous === undefined ? "" : `\nYour previous directive was:\n${previous.directive}\n\nIt failed or got stuck with:\n${previous.error}\n\nWrite a corrected directive.`,
    `\nAuthor a DIRECTIVE as one JSON object with keys "doneWhen", "modes", and (when a long sequence is needed) "skills".`,
    `\n${HYBRID_EXTRA_DOC}`,
    ``,
    `Reply with ONLY the JSON directive (no markdown fences, no commentary).`,
  ].filter((part) => part !== "").join("\n");
  const reply = await ctx.model.chat(
    [{ role: "system", content: "You author behavior directives (reactive mode tables plus code skills) for a game-playing runtime. You reply with a JSON object only." }, { role: "user", content: user }],
    [],
    { maxTokens: 3_000 },
  );
  const text = (reply.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("{");
  if (start === -1) throw new Error(`no JSON in the reply: ${text.slice(0, 140)}`);
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const ch = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = index; break; } }
  }
  if (end === -1) throw new Error(`unbalanced JSON: ${text.slice(0, 140)}`);
  const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const rawModes = (Array.isArray(parsed.modes) ? parsed.modes : Array.isArray((parsed.table as { modes?: unknown } | undefined)?.modes) ? (parsed.table as { modes: unknown[] }).modes : []) as Record<string, unknown>[];
  // Normalize common aliases, then build the directive in one shape.
  const modes = rawModes.map((mode) => ({
    id: String(mode.id ?? mode.name ?? "mode"),
    priority: Number(mode.priority ?? 10),
    when: mode.when as ModeTable["modes"][number]["when"],
    macro: String(mode.macro ?? mode.action ?? mode.do ?? ""),
    params: (mode.params ?? mode.args ?? {}) as Record<string, unknown>,
    stopWhen: mode.stopWhen as ModeTable["modes"][number]["stopWhen"],
  }));
  const doneWhen = (parsed.doneWhen ?? (parsed.table as { doneWhen?: unknown } | undefined)?.doneWhen) as ModeTable["doneWhen"];
  const skills = (Array.isArray(parsed.skills) ? parsed.skills : []) as HybridSkill[];
  return { table: { doneWhen, modes }, skills };
}

export async function runHybrid(ctx: RunContext): Promise<boolean> {
  const controlsRef = await controls(ctx.port);
  const file = directivePath(ctx.task.scenario);
  let directive: Directive | undefined;
  try {
    const stored = JSON.parse(await readFile(file, "utf8")) as Directive;
    directive = stored;
    ctx.log(`retrieved directive ${file} (no authoring call)`);
  } catch {
    // No stored directive yet: the first run authors it.
  }
  let previous: { directive: string; error: string } | undefined;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      directive = await authorDirective(ctx, previous);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      previous = { directive: previous?.directive ?? "(unparseable)", error: message };
      ctx.noteRecovery(`directive authoring failed: ${message.slice(0, 120)}`);
      directive = undefined;
      continue;
    }
    const errors = validateTable(directive.table, ["skill"]);
    if (errors.length > 0) {
      previous = { directive: JSON.stringify(directive), error: errors.join("; ") };
      ctx.noteRecovery(`directive invalid: ${errors.slice(0, 2).join("; ")}`);
      directive = undefined;
      continue;
    }
    ctx.log(`authored directive (${directive.table.modes.length} modes, ${directive.skills.length} skill(s))`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(directive, null, 2), "utf8");
    break;
  }
  if (directive === undefined) return false;

  const skillRunner = async (name: string): Promise<string> => {
    const skill = directive!.skills.find((candidate) => candidate.name === name);
    if (skill === undefined) return `unknown macro skill ${name}`;
    try {
      const ok = await executeSkill(ctx, skill.skill, controlsRef);
      if (!ok) return "skill returned false";
      const check = await executeSkillCheck(ctx, skill.check, controlsRef);
      return check.ok ? "ok" : `skill check failed: ${check.detail.slice(0, 80)}`;
    } catch (error) {
      return `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const fired = new Map<string, number>();
  for (let revision = 0; revision < 3; revision++) {
    const macroResults: string[] = [];
    const outcome = await drive(ctx, controlsRef, directive.table, fired, skillRunner, macroResults);
    if (outcome === "done") {
      if (await ctx.goalCheck()) return true;
      ctx.noteRecovery("goal round: the directive reached doneWhen but the delegated goal is unmet; revising");
    } else if (outcome === "budget" || outcome === "died") {
      return false;
    } else {
      ctx.noteRecovery(`executor stuck (${outcome}); revising the directive`);
    }
    try {
      directive = await authorDirective(ctx, {
        directive: JSON.stringify(directive),
        error: `outcome: ${outcome}. Mode-event digest: ${[...fired.entries()].map(([id, count]) => `${id} x${count}`).join(", ") || "no mode fired"}. Current observation:\n${renderObservation(await ctx.port.state(), 12)}`,
      });
      const validation = validateTable(directive.table, ["skill"]);
      if (validation.length > 0) { ctx.log(`revised directive invalid: ${validation.join("; ")}`); return false; }
      await writeFile(file, JSON.stringify(directive, null, 2), "utf8");
    } catch (error) {
      ctx.log(`directive revision failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  return false;
}

async function executeSkillCheck(ctx: RunContext, code: string, controlsRef: Controls): Promise<{ ok: boolean; detail: string }> {
  try {
    const bindings = makeBindings(ctx, controlsRef);
    const vm = await import("node:vm");
    const script = new vm.Script(`(${code})`);
    const fn = script.runInNewContext({}, { timeout: 1_000 }) as (b: ReturnType<typeof makeBindings>) => Promise<{ ok: boolean; detail: string }>;
    const result = await fn(bindings);
    return result === null || typeof result !== "object" ? { ok: false, detail: String(result) } : result;
  } catch (error) {
    return { ok: false, detail: `check threw: ${error instanceof Error ? error.message : String(error)}` };
  }
}
