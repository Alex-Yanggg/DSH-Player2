// P2-0017 validator v0: checks persona packs (structure, then capability
// claims). Run `npm run build` first.
//
// Usage: node scripts/persona-check.mjs [dir ...]   default: personas/
//   Each dir is a pack folder (with persona.json) or a folder of pack folders.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePersonaPack } from "../packages/contracts/dist/index.js";

const roots = process.argv.slice(2);
const packs = (roots.length > 0 ? roots : ["personas"]).flatMap((dir) =>
  existsSync(join(dir, "persona.json")) ? [join(dir, "persona.json")] : readdirSync(dir).map((name) => join(dir, name, "persona.json")));
let failed = 0;
for (const file of packs) {
  try {
    const pack = parsePersonaPack(JSON.parse(readFileSync(file, "utf8")), file);
    console.log(`ok   ${file} (${pack.name})`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
