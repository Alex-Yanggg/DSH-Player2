// P2-0016 "what she remembers": export every companion's Persona Ledger as
// Markdown. The DSH host already rewrites ledger/remember.md after each dream;
// this script refreshes it on demand (run `npm run build` first).
//
// Usage: node scripts/ledger-export.mjs <bridge-dir> [person] [--stdout]
//   <bridge-dir>  the bridge root that contains projects/
//   person        one project directory name; default every person
//   --stdout      print instead of writing projects/<person>/ledger/remember.md
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PersonaLedger, ledgerMarkdown, writeLedgerExport } from "../packages/dsh-companion-plugin/dist/index.js";

const args = process.argv.slice(2);
const toStdout = args.includes("--stdout");
const [bridge, only] = args.filter((arg) => !arg.startsWith("--"));
if (bridge === undefined) {
  console.error("usage: node scripts/ledger-export.mjs <bridge-dir> [person] [--stdout]");
  process.exit(2);
}
const projects = join(resolve(bridge), "projects");
const people = only !== undefined ? [only] : (await readdir(projects).catch(() => [])).sort();
let exported = 0;
for (const person of people) {
  const ledger = new PersonaLedger(join(projects, person));
  if ((await ledger.saves()).length === 0) continue;
  if (toStdout) console.log(await ledgerMarkdown(ledger, person, new Date()));
  else console.log(await writeLedgerExport(ledger, person, new Date()));
  exported += 1;
}
if (exported === 0) console.error(`No persona ledger found under ${projects}.`);
