/**
 * "What she remembers" (P2-0016): a player-readable Markdown export of the
 * whole Persona Ledger. Visible memory is how players trust it and how bad
 * writes get caught; the export is rewritten after every dream and on demand
 * (`node scripts/ledger-export.mjs`).
 *
 * @module @dsh-player2/dsh-companion-plugin/mind/export
 */
import { join } from "node:path";
import { describeMood } from "./mood.js";
import type { PersonaLedger } from "./ledger.js";

/** Newest episodes listed per save. */
const EPISODES_LISTED = 40;

/** Render the ledger as Markdown. */
export async function ledgerMarkdown(ledger: PersonaLedger, companionName: string, now: Date): Promise<string> {
  const person = await ledger.person();
  const lines = [`# ${companionName} 记得什么`, "", `导出时间：${now.toISOString()}。这些是本地文件，可以随时查看、导出或删除（删除 \`ledger/\` 目录即可清空）。`, ""];
  const live = person.traits.filter((trait) => trait.status !== "retired");
  lines.push("## 特质", "");
  if (live.length === 0) lines.push("（还没有）");
  for (const trait of live) {
    lines.push(`- ${trait.text} — ${trait.status === "active" ? "已确立" : "观察中"}，置信度 ${trait.confidence.toFixed(2)}，范围 ${trait.scope}，证据 ${trait.evidence.join("、")}`);
  }
  lines.push("");
  const personaLessons = await ledger.facts("persona");
  if (personaLessons.length > 0) {
    lines.push("## 跨每个存档记住的", "");
    for (const lesson of personaLessons) lines.push(`- ${lesson.text} — ${lesson.topic}${lesson.uses > 1 ? `，用过 ${lesson.uses} 次` : ""}`);
    lines.push("");
  }
  for (const save of await ledger.saves()) {
    const [story, mood, read, facts] = await Promise.all([ledger.story(save), ledger.mood(save, now), ledger.episodes(save), ledger.facts(save)]);
    lines.push(`## 存档 ${save}`, "");
    lines.push(`**我们的故事：**${story === null || story.text.trim() === "" ? "（还没有）" : story.text}`, "");
    lines.push(`**此刻心情：**${describeMood(mood)}`, "");
    if (facts.length > 0) {
      lines.push("**这个存档教会它的：**", "");
      for (const fact of facts) lines.push(`- ${fact.text} — ${fact.topic}`);
      lines.push("");
    }
    lines.push(`**经历（最近 ${Math.min(EPISODES_LISTED, read.episodes.length)} / 共 ${read.episodes.length} 条${read.skipped > 0 ? `，${read.skipped} 行损坏已跳过` : ""}）：**`, "");
    for (const episode of read.episodes.slice(-EPISODES_LISTED).reverse()) {
      lines.push(`- \`${episode.id}\` ${episode.gameDay === null ? "" : `第 ${episode.gameDay} 天 · `}${episode.kind} · ${episode.summary}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Write `ledger/remember.md` and return its path. */
export async function writeLedgerExport(ledger: PersonaLedger, companionName: string, now: Date): Promise<string> {
  const path = join(ledger.root, "remember.md");
  await ledger.writeText(path, await ledgerMarkdown(ledger, companionName, now));
  return path;
}
