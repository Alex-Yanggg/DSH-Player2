import {
  bodyDeclarationSchema,
  bodyStateSchema,
  bodyWorldSchema,
  type BodyDeclaration,
  type BodyInputStep,
  type BodyState,
  type BodyTaskStatus,
  type BodyUntil,
  type BodyWorld,
} from "@dsh-player2/contracts";

/** The outcome of one submitted input sequence as the plugin saw it. */
export interface BodyRun {
  readonly seq: number;
  readonly status: BodyTaskStatus["status"] | "timeout";
  readonly reason: string | null;
  readonly events: BodyTaskStatus["events"];
  /** State read after the adapter finished the task. */
  readonly state: BodyState | undefined;
  readonly acceptMs: number | undefined;
  readonly totalMs: number;
}

export interface RunOptions { until?: BodyUntil; fastState?: boolean; signal?: AbortSignal; timeoutMs?: number }

/** The companion's body, wherever it lives (the game's MCP endpoint, or the sim). */
export interface BodyPort {
  declaration(): Promise<BodyDeclaration>;
  state(): Promise<BodyState>;
  world(): Promise<BodyWorld>;
  run(steps: readonly BodyInputStep[], options?: RunOptions): Promise<BodyRun>;
  cancelActive(): Promise<void>;
  /** Records the player's own words granting or withdrawing cheat inputs for this save. */
  grantCheats(granted: boolean, quote: string): Promise<string>;
}

export const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted || ms <= 0) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * The game's hands over its local MCP endpoint (Streamable HTTP, JSON
 * responses): the mod exports raw state and plays raw input; this client owns
 * no game knowledge. Navigation and reflexes are built on top of it.
 */
export class GameBody implements BodyPort {
  private id = 0;

  public constructor(private readonly url: string, private readonly token: string) {}

  public async declaration(): Promise<BodyDeclaration> { return bodyDeclarationSchema.parse(JSON.parse(await this.call("body_declaration"))); }
  public async state(): Promise<BodyState> { return bodyStateSchema.parse(JSON.parse(await this.call("world_state"))); }
  public async world(): Promise<BodyWorld> { return bodyWorldSchema.parse(JSON.parse(await this.call("world_map"))); }

  public async run(steps: readonly BodyInputStep[], options: RunOptions = {}): Promise<BodyRun> {
    const started = Date.now();
    const onAbort = () => void this.cancelActive().catch(() => undefined);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const outcome = JSON.parse(await this.call("body_run", {
        steps,
        ...(options.until === undefined ? {} : { until: options.until }),
        ...(options.fastState === true ? { fastState: true } : {}),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      })) as { seq: number; status: BodyRun["status"]; reason: string | null; events?: BodyTaskStatus["events"] };
      const state = await this.state().catch(() => undefined);
      return { seq: outcome.seq, status: outcome.status, reason: outcome.reason ?? null, events: outcome.events ?? [], state, acceptMs: undefined, totalMs: Date.now() - started };
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  public async cancelActive(): Promise<void> { await this.call("body_cancel"); }
  public async grantCheats(granted: boolean, quote: string): Promise<string> { return this.call("cheat_grant", { granted, quote }); }

  private async call(name: string, args: Record<string, unknown> = {}): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method: "tools/call", params: { name, arguments: args } }),
      });
    } catch (error) {
      throw new Error(`the game is not reachable (is the save loaded?): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (!response.ok) throw new Error(`the game answered HTTP ${response.status}`);
    const reply = await response.json() as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } };
    if (reply.error !== undefined) throw new Error(reply.error.message ?? "the game refused the call");
    const text = reply.result?.content?.map((block) => block.text ?? "").join("") ?? "";
    if (reply.result?.isError === true) throw new Error(text);
    return text;
  }
}
