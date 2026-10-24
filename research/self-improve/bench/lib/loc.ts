import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Line-of-code accounting for the metric table.
 *
 * loc_core: non-blank, non-test lines of the approach's own module — the code
 * you would ship in the plugin for that architecture (the shared bench harness
 * in capabilities.ts/port.ts/harness.ts is common infrastructure and excluded;
 * it is the same for every approach).
 *
 * loc_data: non-blank lines of the approach's per-game DATA files (the goap
 * domains). The LLM-facing approaches author their per-game artifacts at
 * RUNTIME (a tree, a mode table, a skill, a directive) — those are model
 * output recorded under results/skills/, not shipped code, so their shipped
 * per-game data is zero by construction; the runtime authoring cost shows up
 * in the llm_calls metric instead.
 *
 * Porting cost (changed/added lines to run on toy2, counted from the marked
 * port regions and files):
 * - llm, llm-bt, modes, skills, hybrid: 0/0 — the identical approach code
 *   runs against toy2's declaration; the model authors new per-game data at
 *   runtime (see results/skills and runs-toy2.json).
 * - goap: the fixed-stack additions marked "toy2 port" in approach-goap.ts
 *   (itemAtLeast + noObjectKind predicate kinds, the haveItems goal kind with
 *   its reachability-checked BFS planner, the pressAt operator, the doorKeys
 *   domain field) plus the new domains/toy2.json — counted below by line
 *   ranges that are re-verified by name.
 * - handcoded: the toy2 controller in toy2/ports.ts is new code (the farm and
 *   mine controllers do not transfer); counted as added lines.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "..", "results");

/** Non-blank lines inside EVERY [startMarker]...[endMarker] region of the file. */
async function countRegions(file: string, startMarker: string, endMarker: string): Promise<number> {
  const lines = (await readFile(path.join(ROOT, file), "utf8")).split("\n");
  let inside = false;
  let count = 0;
  for (const line of lines) {
    if (line.includes(startMarker)) { inside = true; continue; }
    if (line.includes(endMarker)) { inside = false; continue; }
    if (inside && line.trim() !== "") count++;
  }
  return count;
}

async function countLines(file: string, from?: string, to?: string): Promise<number> {
  const text = await readFile(path.join(ROOT, file), "utf8");
  const lines = text.split("\n");
  let slice = lines;
  if (from !== undefined) {
    const start = lines.findIndex((line) => line.includes(from));
    if (start === -1) throw new Error(`${file}: marker "${from}" not found`);
    let end = lines.length;
    if (to !== undefined) {
      const found = lines.findIndex((line, index) => index > start && line.includes(to));
      if (found !== -1) end = found + 1;
    }
    slice = lines.slice(start, end);
  }
  return slice.filter((line) => line.trim() !== "").length;
}

export async function countLoc(): Promise<Record<string, Record<string, unknown>>> {
  const table: Record<string, Record<string, unknown>> = {};

  const core = async (id: string, file: string) => {
    table[id] = { ...(table[id] ?? {}), loc_core: await countLines(file) };
  };

  await core("llm", "lib/approach-llm.ts");
  await core("llm-bt", "lib/approach-llm-bt.ts");
  await core("modes", "lib/approach-modes.ts");
  await core("skills", "lib/approach-skills.ts");
  // goap's module contains its own toy2 port (sentinel-marked); the core count
  // is the farm/mine stack without those lines.
  table.goap = { loc_core: await countLines("lib/approach-goap.ts") - await countRegions("lib/approach-goap.ts", "// [toy2-port]", "// [/toy2-port]") };
  await core("hybrid", "lib/approach-hybrid.ts");
  await core("handcoded", "lib/approach-handcoded.ts");

  // Round-2 option prototypes. lib/driven.ts is shared infrastructure (the
  // tool loop every LLM option would have in some form, like capabilities.ts)
  // EXCEPT the [plan-submit] region, which is option (d)'s own mechanism and
  // is charged to actionrate and combo below.
  await core("reflect", "lib/approach-reflect.ts");
  await core("library", "lib/approach-library.ts");
  await core("curriculum", "lib/approach-curriculum.ts");
  await core("actionrate", "lib/approach-actionrate.ts");
  await core("combo", "lib/approach-combo.ts");
  await core("async", "lib/approach-async.ts");
  table["async-llm"] = { ...(table["async"] ?? {}), loc_core: table["async"].loc_core as number };
  const planSubmit = await countRegions("lib/driven.ts", "// [plan-submit]", "// [/plan-submit]");
  table.actionrate.loc_core = (table.actionrate.loc_core as number) + planSubmit;
  table.combo.loc_core = (table.combo.loc_core as number) + planSubmit;

  // Per-game data (goap domains are shipped data; other approaches ship none).
  table.goap.loc_data = await countLines("domains/farm.json") + await countLines("domains/mine.json");
  table.llm.loc_data = 0;
  table["llm-bt"].loc_data = 0;
  table.modes.loc_data = 0;
  table.skills.loc_data = 0;
  table.hybrid.loc_data = 0;
  table.handcoded.loc_data = 0;
  for (const id of ["reflect", "library", "curriculum", "actionrate", "combo", "async", "async-llm"]) table[id].loc_data = 0;

  // toy2 porting cost.
  for (const id of ["llm", "llm-bt", "modes", "skills", "hybrid"]) {
    table[id].toy2_changed = 0;
    table[id].toy2_added = 0;
    table[id].toy2_note = "identical approach code runs against toy2's declaration; per-game data is model-authored at runtime";
  }

  const goapCodePort = await countRegions("lib/approach-goap.ts", "// [toy2-port]", "// [/toy2-port]");
  const toy2Domain = await countLines("domains/toy2.json");
  table.goap.toy2_changed = 0;
  table.goap.toy2_added = goapCodePort + toy2Domain;
  table.goap.toy2_note = `fixed-stack additions between [toy2-port] sentinels in approach-goap.ts (${goapCodePort} code lines: itemAtLeast/noObjectKind predicate kinds, haveItems goal kind + reachability-checked BFS planner, pressAt operator, doorKeys field, goal grammar) + domains/toy2.json (${toy2Domain} data lines)`;

  const handToy2 = await countLines("toy2/ports.ts", "The Keycraft controller");
  table.handcoded.toy2_changed = 0;
  table.handcoded.toy2_added = handToy2;
  table.handcoded.toy2_note = "the toy2 controller is new code; none of the farm/mine controller logic transfers";

  await writeFile(path.join(RESULTS, "loc.json"), JSON.stringify(table, null, 1), "utf8");
  return table;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const table = await countLoc();
  console.table(table);
}
