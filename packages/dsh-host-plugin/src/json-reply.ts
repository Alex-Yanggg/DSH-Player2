/**
 * Model replies on the 0.2 runtime sometimes arrive wrapped in one Markdown
 * code fence even when the policy forbids it. Unwrapping exactly one outer
 * fence is transport cleanup, not a fallback: the inner text must still be the
 * complete JSON object and pass the same schema and grounding checks, and
 * anything else still fails the turn with its trace id.
 */
const FENCED = /^```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

/** Strip one outer Markdown fence (with or without a language tag), if present. */
export function unwrapJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = FENCED.exec(trimmed);
  return match === null ? trimmed : match[1].trim();
}

/** Parse a model's final JSON reply after removing one outer fence. */
export function parseModelJson(text: string): unknown {
  return JSON.parse(unwrapJsonFence(text)) as unknown;
}
