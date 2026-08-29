import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BridgeDispatcher, DshSessionDecisionRunner } from "../packages/dsh-dispatcher/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeEntry = process.env.DSH_JSONRPC_AGENT_ENTRY;
const runtimeCwd = process.env.DSH_JSONRPC_AGENT_CWD;
const requestedTsxImport = process.env.DSH_TSX_IMPORT ?? "tsx/esm";
const tsxImport = isAbsolute(requestedTsxImport) ? pathToFileURL(requestedTsxImport).href : requestedTsxImport;

function readFlag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const bridgeDirectory = resolve(process.cwd(), readFlag("bridge") ?? process.env.PLAYER2_BRIDGE_DIRECTORY ?? "");
if (!bridgeDirectory || bridgeDirectory === process.cwd()) {
  throw new Error("Pass the Player bridge directory with --bridge <dir> or PLAYER2_BRIDGE_DIRECTORY.");
}
if (!runtimeEntry) {
  throw new Error("Set DSH_JSONRPC_AGENT_ENTRY to the generic or packaged dsh-jsonrpc-agent entry file.");
}
if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error("DEEPSEEK_API_KEY is required for live DSH dispatch.");
}

process.env.PLAYER2_BRIDGE_DIRECTORY = bridgeDirectory;
process.env.DSH_CORDIS_CONFIG = join(repositoryRoot, "fixtures", "dsh", "companion-decision.cordis.yml");

const requestedSession = readFlag("session");
const sessionSuffix = requestedSession ?? (basename(bridgeDirectory).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "save");
const pollIntervalMs = Number.parseInt(readFlag("poll") ?? "2000", 10) || 2000;

// One dedicated session accumulates the durable event-log relationship history;
// the bridge directory identity keeps saves from sharing a session.
const runner = new DshSessionDecisionRunner({
  launch: {
    command: process.execPath,
    args: ["--import", tsxImport, resolve(runtimeEntry)],
    ...(runtimeCwd ? { cwd: resolve(runtimeCwd) } : {}),
  },
  cwd: repositoryRoot,
  maxTokens: 1200,
  sessionId: `player2-companion-${sessionSuffix}`,
  bridgeDirectory,
});

const dispatcher = new BridgeDispatcher({ bridgeDirectory, runner, pollIntervalMs });

let stopping = false;
async function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  try {
    await dispatcher.stop();
    await runner.close();
  } catch (error) {
    // Development posture: shutdown problems must be visible, never swallowed.
    console.error("player2-dispatch: shutdown failed:", error);
    process.exit(1);
  }
  // Registering a signal handler disables Node's default exit, so end explicitly.
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await dispatcher.start();
process.stdout.write(
  `player2-dispatch: watching ${bridgeDirectory}; session=player2-companion-${sessionSuffix}; poll=${pollIntervalMs}ms\n`,
);
process.stdout.write("player2-dispatch: press Ctrl+C to stop; consent stays in the game UI.\n");
await new Promise(() => undefined);
