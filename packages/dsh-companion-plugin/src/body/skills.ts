import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BodyInputStep, BodyUntil } from "@dsh-player2/contracts";
import { controlsOf, type Controls } from "./navigation.js";
import type { BodyPort } from "./port.js";
import { walkTo, type WalkTarget } from "./walk.js";
import { describeRun, findObjects, locationsLine, renderMapAround, renderObservation } from "./tools.js";

/**
 * The skill tier (P2-0019 T2): when the mind finishes a sub-task through the
 * body tools, it may save those steps as a skill — a small JS program run
 * against the same body operations the tools expose. `skill_save` replays the
 * program once and refuses to save on failure; `skill_run` replays it later at
 * the cost of one tool call. A skill that fails at run time is reported to the
 * mind with the error and marked stale; only the mind decides to repair or
 * drop it. Programs always execute through DSH's own PTC seam; a mount without
 * that seam ships no skill tools at all, never a local stand-in.
 */

/** One saved skill, as the file under the persona library's `skills/` holds it. */
export interface SkillRecord {
  readonly version: "1";
  readonly name: string;
  readonly purpose: string;
  readonly code: string;
  /** The game the skill was learned in; other games may still run it (and mark it stale). */
  readonly game: string;
  readonly createdAt: string;
  uses: number;
  lastRun: string | null;
  stale: string | null;
}

/** The body operations a skill program sees, one function per tool the mind already knows. */
export type SkillHands = {
  observe(args?: { radius?: number }): Promise<string>;
  find(args?: { kind?: string; name?: string; readyOnly?: boolean; limit?: number }): Promise<string>;
  map(args?: { x?: number; y?: number; radius?: number }): Promise<string>;
  locations(args?: { near?: string }): Promise<string>;
  walkTo(args: { x: number; y: number; location?: string; mode?: "stand" | "adjacent" }): Promise<string>;
  controls(): Promise<string>;
  input(args: { steps: readonly BodyInputStep[]; until?: BodyUntil }): Promise<string>;
};

/** The one program seam: run `code` with `hands` and `args`; failures resolve, never reject. */
export interface SkillRunner {
  readonly path: string;
  run(code: string, args: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: string; error?: string }>;
}

/** Builds the hands a skill program drives: the same raw reads and writes the body tools use. */
export function skillHands(body: BodyPort): SkillHands {
  let controls: Controls | undefined;
  return {
    async observe(args) { return renderObservation(await body.state(), Math.min(40, Math.max(1, args?.radius ?? 10))); },
    async find(args) { return findObjects(await body.state(), args ?? {}); },
    async map(args) { return renderMapAround(await body.state(), { ...args, radius: Math.min(20, Math.max(2, args?.radius ?? 8)) }); },
    async locations(args) { return locationsLine(await body.world(), args?.near); },
    async walkTo(args) {
      controls ??= controlsOf(await body.declaration());
      const result = await walkTo(body, controls, () => body.world(), { x: args.x, y: args.y, mode: args.mode === "adjacent" ? "adjacent" : "stand", ...(args.location ? { location: args.location } : {}) });
      return `${result.ok ? "OK" : "NOT REACHED"}: ${result.reason}. Now at ${result.location ?? "?"} (${result.x ?? "?"},${result.y ?? "?"}) after ${result.legs} leg(s).`;
    },
    async controls() { return (await body.declaration()).inputs.map((i) => `- ${i.id} (${i.kind}): ${i.description}`).join("\n"); },
    async input(args) { return describeRun(await body.run(args.steps, { ...(args.until ? { until: args.until } : {}) })); },
  };
}

/** The persona-wide skill library on disk, plus replay-through marking. */
export class SkillStore {
  public constructor(private readonly directory: string, private readonly game: string, private readonly runner: SkillRunner) {}

  public async list(): Promise<SkillRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return [];
    }
    const records: SkillRecord[] = [];
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      try {
        records.push(JSON.parse(await readFile(join(this.directory, name), "utf8")) as SkillRecord);
      } catch {
        // One unreadable file never hides the rest; skill_run names it when asked for.
      }
    }
    return records.sort((a, b) => a.name.localeCompare(b.name));
  }

  public async load(name: string): Promise<SkillRecord> {
    return JSON.parse(await readFile(join(this.directory, `${name}.json`), "utf8")) as SkillRecord;
  }

  /** Saves only what replayed cleanly; a failing replay is a refusal, not a stored skill. */
  public async save(name: string, purpose: string, code: string): Promise<string> {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(name)) throw new Error(`refused: a skill name is lowercase letters, digits and dashes (got ${JSON.stringify(name)})`);
    if (purpose.trim().length < 3 || purpose.length > 160) throw new Error("refused: the purpose is one line, 3-160 characters");
    if (code.trim().length === 0 || code.length > 20_000) throw new Error("refused: the code is empty or over 20,000 characters");
    const replay = await this.runner.run(code, {});
    if (!replay.ok) throw new Error(`refused: the replay failed, so nothing was saved (${replay.error})`);
    const record: SkillRecord = { version: "1", name, purpose: purpose.trim(), code, game: this.game, createdAt: new Date().toISOString(), uses: 0, lastRun: null, stale: null };
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, `${name}.json`), JSON.stringify(record, null, 2), "utf8");
    return `Saved skill ${name} (it just replayed cleanly).`;
  }

  /** Runs one saved skill; a run-time failure marks it stale and reports the error back. */
  public async run(name: string, args: unknown, signal?: AbortSignal): Promise<string> {
    const record = await this.load(name);
    const outcome = await this.runner.run(record.code, args, signal);
    const next: SkillRecord = { ...record, uses: record.uses + 1, lastRun: new Date().toISOString(), stale: outcome.ok ? null : (outcome.error ?? "failed") };
    await writeFile(join(this.directory, `${name}.json`), JSON.stringify(next, null, 2), "utf8");
    if (!outcome.ok) return `Skill ${name} failed${record.stale !== null ? " again (it was already stale)" : ""} and is marked stale: ${outcome.error}. Repair it with skill_save under the same name, or stop using it.`;
    return `Skill ${name} ran${record.stale !== null ? " (stale mark cleared)" : ""}: ${outcome.value ?? "(no return value)"}`;
  }
}

const PTC_TIMEOUT_MS = 180_000;

/** DSH's own PTC seam (`ctx.ptcRuntime`, the backend `run_code` uses), when the profile composes one. */
export interface PtcLike {
  readonly language: string;
  readonly timeout?: { defaultMs: number; maxMs: number };
  resolve(request: { program: string; bindings: unknown[]; timeoutMs?: number | null; signal?: AbortSignal }): unknown;
  run(spec: unknown): Promise<{ value?: unknown; logs?: string[]; error?: { message?: string } }>;
}

/** Wraps the seam for skill programs: `hands` as one binding namespace, `args` prepended as a literal. */
export class PtcRunner implements SkillRunner {
  public readonly path: string;
  private readonly hands: SkillHands;

  public constructor(private readonly ptc: PtcLike, hands: SkillHands) {
    this.path = `dsh-ptc (${ptc.language})`;
    this.hands = hands;
  }

  public async run(code: string, args: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: string; error?: string }> {
    const program = `const args = ${JSON.stringify(args ?? null)};\n${code}`;
    const functions: Record<string, (a: unknown) => Promise<string>> = {};
    for (const name of Object.keys(this.hands) as (keyof SkillHands)[]) {
      const fn = this.hands[name] as (a?: unknown) => Promise<string>;
      functions[name] = async (a) => fn(a === null ? undefined : a);
    }
    const cap = this.ptc.timeout?.maxMs ?? PTC_TIMEOUT_MS;
    try {
      const spec = this.ptc.resolve({ program, bindings: [{ global: "hands", functions }], timeoutMs: Math.min(PTC_TIMEOUT_MS, cap), ...(signal ? { signal } : {}) });
      const result = await this.ptc.run(spec);
      if (result.error !== undefined) return { ok: false, error: result.error.message ?? "the program failed" };
      return { ok: true, value: result.value === undefined ? `(no return value)${result.logs?.length ? `\n${result.logs.join("\n")}` : ""}` : String(result.value) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
