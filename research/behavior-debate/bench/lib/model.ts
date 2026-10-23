import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The bench's model client. Two modes:
 * - "real": calls the DeepSeek chat-completions API with the environment's
 *   DEEPSEEK_API_KEY (the task prefers a real model call over a stub; no GLM
 *   API key exists in this environment, so the real call is DeepSeek's
 *   `deepseek-chat`, served as `deepseek-flash` — recorded in every result).
 *   Every request/response pair is cached on disk (keyed by the full request);
 *   a cache hit replays the recorded latency so reruns keep realistic timing
 *   without re-billing.
 * - "stub": no network. Not implemented as a policy here — the harness refuses
 *   to run silently-stubbed numbers; if the API is unavailable the runner
 *   records a hard error and the report marks those cells as stubbed.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE_DIR = path.join(ROOT, "cache", "llm");

export interface ToolSpec {
  name: string;
  description: string;
  /** Schemastery-style parameters ({name: {type, description, required?}}), converted to JSON Schema for the API. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ModelReply {
  content: string | null;
  toolCalls: ToolCall[];
  ms: number;
  cached: boolean;
  usage: { prompt: number; completion: number } | null;
}

/** Tool parameters to JSON Schema for the OpenAI-compatible API. Passes through parameters that are already JSON Schema (the product's defineTool tools are); converts schemastery-style declarations. */
export function parametersToJsonSchema(parameters: Record<string, unknown>): Record<string, unknown> {
  if (parameters.type === "object" && parameters.properties !== undefined && typeof parameters.properties === "object") {
    return parameters;
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, def] of Object.entries(parameters)) {
    if (typeof def !== "object" || def === null) continue;
    const d = def as Record<string, unknown>;
    const type = d.type === "integer" ? "integer" : d.type === "number" ? "number" : d.type === "boolean" ? "boolean" : d.type === "array" ? "array" : "string";
    const prop: Record<string, unknown> = { type, description: d.description ?? name };
    if (type === "array" && typeof d.items === "object") prop.items = d.items;
    if (type === "string" && Array.isArray(d.enum)) prop.enum = d.enum;
    properties[name] = prop;
    if (d.required === true) required.push(name);
  }
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ModelError extends Error {}

export interface ModelCounters {
  calls: number;
  cacheHits: number;
  apiErrors: number;
  waitMs: number;
}

export class ModelClient {
  public readonly mode: "real" | "stub";
  public readonly modelName: string;
  public readonly counters: ModelCounters = { calls: 0, cacheHits: 0, apiErrors: 0, waitMs: 0 };
  private inFlight = 0;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly latencyReplay: boolean;

  public constructor(options: { mode?: "real" | "stub"; model?: string; temperature?: number; latencyReplay?: boolean } = {}) {
    const envMode = process.env.BENCH_MODEL;
    this.mode = options.mode ?? (envMode === "stub" ? "stub" : "real");
    this.modelName = options.model ?? process.env.BENCH_MODEL_NAME ?? "deepseek-chat";
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
    this.temperature = options.temperature ?? 0;
    this.latencyReplay = options.latencyReplay ?? process.env.BENCH_NO_SLEEP_CACHE !== "1";
    if (this.mode === "real" && (this.apiKey === undefined || this.apiKey === "")) {
      throw new ModelError("BENCH_MODEL=real but DEEPSEEK_API_KEY is not set");
    }
  }

  /** True while at least one request is awaiting the API; the idle monitor samples this. */
  public get busy(): boolean {
    return this.inFlight > 0;
  }

  public async chat(
    messages: readonly ChatMessage[],
    tools: readonly ToolSpec[] = [],
    options: { maxTokens?: number } = {},
  ): Promise<ModelReply> {
    const request = {
      model: this.modelName,
      messages,
      tools: tools.length === 0 ? undefined : tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: parametersToJsonSchema(tool.parameters) } })),
      temperature: this.temperature,
      max_tokens: options.maxTokens ?? 1024,
      stream: false,
    };
    const key = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const cachePath = path.join(CACHE_DIR, `${key}.json`);
    this.counters.calls++;
    const cached = await this.readCache(cachePath);
    if (cached !== undefined) {
      this.counters.cacheHits++;
      if (this.latencyReplay && cached.ms > 0) await sleep(Math.min(cached.ms, 20_000));
      this.counters.waitMs += cached.ms;
      return { ...cached, cached: true };
    }
    if (this.mode === "stub") throw new ModelError("stub mode has no model; the runner must supply scripted policies");
    const reply = await this.callWithRetry(request);
    await this.writeCache(cachePath, reply);
    this.counters.waitMs += reply.ms;
    return { ...reply, cached: false };
  }

  private async readCache(cachePath: string): Promise<ModelReply | undefined> {
    try {
      return JSON.parse(await readFile(cachePath, "utf8")) as ModelReply;
    } catch {
      return undefined;
    }
  }

  private async writeCache(cachePath: string, reply: ModelReply): Promise<void> {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(reply), "utf8");
  }

  private async callWithRetry(request: Record<string, unknown>): Promise<ModelReply> {
    const delays = [2_000, 4_000, 8_000];
    let lastError: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) await sleep(delays[attempt - 1]);
      const started = Date.now();
      this.inFlight++;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        let response: Response;
        try {
          response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
            body: JSON.stringify(request),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new ModelError(`HTTP ${response.status}: ${body.slice(0, 300)}`);
        }
        const json = (await response.json()) as {
          model?: string;
          choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const message = json.choices?.[0]?.message;
        if (message === undefined) throw new ModelError("no choice in the reply");
        const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          args: safeParse(call.function.arguments),
        }));
        const reply: ModelReply = {
          content: message.content ?? null,
          toolCalls,
          ms: Date.now() - started,
          cached: false,
          usage: json.usage ? { prompt: json.usage.prompt_tokens ?? 0, completion: json.usage.completion_tokens ?? 0 } : null,
        };
        return reply;
      } catch (error) {
        lastError = error;
        this.counters.apiErrors++;
        // Client errors other than rate limits are not transient.
        if (error instanceof ModelError && /HTTP 4\d\d:/.test(error.message) && !/HTTP 429/.test(error.message)) break;
      } finally {
        this.inFlight--;
      }
    }
    throw lastError instanceof Error ? lastError : new ModelError(String(lastError));
  }
}

function safeParse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
