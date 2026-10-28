/**
 * Reflex growth (RSI over the reflex tier): the companion grows its own
 * reflex rows. The body judges every fired row a few seconds later; the dream
 * sees the day's tally and may add a row or tune one (as data, checked by the
 * reflex schema and the game's declared buttons); a new row is a candidate
 * until its trial firings decide, and a row active in two saves joins the
 * persona. Nothing here knows the game: rows are the companion's own data.
 *
 * ```text
 * <ledger>/saves/<save>/reflexes.json     this save's grown rows and today's tally
 * <ledger>/saves/persona/reflexes.json    rows proven in two saves
 * ```
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/reflex-growth
 */
import { readFile } from "node:fs/promises";
import { reflexRowSchema, type BodyInputStep, type ReflexRow } from "@dsh-player2/contracts";

/** Judged firings that decide a candidate. */
export const REFLEX_TRIAL = 3;
/** Live grown rows kept per save. */
export const GROWN_LIMIT = 12;

export interface GrownReflex {
  readonly row: ReflexRow;
  status: "candidate" | "active" | "retired";
  good: number;
  bad: number;
  /** A tune: the row this one takes over from once it proves out. */
  readonly replaces?: string;
  readonly createdAt: string;
}

export interface ReflexBook {
  grown: GrownReflex[];
  /** Verdicts since the last dream, by row id (shipped rows too). */
  today: Record<string, { good: number; bad: number }>;
}

/** One book; missing or damaged reads as empty, so a bad file never stops the body. */
export async function readReflexBook(path: string): Promise<ReflexBook> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<ReflexBook>;
    const grown = (Array.isArray(raw.grown) ? raw.grown : []).filter((entry) => reflexRowSchema.safeParse(entry?.row).success);
    return { grown, today: typeof raw.today === "object" && raw.today !== null ? raw.today : {} };
  } catch {
    return { grown: [], today: {} };
  }
}

/**
 * The rows in play for one save: candidates first (so a tune shadows its
 * target while on trial), then active grown rows, then the shipped table;
 * a proven tune hides the row it replaces.
 */
export function rowsInPlay(shipped: readonly ReflexRow[], books: readonly ReflexBook[]): ReflexRow[] {
  const live = books.flatMap((book) => book.grown).filter((entry) => entry.status !== "retired");
  const hidden = new Set(live.filter((entry) => entry.status === "active").map((entry) => entry.replaces));
  const ordered = [...live.filter((entry) => entry.status === "candidate"), ...live.filter((entry) => entry.status === "active")].map((entry) => entry.row);
  const rows = new Map<string, ReflexRow>();
  for (const row of [...ordered, ...shipped]) if (!hidden.has(row.id) && !rows.has(row.id)) rows.set(row.id, row);
  return [...rows.values()];
}

/**
 * Counts one verdict. A candidate that reaches its trial becomes active on a
 * good majority and is retired otherwise; the line says which, or null.
 */
export function recordReflexOutcome(book: ReflexBook, id: string, good: boolean): string | null {
  const tally = book.today[id] ?? { good: 0, bad: 0 };
  book.today[id] = good ? { ...tally, good: tally.good + 1 } : { ...tally, bad: tally.bad + 1 };
  const entry = book.grown.find((grown) => grown.row.id === id && grown.status !== "retired");
  if (entry === undefined) return null;
  if (good) entry.good++; else entry.bad++;
  if (entry.status !== "candidate" || entry.good + entry.bad < REFLEX_TRIAL) return null;
  entry.status = entry.good > entry.bad ? "active" : "retired";
  return entry.status === "active"
    ? `reflex ${id} proved out (${entry.good}/${entry.good + entry.bad} helped) and is now yours`
    : `reflex ${id} did not help on trial (${entry.good}/${entry.good + entry.bad} helped) and was dropped`;
}

/** The dream's view of the reflexes: every row in play with today's verdicts. */
export function reflexDigest(rows: readonly ReflexRow[], books: readonly ReflexBook[], today: ReflexBook["today"]): string {
  const grown = new Map(books.flatMap((book) => book.grown).map((entry) => [entry.row.id, entry]));
  return [
    `REFLEXES(${rows.length}) — today's verdicts (helped/did not):`,
    ...rows.map((row) => {
      const mark = grown.get(row.id);
      const status = mark === undefined ? "shipped" : `${mark.status} ${mark.good}/${mark.good + mark.bad}`;
      return `- ${row.id} [${status}] today ${today[row.id]?.good ?? 0}/${today[row.id]?.bad ?? 0}: ${JSON.stringify({ when: row.when, do: row.do, cooldownMs: row.cooldownMs })}`;
    }),
  ].join("\n");
}

export const REFLEX_GROWTH_INSTRUCTIONS =
  '- reflexes: grow your body\'s instincts. {"op":"add","row":{id,when,do,cooldownMs?,fact}} adds a row; {"op":"tune","id":"<row>","row":{...}} tries a changed copy (new id, same do.kind and condition kinds) that takes over once it proves out. Use only the condition kinds above and buttons from body_controls. New rows are on trial: ' + REFLEX_TRIAL + " judged firings decide. Omit the field when the reflexes served you well.";

/**
 * Validates and applies the dream's `reflexes` edits to this save's book.
 * Every refusal names its reason so the companion can learn from it.
 */
export function applyReflexEdits(raw: unknown, book: ReflexBook, inPlay: readonly ReflexRow[], buttons: ReadonlySet<string>, now: Date): { applied: string[]; rejected: string[] } {
  const applied: string[] = [];
  const rejected: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const edit = item as { op?: unknown; id?: unknown; row?: unknown };
    const parsed = reflexRowSchema.safeParse(edit.row);
    const label = `reflex ${String(edit.op)} ${typeof edit.id === "string" ? edit.id : (edit.row as { id?: unknown } | undefined)?.id ?? "?"}`;
    if (edit.op !== "add" && edit.op !== "tune") { rejected.push(`${label}: op must be add or tune`); continue; }
    if (!parsed.success) { rejected.push(`${label}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join(", ")}`); continue; }
    const row = parsed.data;
    if (inPlay.some((other) => other.id === row.id) || book.grown.some((other) => other.row.id === row.id)) { rejected.push(`${label}: id ${row.id} is taken`); continue; }
    const unknown = burstSteps(row).flatMap((step) => [...step.hold ?? [], ...step.press ?? []]).filter((button) => !buttons.has(button));
    if (unknown.length > 0) { rejected.push(`${label}: buttons not in body_controls: ${[...new Set(unknown)].join(", ")}`); continue; }
    if (book.grown.filter((entry) => entry.status !== "retired").length >= GROWN_LIMIT) { rejected.push(`${label}: already ${GROWN_LIMIT} grown rows`); continue; }
    let replaces: string | undefined;
    if (edit.op === "tune") {
      const target = inPlay.find((other) => other.id === edit.id);
      if (target === undefined) { rejected.push(`${label}: no such row in play`); continue; }
      if (target.do.kind !== row.do.kind || kinds(target) !== kinds(row)) { rejected.push(`${label}: a tune keeps do.kind and the condition kinds of ${target.id}`); continue; }
      replaces = target.id;
    }
    book.grown.push({ row, status: "candidate", good: 0, bad: 0, ...(replaces === undefined ? {} : { replaces }), createdAt: now.toISOString() });
    applied.push(`${label}: candidate ${row.id}`);
  }
  return { applied, rejected };
}

/** Rows active in at least two saves and not yet the persona's, ready to join it. */
export function provenAcrossSaves(saves: readonly ReflexBook[], persona: ReflexBook): GrownReflex[] {
  const held = new Set(persona.grown.map((entry) => JSON.stringify(entry.row)));
  const counts = new Map<string, { entry: GrownReflex; saves: number }>();
  for (const book of saves) {
    for (const entry of book.grown.filter((grown) => grown.status === "active")) {
      const key = JSON.stringify(entry.row);
      counts.set(key, { entry, saves: (counts.get(key)?.saves ?? 0) + 1 });
    }
  }
  return [...counts].filter(([key, { saves: count }]) => count >= 2 && !held.has(key)).map(([, { entry }]) => ({ ...entry }));
}

function burstSteps(row: ReflexRow): readonly BodyInputStep[] {
  return row.do.kind === "stepAway" ? [] : row.do.steps;
}

function kinds(row: ReflexRow): string {
  return [...row.when.all, ...row.when.none ?? []].map((condition) => condition.kind).sort().join(",");
}
