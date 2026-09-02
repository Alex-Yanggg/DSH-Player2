import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BridgeDispatcher, BridgeLock, DshSessionDecisionRunner } from "../packages/dsh-dispatcher/dist/index.js";
import { DshSdkTextRunner, NativeSocialFileBridge } from "../packages/dsh-provider/dist/index.js";

// Historical keyless/replay fixture only.  Production game startup is owned by
// @dsh-player2/dsh-host-plugin inside the already-running DSH profile; do not
// wire this sidecar into SMAPI or distribute it as a launcher.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readFlag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// One local, git-ignored configuration file points at an existing DeepSeek
// Harness checkout; nothing here downloads, clones, or installs anything.
const localConfigPath = join(repositoryRoot, "companion.local.json");
const localConfig = existsSync(localConfigPath)
  ? JSON.parse(readFileSync(localConfigPath, "utf8"))
  : {};

const runtimeEntry = process.env.DSH_JSONRPC_AGENT_ENTRY ?? localConfig.dshJsonRpcAgentEntry;
const runtimeCwd = process.env.DSH_JSONRPC_AGENT_CWD ?? localConfig.dshJsonRpcAgentCwd;
const requestedTsxImport = process.env.DSH_TSX_IMPORT ?? localConfig.dshTsxImport ?? "tsx/esm";
const tsxImport = isAbsolute(requestedTsxImport) ? pathToFileURL(requestedTsxImport).href : requestedTsxImport;
if (!process.env.DEEPSEEK_API_KEY && localConfig.deepseekApiKey) {
  process.env.DEEPSEEK_API_KEY = localConfig.deepseekApiKey;
}

const bridgeDirectory = resolve(
  process.cwd(),
  readFlag("bridge") ?? process.env.PLAYER2_BRIDGE_DIRECTORY ?? localConfig.bridgeDirectory ?? "",
);
if (!bridgeDirectory || bridgeDirectory === process.cwd()) {
  throw new Error(
    "Pass the Player bridge directory with --bridge <dir>, PLAYER2_BRIDGE_DIRECTORY, or bridgeDirectory in companion.local.json.",
  );
}
if (!runtimeEntry) {
  throw new Error(
    "Set DSH_JSONRPC_AGENT_ENTRY, or dshJsonRpcAgentEntry in companion.local.json, to the dsh-jsonrpc-agent entry file of your existing DSH checkout.",
  );
}
if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error("DEEPSEEK_API_KEY is required for live DSH dispatch (or set deepseekApiKey in companion.local.json).");
}

process.env.PLAYER2_BRIDGE_DIRECTORY = bridgeDirectory;
process.env.DSH_CORDIS_CONFIG = join(repositoryRoot, "fixtures", "dsh", "companion-decision.cordis.yml");

const requestedSession = readFlag("session");
const sessionSuffix = requestedSession ?? (basename(bridgeDirectory).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "save");
const pollIntervalMs = Number.parseInt(readFlag("poll") ?? "2000", 10) || 2000;
const idleExitSeconds = Number.parseInt(readFlag("idle-exit") ?? "0", 10) || 0;

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

const socialRunner = new DshSdkTextRunner({
  launch: {
    command: process.execPath,
    args: ["--import", tsxImport, resolve(runtimeEntry)],
    ...(runtimeCwd ? { cwd: resolve(runtimeCwd) } : {}),
    env: { ...process.env, DSH_CORDIS_CONFIG: join(repositoryRoot, "fixtures", "dsh", "companion-live.cordis.yml") },
  },
  cwd: repositoryRoot,
  maxTokens: 800,
});
const socialBridge = new NativeSocialFileBridge({ bridgeDirectory, runner: socialRunner });

const dispatcher = new BridgeDispatcher({ bridgeDirectory, runner, pollIntervalMs });
const lock = new BridgeLock(bridgeDirectory);
if (!(await lock.acquire())) {
  process.stdout.write(
    `player2-dispatch: another live dispatcher already owns ${bridgeDirectory}; nothing to do.\n`,
  );
  process.exit(0);
}

let stopping = false;
let idleTimer;
async function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  if (idleTimer !== undefined) {
    clearInterval(idleTimer);
  }
  try {
    await dispatcher.stop();
    await socialBridge.stop();
    await runner.close();
    await socialRunner.close();
    await lock.release();
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

if (idleExitSeconds > 0) {
  let lastWork = dispatcher.stats.dispatched + dispatcher.stats.failed;
  let idleSeconds = 0;
  idleTimer = setInterval(() => {
    const total = dispatcher.stats.dispatched + dispatcher.stats.failed;
    if (total !== lastWork) {
      lastWork = total;
      idleSeconds = 0;
      return;
    }
    idleSeconds += 5;
    if (idleSeconds >= idleExitSeconds) {
      process.stdout.write(`player2-dispatch: idle for ${idleExitSeconds}s; exiting.\n`);
      void shutdown();
    }
  }, 5000);
  idleTimer.unref?.();
}

await dispatcher.start();
await socialBridge.start();
process.stdout.write(
  `player2-dispatch: watching ${bridgeDirectory}; session=player2-companion-${sessionSuffix}; poll=${pollIntervalMs}ms`
    + (idleExitSeconds > 0 ? `; idle-exit=${idleExitSeconds}s` : "")
    + "\n",
);
process.stdout.write("player2-dispatch: native DSH social bridge is watching social-inbox/ for F2 turns.\n");
process.stdout.write("player2-dispatch: press Ctrl+C to stop; consent stays in the game UI.\n");
await new Promise(() => undefined);
