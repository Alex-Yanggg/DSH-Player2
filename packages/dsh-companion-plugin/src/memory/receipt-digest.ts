import { receiptSchema } from "@dsh-player2/contracts";

const MAX_RECALLED_RECEIPTS = 8;
const MAX_DIGEST_DETAIL_LENGTH = 200;
const MAX_DIGEST_SCOPE_LENGTH = 120;

/** One receipt-backed shared outcome as recalled to the model. */
export interface ReceiptDigestEntry {
  readonly sequence: number;
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly status: "completed" | "failed" | "declined" | "expired";
  readonly occurredAt: string;
  readonly target: string | null;
  readonly scope: string;
  readonly detail: string;
  /** Present only when that past action ran without per-action consent. */
  readonly autonomy?: "full";
}

/** Bounded, newest-first projection of Player-persisted receipts. */
export interface ReceiptDigest {
  readonly entries: ReceiptDigestEntry[];
  /** Receipt files within the scanned window that were not readable as valid receipts. */
  readonly skipped: number;
}

/** Lists receipt file names inside the receipts directory. */
export type ListReceiptFiles = () => Promise<readonly string[]>;
/** Reads and parses one receipt file by name; throws when it cannot be read. */
export type ReadReceiptFile = (name: string) => Promise<unknown>;

const RECEIPT_NAME_PATTERN = /^receipt-(\d+)\.json$/;

/**
 * Project the newest persisted receipts into a bounded read-only digest.
 *
 * Entries are historical context: they are never current observations and
 * never grant authority. Damaged files are skipped and counted, never
 * rewritten and never fatal. Receipts that carry the autonomous-execution
 * marker keep it in the projection so the model can account for actions it
 * took without per-action consent.
 */
export async function collectReceiptDigest(
  listFiles: ListReceiptFiles,
  readReceipt: ReadReceiptFile,
): Promise<ReceiptDigest> {
  const names = await listFiles();
  const sequences: number[] = [];
  for (const name of names) {
    const match = RECEIPT_NAME_PATTERN.exec(name);
    if (match !== null) {
      sequences.push(Number.parseInt(match[1], 10));
    }
  }
  sequences.sort((a, b) => b - a);
  const entries: ReceiptDigestEntry[] = [];
  let skipped = 0;
  for (const sequence of sequences) {
    if (entries.length >= MAX_RECALLED_RECEIPTS) {
      break;
    }
    const parsed = receiptSchema.safeParse(await readReceipt(`receipt-${sequence}.json`).catch(() => null));
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    entries.push({
      sequence,
      proposalId: parsed.data.proposalId,
      capabilityId: parsed.data.capabilityId,
      status: parsed.data.status,
      occurredAt: parsed.data.occurredAt,
      target: parsed.data.target,
      scope: truncate(parsed.data.scope, MAX_DIGEST_SCOPE_LENGTH),
      detail: truncate(parsed.data.detail, MAX_DIGEST_DETAIL_LENGTH),
      ...(parsed.data.autonomy === "full" ? { autonomy: "full" as const } : {}),
    });
  }
  return { entries, skipped };
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
