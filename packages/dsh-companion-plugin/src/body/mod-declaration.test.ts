import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bodyDeclarationSchema, bodyInputSchema, bodyStateFieldSchema } from "@dsh-player2/contracts";

/**
 * The Stardew mod writes the body declaration, but CI cannot compile it (the
 * game's assemblies are not redistributable). Its declared texts are plain
 * C# literals, so they are read from the source here and checked against the
 * same schemas the plugin parses the declaration with: one text over a cap
 * makes the whole declaration invalid and every body tool fails.
 */

const source = (file: string) => readFileSync(new URL(`../../../../stardew-mod/src/${file}`, import.meta.url), "utf8");
const LITERAL = String.raw`"((?:[^"\\]|\\.)*)"`;
const unquote = (text: string): string => JSON.parse(`"${text}"`) as string;
const all = (text: string, pattern: string) => [...text.matchAll(new RegExp(pattern, "g"))];

describe("the Stardew mod's declared texts fit the contracts", () => {
  const exporter = source("BodyStateExporter.cs");
  const adapter = source("BodyAdapter.cs");

  it("state fields", () => {
    const fields = all(exporter, String.raw`new\(${LITERAL}, ${LITERAL}\)`).map((m) => ({ name: unquote(m[1]!), description: unquote(m[2]!) }));
    expect(fields.length).toBeGreaterThanOrEqual(10);
    for (const field of fields) expect(bodyStateFieldSchema.safeParse(field).error?.issues, field.name).toBeUndefined();
    expect(fields.length).toBeLessThanOrEqual(48);
  });

  it("controller buttons", () => {
    const inputs = all(adapter, String.raw`new\(${LITERAL}, "(hold|press|modifier)", ${LITERAL}`).map((m) => ({ id: unquote(m[1]!), kind: m[2], description: unquote(m[3]!) }));
    expect(inputs.length).toBeGreaterThanOrEqual(10);
    for (const input of inputs) expect(bodyInputSchema.safeParse(input).error?.issues, input.id).toBeUndefined();
    expect(inputs.length).toBeLessThanOrEqual(48);
  });

  it("map legend and the state description", () => {
    const legendBlock = /Legend = new Dictionary<string, string>\s*\{([\s\S]*?)\};/.exec(exporter)?.[1] ?? "";
    const legend = Object.fromEntries(all(legendBlock, String.raw`\[${LITERAL}\] = ${LITERAL}`).map((m) => [unquote(m[1]!), unquote(m[2]!)]));
    expect(Object.keys(legend).length).toBeGreaterThanOrEqual(4);
    const description = unquote(new RegExp(String.raw`"world_map",\s*${LITERAL}`).exec(adapter)?.[1] ?? "");
    const state = bodyDeclarationSchema.shape.state.pick({ description: true, legend: true });
    expect(state.safeParse({ description, legend }).error?.issues).toBeUndefined();
  });
});
