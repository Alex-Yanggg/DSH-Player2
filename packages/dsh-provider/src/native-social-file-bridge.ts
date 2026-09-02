import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  bridgeFileLimit,
  socialBridgeResultSchema,
  socialBridgeTurnSchema,
  socialResponseSchema,
  type SocialBridgeTurn,
} from "@dsh-player2/contracts";
import { DshConversationPolicy, type DshTextRunner } from "@dsh-player2/runtime";

export interface NativeSocialFileBridgeOptions {
  readonly bridgeDirectory: string;
  readonly runner: DshTextRunner;
  readonly logger?: Pick<Console, "info" | "error">;
}

/**
 * File host for F2 turns. It deliberately has no rule policy: a response file
 * is either the validated result of a real DSH session, or an explicit error.
 */
export class NativeSocialFileBridge {
  private readonly root: string;
  private readonly runner: DshTextRunner;
  private readonly logger: Pick<Console, "info" | "error">;
  private timer: NodeJS.Timeout | undefined;
  private draining = false;

  public constructor(options: NativeSocialFileBridgeOptions) {
    this.root = resolve(options.bridgeDirectory);
    this.runner = options.runner;
    this.logger = options.logger ?? console;
  }

  public async start(): Promise<void> {
    await Promise.all([mkdir(join(this.root, "social-inbox"), { recursive: true }), mkdir(join(this.root, "social-outbox"), { recursive: true })]);
    await this.drain();
    this.timer = setInterval(() => void this.drain(), 250);
  }

  public async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const entries = await readdir(join(this.root, "social-inbox"));
      for (const entry of entries.filter((name) => /^turn-[0-9a-f-]+\.json$/i.test(name)).sort()) {
        const id = entry.slice("turn-".length, -".json".length);
        if (existsSync(join(this.root, "social-outbox", `result-${id}.json`))) continue;
        await this.handle(id);
      }
    } catch (error) {
      this.logger.error(`player2-social: bridge scan failed: ${this.messageOf(error)}`);
    } finally {
      this.draining = false;
    }
  }

  private async handle(id: string): Promise<void> {
    const traceId = `social:${id}`;
    try {
      const raw = await readFile(join(this.root, "social-inbox", `turn-${id}.json`), "utf8");
      if (Buffer.byteLength(raw, "utf8") > bridgeFileLimit) throw new Error(`turn exceeds ${bridgeFileLimit} bytes`);
      const turn = socialBridgeTurnSchema.parse(JSON.parse(raw)) as SocialBridgeTurn;
      if (turn.id !== id) throw new Error("file name and payload id differ");
      const response = socialResponseSchema.parse(await new DshConversationPolicy(this.runner).respond({
        adapter: turn.adapter,
        gameDay: turn.gameDay,
        observations: turn.observations,
        priorMemory: turn.priorMemory,
        latestReceipt: turn.latestReceipt,
        message: turn.message,
      }));
      const observationIds = new Set(turn.observations.map((observation) => observation.id));
      if (response.basedOnObservationIds.some((observationId) => !observationIds.has(observationId))) {
        throw new Error("DSH response cited an observation outside this turn");
      }
      if (response.basedOnMemoryId !== (turn.priorMemory?.id ?? null)) throw new Error("DSH response cited unavailable memory");
      await this.write(id, {
        version: "0.0.9", id, status: "completed", source: "dsh", traceId,
        sessionId: "native-dsh-social", response,
      });
      this.logger.info(`player2-social: native DSH completed ${traceId}`);
    } catch (error) {
      await this.write(id, {
        version: "0.0.9", id, status: "error", source: "dsh", traceId,
        code: "DSH_SOCIAL_TURN_FAILED", message: this.messageOf(error),
      });
      this.logger.error(`player2-social: ${traceId} failed: ${this.messageOf(error)}`);
    }
  }

  private async write(id: string, value: unknown): Promise<void> {
    const parsed = socialBridgeResultSchema.parse(value);
    const destination = join(this.root, "social-outbox", `result-${id}.json`);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(parsed), { encoding: "utf8", flag: "wx" });
    try { await rename(temporary, destination); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }

  private messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
}
