import { bodyProtocolVersion, type BodyDeclaration } from "@dsh-player2/contracts";
import { SimAdapter, type SimLocation, type SimTaskState } from "./sim-adapter.js";

/** toy2 "Keycraft", ported from research/behavior-debate/bench as sim data (P2-0019 T4): its own map,
 *  buttons and interactions on the unchanged sim engine. The goal: 3 Wood + 2 Stone -> Crown at the bench. */
const ROWS = "#############,#.......#...#,#.......#...#,#...........#,#.......#...#,#.......#####,#...........#,#.......#...#,#.......#...#,#############".split(",");
const OBJECTS = () => [
  { x: 2, y: 2, kind: "key", name: "Red Key", extra: { color: "red" } },
  { x: 11, y: 1, kind: "key", name: "Blue Key", extra: { color: "blue" } },
  { x: 8, y: 3, kind: "door", name: "Red Door", extra: { key: "Red Key", passable: false } },
  { x: 8, y: 6, kind: "door", name: "Blue Door", extra: { key: "Blue Key", passable: false } },
  { x: 6, y: 2, kind: "bench", name: "Workbench", extra: { passable: false } },
  { x: 6, y: 7, kind: "material", name: "Wood" }, { x: 10, y: 1, kind: "material", name: "Wood" }, { x: 10, y: 3, kind: "material", name: "Wood" },
  { x: 10, y: 7, kind: "material", name: "Stone" }, { x: 11, y: 8, kind: "material", name: "Stone" },
];

export const TOY2_GOAL = "Craft the Crown at the workbench: pick up keys and materials with KeyE, unlock the matching doors, collect 3 Wood and 2 Stone, then stand next to the workbench and press KeyC.";

const DECLARATION = (): BodyDeclaration => ({
  version: bodyProtocolVersion, adapter: "sim-toy2", game: "toy2-keycraft", writtenAt: new Date().toISOString(),
  state: { file: "world_state", world: "world_map", description: "Keycraft workshop.", fields: [{ name: "map", description: "rows" }], legend: { ".": "floor", "#": "wall" } },
  inputs: [
    { id: "KeyW", kind: "hold", description: "move up", role: "up" }, { id: "KeyD", kind: "hold", description: "move right", role: "right" },
    { id: "KeyS", kind: "hold", description: "move down", role: "down" }, { id: "KeyA", kind: "hold", description: "move left", role: "left" },
    { id: "KeyE", kind: "press", description: "interact: pick up a key or material, unlock a door", role: "action" },
    { id: "KeyC", kind: "press", description: "craft at the workbench" },
  ],
  limits: { maxSteps: 64, maxStepMs: 10_000, tickMs: 1000 / 60, walkPxPerTick: 4, tilePx: 64 },
  cheats: { settingAllowed: false },
});

/** The whole Keycraft game: its own buttons and interactions, the sim's engine unchanged. */
export class Toy2Adapter extends SimAdapter {
  public constructor() {
    super({
      locations: [{ name: "Workshop", rows: [...ROWS], warps: [], objects: OBJECTS(), characters: [] } as SimLocation],
      body: { location: "Workshop", x: 2, y: 7, items: [] },
      directions: { KeyW: [0, -1, "up"], KeyD: [1, 0, "right"], KeyS: [0, 1, "down"], KeyA: [-1, 0, "left"] },
    });
  }

  public declaration(): Promise<BodyDeclaration> { return Promise.resolve(DECLARATION()); }
  protected declaredInputs() { return DECLARATION().inputs; }

  protected press(id: string, task: SimTaskState): void {
    if (id !== "KeyE" && id !== "KeyC") return super.press(id, task);
    const at = this.location().objects.find((o) => o.x === this.faced().x && o.y === this.faced().y);
    if (id === "KeyE" && at) {
      if (at.kind === "door") {
        const key = String(at.extra?.key);
        if (this.held(key) < 1) return this.note(task, "locked", at.name + " needs the " + key);
        this.location().objects.splice(this.location().objects.indexOf(at), 1);
        return this.note(task, "unlocked", at.name);
      }
      this.location().objects.splice(this.location().objects.indexOf(at), 1);
      this.gain({ id: "(O) " + at.name, name: at.name, category: at.kind === "key" ? "Key" : "Material" });
      return this.note(task, "picked-up", at.name);
    }
    if (id === "KeyC" && at?.kind === "bench") {
      if (this.held("Wood") < 3 || this.held("Stone") < 2) return this.note(task, "crafting-refused", "needs 3 Wood and 2 Stone");
      this.spend("Wood", 3);
      this.spend("Stone", 2);
      this.gain({ id: "(O) Crown", name: "Crown", category: "Craft" });
      return this.note(task, "crafted", "Crown");
    }
    this.note(task, "nothing-there", "no " + (id === "KeyE" ? "interaction" : "bench") + " here");
  }
}
