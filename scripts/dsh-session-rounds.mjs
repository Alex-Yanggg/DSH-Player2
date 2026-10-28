#!/usr/bin/env node
/** Post-run analysis for P2-0019b T4: how much thinking one save's DSH session needed.
 *  Reads the session's own log (`~/.dsh/sessions/<cwd-slug>/<id>/session.v4.jsonl.zstd`, a
 *  chain of zstd frames), counts turns and tool calls, and prints the totals. Read-only;
 *  an analysis tool for the PR numbers, never a game oracle. Usage:
 *    node scripts/dsh-session-rounds.mjs <session.v4.jsonl.zstd> [more.zstd ...]
 */
import { zstdDecompressSync } from "node:zlib";
import { readFileSync } from "node:fs";

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function* frames(buffer) {
  let rest = buffer;
  while (rest.length > 0) {
    yield zstdDecompressSync(rest);
    let next = -1;
    for (let i = 4; i < rest.length - 4; i++) {
      if (rest[i] === MAGIC[0] && rest[i + 1] === MAGIC[1] && rest[i + 2] === MAGIC[2] && rest[i + 3] === MAGIC[3]) {
        next = i;
        break;
      }
    }
    if (next < 0) break;
    rest = rest.subarray(next);
  }
}

let turns = 0;
const tools = new Map();
let bodyCalls = 0;
let reports = 0;

for (const path of process.argv.slice(2)) {
  const text = [...frames(readFileSync(path))].join("");
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "turn/start") turns += 1;
    if (event.type === "tool/call") {
      const name = event.data?.name ?? "?";
      tools.set(name, (tools.get(name) ?? 0) + 1);
      if (name.startsWith("world_") || name.startsWith("body_") || name.startsWith("skill_") || name.startsWith("plan_")) bodyCalls += 1;
    }
    if (event.type === "agent/inbox/spliced") reports += 1;
  }
}

const calls = [...tools.values()].reduce((sum, n) => sum + n, 0);
console.log(JSON.stringify({ turns, toolCalls: calls, bodyCalls, pluginNotes: reports, tools: [...tools.entries()].sort((a, b) => b[1] - a[1]) }, null, 2));
