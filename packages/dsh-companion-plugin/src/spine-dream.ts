/**
 * The dream lane's file loop (P2-0014, point 3): the explicit day-end request
 * is the only observable boundary; the lane closes with no change or one
 * grounded growth proposal. The output type is structurally incapable of
 * touching the soul, capabilities, or autonomy — the growth proposal has no
 * such fields, and this lane has no other write path.
 */
import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  bridgeFileLimit,
  decisionTurnVersion,
  dreamNoChangeSchema,
  dreamRequestSchema,
  growthProposalSchema,
  type DreamRequest,
  type GrowthProposal,
} from "@dsh-player2/contracts";
import type { SpineTimeline } from "./spine.js";

const MAX_DREAM_INSIGHTS = 3;
const MAX_INSIGHT_LENGTH = 240;
const MAX_CITED_RECEIPTS = 8;
const MAX_FOCUS_LENGTH = 160;

/** Model-authored dream decision for one day-end boundary. */
export type DreamDraftInput =
  | { readonly kind: "no-change" }
  | {
      readonly kind: "growth";
      readonly insights: ReadonlyArray<{
        readonly text: string;
        readonly basedOnReceiptSequences: readonly number[];
      }>;
      readonly focus: string | null;
    };

/** What one dream turn wrote: the outcome is the only player-visible effect. */
export type DreamOutcome = "no-change" | "growth";

/**
 * Fixed-path, write-once dream lane over one bridge session directory and one
 * watermark projection. The dream reads its grounding from the projected
 * timeline — never by rescanning the receipts directory.
 */
export class DreamFileLane {
  private readonly root: string;

  public constructor(bridgeDirectory: string, private readonly timeline: SpineTimeline) {
    if (bridgeDirectory.trim().length === 0) {
      throw new Error("The dream lane requires a non-empty bridgeDirectory.");
    }
    this.root = resolve(bridgeDirectory);
  }

  /**
   * Read and validate one explicit day-end request, or null when this turn
   * carries none. The request is the only trigger this lane accepts.
   */
  public async readRequest(sequence: number): Promise<DreamRequest | null> {
    this.assertSequence(sequence);
    let raw: unknown;
    try {
      raw = await this.readJson(this.requestPath(sequence));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = dreamRequestSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (parsed.data.sequence !== sequence) {
      throw new Error(`Dream request sequence ${parsed.data.sequence} does not match requested sequence ${sequence}.`);
    }
    return parsed.data;
  }

  /**
   * Close one dream: write the no-change marker or one grounded growth
   * proposal, and record the causal events on the spine. Duplicate closes are
   * byte-compared write-once (idempotent), and every insight must cite
   * receipt sequences the projected timeline actually holds.
   */
  public async decide(sequence: number, input: DreamDraftInput): Promise<DreamOutcome> {
    this.assertSequence(sequence);
    // One dream closes once: a sequence may hold the no-change marker or one
    // growth proposal, never both, and write-once idempotence covers retries.
    const conflicting = input.kind === "no-change" ? this.growthPath(sequence) : this.noChangePath(sequence);
    if (await this.exists(conflicting)) {
      throw new Error(`Dream sequence ${sequence} already closed with a different outcome.`);
    }
    if (input.kind === "no-change") {
      await this.writeOnce(this.noChangePath(sequence), dreamNoChangeSchema.parse({
        version: decisionTurnVersion,
        sequence,
        outcome: "no-change",
      }), "dream no-change marker");
      await this.timeline.record("companion/dream-closed", { sequence, outcome: "no-change" });
      return "no-change";
    }
    if (input.insights.length === 0 || input.insights.length > MAX_DREAM_INSIGHTS) {
      throw new Error(`A dream growth proposal requires between 1 and ${MAX_DREAM_INSIGHTS} insights.`);
    }
    const timeline = this.timeline.snapshot();
    const knownSequences = new Set(timeline.receipts.map((entry) => entry.sequence));
    const insights = input.insights.map((insight) => {
      const text = this.boundedText(insight.text, "insight text", MAX_INSIGHT_LENGTH);
      const cited = insight.basedOnReceiptSequences;
      if (cited.length === 0 || cited.length > MAX_CITED_RECEIPTS || new Set(cited).size !== cited.length) {
        throw new Error(`Each dream insight requires distinct cited receipt sequences, at most ${MAX_CITED_RECEIPTS}.`);
      }
      const unknown = cited.find((candidate) => !knownSequences.has(candidate));
      if (unknown !== undefined) {
        throw new Error(
          `Dream growth insight cited receipt sequence ${unknown}, which the projected relationship timeline does not contain. ` +
          "A dream may only ground itself in receipts recorded on the spine.",
        );
      }
      return { text, basedOnReceiptSequences: [...cited] };
    });
    const focus = input.focus === null || input.focus === undefined ? null : this.boundedText(input.focus, "focus", MAX_FOCUS_LENGTH);
    const proposal = growthProposalSchema.parse({ version: decisionTurnVersion, sequence, insights, focus });
    await this.writeOnce(this.growthPath(sequence), proposal, "dream growth proposal");
    await this.timeline.record("companion/reflection-proposed", { sequence, source: "dream" });
    await this.timeline.record("companion/dream-closed", { sequence, outcome: "growth" });
    return "growth";
  }

  private requestPath(sequence: number): string {
    return resolve(this.root, "dream-inbox", `dream-${sequence}.json`);
  }

  private noChangePath(sequence: number): string {
    return resolve(this.root, "outbox", `dream-nochange-${sequence}.json`);
  }

  private growthPath(sequence: number): string {
    return resolve(this.root, "outbox", `dream-growth-${sequence}.json`);
  }

  private assertSequence(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("Dream sequence must be a positive safe integer.");
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      const handle = await open(path, "r");
      await handle.close();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private boundedText(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new Error(`A dream proposal requires a non-empty ${label}.`);
    }
    if (normalized.length > maxLength) {
      throw new Error(`A dream proposal ${label} may contain at most ${maxLength} characters.`);
    }
    return normalized;
  }

  private async writeOnce<T>(path: string, value: T, label: string): Promise<T> {
    await mkdir(dirname(path), { recursive: true });
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporaryPath, "wx");
      try {
        await handle.writeFile(serialized, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporaryPath, path);
        return value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    } finally {
      await unlink(temporaryPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
    const existing = JSON.parse(await this.readBounded(path, label)) as T;
    if (JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error(`Refusing to overwrite a conflicting ${label} for this sequence.`);
    }
    return existing;
  }

  private async readJson(path: string): Promise<unknown> {
    let raw: string;
    try {
      raw = await this.readBounded(path, "dream request");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const notFound = new Error("No dream request exists for the requested sequence.") as Error & { code?: string };
        notFound.code = "ENOENT";
        throw notFound;
      }
      throw error;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error("The persisted dream request is not valid JSON.");
    }
  }

  private async readBounded(path: string, label: string): Promise<string> {
    const handle = await open(path, "r");
    try {
      const stats = await handle.stat();
      if (stats.size > bridgeFileLimit) throw new Error(`The persisted ${label} exceeds the ${bridgeFileLimit} byte limit.`);
      return await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
  }
}
