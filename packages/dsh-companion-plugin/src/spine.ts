/**
 * The P2-0014 companion event spine (middle two points: watermark projection
 * + Dream turn).
 *
 * Four log-only session event types record references and results — a receipt
 * file stays the fact source; an event never restates its content. They ride a
 * dedicated detached persistence session (the spine) written through
 * `sessionPersistence.create/append` with the envelope's `ignorable` marker:
 * out-of-repo types are refused by persistence readers otherwise, and
 * `Session.append` cannot set that marker. Conversation lanes never change.
 *
 * Every consumer — restart, replay, live — folds the same causal sequence
 * through {@link SpineTimeline}, which reads only the suffix past its
 * watermark via `sessionPersistence.readFrom(sessionId, watermark)` instead of
 * rescanning receipt directories.
 *
 * @module @dsh-player2/dsh-companion-plugin/spine
 */
import type { SessionEvent, SessionEventMap } from "@deepseek-ai/dsh-session/types";

/** The spine owns one event vocabulary: references and results only. */
declare module "@deepseek-ai/dsh-session/types" {
  interface SessionEventMap {
    /** A Player-persisted receipt entered the relationship timeline (reference only). */
    "companion/receipt-observed": {
      sequence: number;
      proposalId: string;
      capabilityId: string;
      status: "completed" | "failed" | "declined" | "expired";
      occurredAt: string;
    };
    /** A write-once growth proposal reached the bridge outbox (reflect or dream). */
    "companion/reflection-proposed": {
      sequence: number;
      source: "reflect" | "dream";
    };
    /** The Player applied a growth proposal; the asset advanced to `revision`. */
    "companion/growth-applied": {
      sequence: number;
      revision: number;
    };
    /** One dream turn closed with no change or one grounded growth proposal. */
    "companion/dream-closed": {
      sequence: number;
      outcome: "no-change" | "growth";
    };
  }
}

export type SpineEventType = keyof Pick<
  SessionEventMap,
  "companion/receipt-observed" | "companion/reflection-proposed" | "companion/growth-applied" | "companion/dream-closed"
>;
export type SpineEvent = SessionEvent<SpineEventType>;

/** The session id of one spine, namespaced by the caller (person + save). */
export type SpineSessionId = string;

/** The persistence subset the spine needs, satisfied by `ctx.sessionPersistence`. */
export interface SpineStore {
  /** Register the spine session metadata once; repeated calls are harmless. */
  create(id: SpineSessionId): Promise<void>;
  /** Stored events with `seq >= fromSeq` — the readFrom primitive. */
  readFrom(id: SpineSessionId, fromSeq: number): Promise<SpineEvent[]>;
  /** Durably append one contiguous batch; the first seq must equal the stored next-seq. */
  append(id: SpineSessionId, events: SpineEvent[]): Promise<void>;
}

/** Deterministic spine payload with the ignorable envelope marker set. */
function spineEvent<K extends SpineEventType>(type: K, seq: number, data: SessionEventMap[K]): SpineEvent {
  return { type, seq, time: Date.now(), data, ignorable: true } as SpineEvent;
}

const MAX_TIMELINE_RECEIPTS = 8;
const MAX_TIMELINE_DREAMS = 8;

/** One receipt reference in the timeline — a pointer, never the fact itself. */
export interface TimelineReceipt {
  readonly sequence: number;
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly status: "completed" | "failed" | "declined" | "expired";
  readonly occurredAt: string;
}

/** The bounded relationship timeline folded from the spine (deterministic). */
export interface RelationshipState {
  /** Last folded event seq; -1 on an empty log. */
  watermark: number;
  /** Newest-first receipt references, bounded — the only citable grounding. */
  receipts: TimelineReceipt[];
  /** Highest applied growth revision seen (0 = none). */
  growthRevision: number;
  /** Newest-first dream closures, bounded. */
  dreams: SessionEventMap["companion/dream-closed"][];
}

function initialState(): RelationshipState {
  return { watermark: -1, receipts: [], growthRevision: 0, dreams: [] };
}

/**
 * Folds one spine event into the timeline. Idempotent by reference key: a
 * duplicated receipt observation, reflection, or dream closure changes nothing
 * (negative path three of the P2-0014 acceptance).
 */
export function foldSpineEvent(state: RelationshipState, event: SpineEvent): RelationshipState {
  if (event.seq <= state.watermark) return state;
  const next: RelationshipState = {
    watermark: event.seq,
    receipts: state.receipts,
    growthRevision: state.growthRevision,
    dreams: state.dreams,
  };
  switch (event.type) {
    case "companion/receipt-observed": {
      if (next.receipts.some((entry) => entry.sequence === event.data.sequence)) return next;
      next.receipts = [
        {
          sequence: event.data.sequence,
          proposalId: event.data.proposalId,
          capabilityId: event.data.capabilityId,
          status: event.data.status,
          occurredAt: event.data.occurredAt,
        },
        ...next.receipts,
      ].slice(0, MAX_TIMELINE_RECEIPTS);
      return next;
    }
    case "companion/growth-applied":
      next.growthRevision = Math.max(next.growthRevision, event.data.revision);
      return next;
    case "companion/dream-closed": {
      if (next.dreams.some((dream) => dream.sequence === event.data.sequence)) return next;
      next.dreams = [event.data, ...next.dreams].slice(0, MAX_TIMELINE_DREAMS);
      return next;
    }
    case "companion/reflection-proposed":
      return next;
    default:
      return next;
  }
}

/** Optional state persistence so a restart reads only the suffix past the watermark. */
export interface SpineStateFile {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

/**
 * One watermark projection over one spine session. Open consumers fold the
 * same causal sequence: hydrate() reads only the suffix past the persisted
 * watermark when one exists and otherwise folds once from the log head.
 */
export class SpineTimeline {
  private state: RelationshipState = initialState();
  private hydrated = false;

  constructor(
    private readonly store: SpineStore,
    private readonly id: SpineSessionId,
    private readonly stateFile?: SpineStateFile,
  ) {}

  /** The current folded state; call {@link hydrate} first. */
  public snapshot(): RelationshipState {
    return this.state;
  }

  /**
   * Load the persisted state when present and read only the increment past
   * its watermark; otherwise fold once from the log head. Safe to call again.
   */
  public async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    if (this.stateFile !== undefined) {
      const text = await this.stateFile.read().catch(() => undefined);
      if (text !== undefined) {
        try {
          const restored = JSON.parse(text) as RelationshipState;
          if (typeof restored.watermark === "number" && Array.isArray(restored.receipts)) {
            this.state = restored;
          }
        } catch {
          // A damaged state file falls back to the authoritative log below;
          // the spine log is the fact source for the projection itself.
        }
      }
    }
    await this.advance();
    await this.persistState();
  }

  /** Read and fold only the suffix past the watermark; returns the event count. */
  public async advance(): Promise<number> {
    const events = await this.store.readFrom(this.id, this.state.watermark + 1);
    for (const event of events) this.state = foldSpineEvent(this.state, event);
    return events.length;
  }

  /**
   * Append one spine event at the watermark boundary and fold it locally.
   * A lost race against a concurrent writer re-syncs once and retries, so two
   * lanes over one spine never corrupt the causal sequence.
   */
  public async record<K extends SpineEventType>(type: K, data: SessionEventMap[K]): Promise<void> {
    const event = spineEvent(type, this.state.watermark + 1, data);
    try {
      await this.store.append(this.id, [event]);
    } catch {
      await this.advance();
      const retry = spineEvent(type, this.state.watermark + 1, data);
      await this.store.append(this.id, [retry]);
      this.state = foldSpineEvent(this.state, retry);
      await this.persistState();
      return;
    }
    this.state = foldSpineEvent(this.state, event);
    await this.persistState();
  }

  private async persistState(): Promise<void> {
    if (this.stateFile === undefined) return;
    await this.stateFile.write(JSON.stringify(this.state)).catch(() => {
      // State persistence is an optimization; the log reproduces the state.
    });
  }
}

/**
 * Keyless replay/file adapter over the same store seam: one JSONL spine log
 * plus one projection state file inside a directory. The installed app uses
 * the `sessionPersistence`-backed store instead; this adapter exists so the
 * unattended dual-end harness exercises the identical timeline logic.
 */
export class SpineFileStore implements SpineStore {
  private readonly directory: string;

  public constructor(directory: string) {
    this.directory = directory;
  }

  public async create(): Promise<void> {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(this.directory, { recursive: true });
  }

  public async readFrom(_id: SpineSessionId, fromSeq: number): Promise<SpineEvent[]> {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const text = await readFile(join(this.directory, "events.jsonl"), "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    const events: SpineEvent[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const event = JSON.parse(line) as SpineEvent;
      if (event.seq >= fromSeq) events.push(event);
    }
    return events;
  }

  public async append(_id: SpineSessionId, events: SpineEvent[]): Promise<void> {
    const { appendFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(this.directory, { recursive: true });
    await appendFile(join(this.directory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  }
}

/** File-backed state persistence at one explicit path. */
export function spineStateFileAt(path: string): SpineStateFile {
  return {
    async read() {
      const { readFile } = await import("node:fs/promises");
      return readFile(path, "utf8").catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      });
    },
    async write(text: string) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, "utf8");
    },
  };
}
