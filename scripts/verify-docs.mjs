import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';

/** Returns Markdown files outside Git metadata. */
function findMarkdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findMarkdown(path);
    return extname(entry.name) === '.md' ? [path] : [];
  });
}

/** Fails the workflow when public docs have an invalid local contract. */
function verifyDocument(path) {
  const content = readFileSync(path, 'utf8');
  const headings = content.match(/^# (?!#)/gm) ?? [];
  if (headings.length !== 1) throw new Error(`${path} must contain exactly one H1.`);

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const location = target.split('#', 1)[0];
    if (location && !existsSync(resolve(dirname(path), normalize(location)))) {
      throw new Error(`${path} links to missing local target ${target}.`);
    }
  }
}

for (const path of findMarkdown(process.cwd())) verifyDocument(path);
console.log('Documentation checks passed.');
