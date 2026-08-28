import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RuleConversationPolicy, SocialTurnCoordinator } from "../packages/runtime/dist/index.js";

const fixturePath = resolve(process.cwd(), process.argv[2] ?? "fixtures/social-turn/rainy-suggestion.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const adapter = {
  descriptor: { id: "fixture", gameId: "fixture-game", accessMode: "semantic", capabilities: [] },
  async observe() { return fixture.observations; },
};
const presented = [];
const presenter = { async presentSocial(response) { presented.push(response); } };
const result = await new SocialTurnCoordinator({ now: () => new Date(fixture.now) }).run(
  adapter,
  presenter,
  new RuleConversationPolicy(),
  {
    id: fixture.id,
    gameDay: fixture.gameDay,
    message: fixture.message,
    priorMemory: null,
    latestReceipt: fixture.latestReceipt,
  },
);
const traceTypes = result.trace.events.map((event) => event.type);
if (
  result.response.kind !== fixture.expected.responseKind ||
  result.retainedMemory?.id !== fixture.expected.memoryId ||
  JSON.stringify(traceTypes) !== JSON.stringify(fixture.expected.traceTypes) ||
  presented.length !== 1
) {
  throw new Error(`Social replay did not match fixture '${fixture.id}'.`);
}
console.log(`PASS ${fixture.id}: ${result.response.kind}; trace=${traceTypes.join(",")}`);
