import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DshSdkTextRunner } from "../packages/dsh-provider/dist/index.js";
import { DshConversationPolicy } from "../packages/runtime/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeEntry = process.env.DSH_JSONRPC_AGENT_ENTRY;
const runtimeCwd = process.env.DSH_JSONRPC_AGENT_CWD;
const requestedTsxImport = process.env.DSH_TSX_IMPORT ?? "tsx/esm";
const tsxImport = isAbsolute(requestedTsxImport) ? pathToFileURL(requestedTsxImport).href : requestedTsxImport;
if (!runtimeEntry) {
  throw new Error("Set DSH_JSONRPC_AGENT_ENTRY to the generic or packaged dsh-jsonrpc-agent entry file.");
}
if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error("DEEPSEEK_API_KEY is required for the optional live smoke.");
}

process.env.DSH_CORDIS_CONFIG = join(repositoryRoot, "fixtures", "dsh", "companion-live.cordis.yml");

const runner = new DshSdkTextRunner({
  launch: {
    command: process.execPath,
    args: ["--import", tsxImport, resolve(runtimeEntry)],
    ...(runtimeCwd ? { cwd: resolve(runtimeCwd) } : {}),
  },
  cwd: repositoryRoot,
  maxTokens: 800,
});

try {
  const policy = new DshConversationPolicy(runner);
  const response = await policy.respond({
    adapter: { id: "fixture", gameId: "stardew-valley", accessMode: "semantic", capabilities: [] },
    gameDay: 42,
    observations: [{
      id: "weather-42",
      kind: "world",
      observedAt: "2026-08-29T00:00:00.000Z",
      expiresAt: null,
      source: "fixture",
      accessMode: "semantic",
      confidence: 1,
      facts: { weather: "rain", location: "Farm" },
    }],
    priorMemory: null,
    latestReceipt: null,
    message: {
      id: "message-live-smoke",
      content: "Should we prepare supplies for the mine tomorrow?",
      createdAt: "2026-08-29T00:00:00.000Z",
    },
  });
  const skillCallCount = runner.lastRunEvents.filter(
    (event) => event.type === "tool/call" && event.data.name === "skill",
  ).length;
  if (skillCallCount < 1) {
    throw new Error("The live DSH response returned without a durable skill tool call.");
  }
  process.stdout.write(`PASS live DSH companion: response=${response.kind}; skillCalls=${skillCallCount}\n`);
} finally {
  await runner.close().catch(() => undefined);
}
