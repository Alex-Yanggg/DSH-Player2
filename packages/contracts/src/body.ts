import { z } from "zod";

/**
 * Body protocol (P2-0021, B line). The game adapter is a pure adapter: it
 * exports state as raw as it can and accepts raw input, nothing else. It never
 * learns "walk to" or "chop the tree"; navigation, goals, tactics and choices
 * live on the DSH plugin side. Transport is the session file lane
 * `<session>/body/` until W2 moves the same frames onto the Wire.
 *
 * Every frame carries `version`; task ids deduplicate, sequences are
 * monotonic, and every task can be cancelled.
 */
export const bodyProtocolVersion = "0.1" as const;

/** Upper bound of one task, cancel, status, speech or declaration frame. */
export const bodyFrameLimit = 64 * 1024;

/** Upper bound of one state/world file; larger than the turn lanes because the map travels raw. */
export const bodyStateFileLimit = 512 * 1024;

/** One button the adapter accepts. `hold` buttons have a duration, `press` buttons fire once per step. */
export const bodyInputSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,31}$/),
  kind: z.enum(["hold", "press", "modifier"]),
  /** Plain words a model can read: what the game does when this button is used. */
  description: z.string().min(1).max(400),
  /** A cheat-class input; usable only while a cheat switch is on. */
  cheat: z.boolean().optional(),
});
export type BodyInput = z.infer<typeof bodyInputSchema>;

/** One exported state field and what it means, for the model and the plugin libraries. */
export const bodyStateFieldSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(400),
});

/** What the adapter exports and what it can inject. Written once per save load. */
export const bodyDeclarationSchema = z.object({
  version: z.literal(bodyProtocolVersion),
  adapter: z.string().min(1),
  game: z.string().min(1),
  writtenAt: z.string().datetime(),
  state: z.object({
    file: z.literal("state.json"),
    world: z.literal("world.json"),
    description: z.string().min(1).max(800),
    fields: z.array(bodyStateFieldSchema).max(48),
    /** Characters used in `map.rows`, each with its meaning. */
    legend: z.record(z.string().length(1), z.string().min(1).max(120)),
  }),
  inputs: z.array(bodyInputSchema).min(1).max(48),
  limits: z.object({
    maxSteps: z.number().int().positive(),
    maxStepMs: z.number().int().positive(),
    /** Length of one game tick; durations are counted in unpaused game ticks. */
    tickMs: z.number().positive(),
    /** Walking distance per unpaused tick, in pixels, with `tilePx` pixels per tile. */
    walkPxPerTick: z.number().positive(),
    tilePx: z.number().int().positive(),
  }),
  cheats: z.object({
    /** The settings switch (`AllowCheatCapabilities`). */
    settingAllowed: z.boolean(),
  }),
});
export type BodyDeclaration = z.infer<typeof bodyDeclarationSchema>;

export const bodyItemSchema = z.object({
  slot: z.number().int().nonnegative(),
  id: z.string().min(1),
  name: z.string().min(1),
  stack: z.number().int().nonnegative(),
  category: z.string(),
  /** Tool-specific raw values, e.g. watering can level. */
  extra: z.record(z.string(), z.json()).optional(),
});
export type BodyItem = z.infer<typeof bodyItemSchema>;

const tileSchema = { x: z.number().int(), y: z.number().int() };

export const bodyActorSchema = z.object({
  location: z.string().min(1),
  ...tileSchema,
  px: z.number(),
  py: z.number(),
  facing: z.enum(["up", "right", "down", "left"]),
});

/** One thing standing on a tile, exported as the game holds it. */
export const bodyObjectSchema = z.object({
  ...tileSchema,
  kind: z.string().min(1).max(32),
  name: z.string().min(1).max(80),
  id: z.string().max(80).optional(),
  /** Raw per-kind values (crop phase, readiness, watered, health...). */
  extra: z.record(z.string(), z.json()).optional(),
});
export type BodyObject = z.infer<typeof bodyObjectSchema>;

export const bodyCharacterSchema = z.object({
  ...tileSchema,
  px: z.number(),
  py: z.number(),
  name: z.string().min(1).max(80),
  kind: z.enum(["npc", "monster", "farmer", "animal"]),
  health: z.number().optional(),
});
export type BodyCharacter = z.infer<typeof bodyCharacterSchema>;

export const bodyWarpSchema = z.object({
  ...tileSchema,
  to: z.string().min(1),
  toX: z.number().int(),
  toY: z.number().int(),
  /** `walk`: step onto it; `action`: face it and press the action button. */
  kind: z.enum(["walk", "action"]),
});
export type BodyWarp = z.infer<typeof bodyWarpSchema>;

/** The raw state stream: the adapter overwrites one file; `revision` only grows. */
export const bodyStateSchema = z.object({
  version: z.literal(bodyProtocolVersion),
  revision: z.number().int().nonnegative(),
  writtenAt: z.string().datetime(),
  tick: z.number().int().nonnegative(),
  /** Game time does not pass (menu, chat, event): held inputs do not advance. */
  paused: z.boolean(),
  time: z.object({
    day: z.number().int().positive(),
    season: z.string(),
    dayOfMonth: z.number().int(),
    year: z.number().int(),
    timeOfDay: z.number().int(),
    weather: z.string(),
  }),
  player: bodyActorSchema.extend({
    name: z.string(),
    money: z.number().int(),
    health: z.number(),
    stamina: z.number(),
    items: z.array(bodyItemSchema).max(48),
  }),
  body: bodyActorSchema.extend({
    present: z.boolean(),
    moving: z.boolean(),
    selectedSlot: z.number().int().nonnegative(),
    stamina: z.number(),
    items: z.array(bodyItemSchema).max(48),
    activeTask: z.number().int().positive().nullable(),
  }).nullable(),
  map: z.object({
    location: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** One string per row, one legend character per tile. */
    rows: z.array(z.string()),
  }),
  objects: z.array(bodyObjectSchema),
  characters: z.array(bodyCharacterSchema),
  warps: z.array(bodyWarpSchema),
  truncated: z.object({ objects: z.number().int().nonnegative() }),
});
export type BodyState = z.infer<typeof bodyStateSchema>;

/** The location graph; written at day start and save load. */
export const bodyWorldSchema = z.object({
  version: z.literal(bodyProtocolVersion),
  writtenAt: z.string().datetime(),
  locations: z.array(z.object({
    name: z.string().min(1),
    displayName: z.string(),
    outdoors: z.boolean(),
    warps: z.array(bodyWarpSchema),
  })),
});
export type BodyWorld = z.infer<typeof bodyWorldSchema>;

/** One step of an input sequence: buttons held for `ms`, presses fired at the step start. */
export const bodyInputStepSchema = z.object({
  hold: z.array(z.string().min(1)).max(4).optional(),
  press: z.array(z.string().min(1)).max(4).optional(),
  ms: z.number().int().min(0).max(60_000),
});
export type BodyInputStep = z.infer<typeof bodyInputStepSchema>;

/** Conditions under which the adapter ends a sequence early and reports why. */
export const bodyUntilSchema = z.object({
  arrive: z.object({ location: z.string().min(1), ...tileSchema, radius: z.number().int().min(0).max(8) }).optional(),
  /** Held movement produced no displacement for this long. */
  blockedMs: z.number().int().min(50).max(10_000).optional(),
  /** A monster came within this many tiles. */
  monsterWithin: z.number().min(0).max(20).optional(),
  /** The body changed location. */
  warped: z.boolean().optional(),
});
export type BodyUntil = z.infer<typeof bodyUntilSchema>;

/** Plugin -> adapter: `body/input/task-<seq>.json`, write-once. A newer task replaces the running one. */
export const bodyTaskSchema = z.object({
  version: z.literal(bodyProtocolVersion),
  taskId: z.string().uuid(),
  seq: z.number().int().positive(),
  createdAt: z.string().datetime(),
  steps: z.array(bodyInputStepSchema).min(1).max(64),
  until: bodyUntilSchema.optional(),
  /** Ask the adapter for a faster state cadence while this task runs (reflexes). */
  fastState: z.boolean().optional(),
});
export type BodyTask = z.infer<typeof bodyTaskSchema>;

/** Plugin -> adapter: `body/input/cancel-<seq>.json`, write-once. */
export const bodyCancelSchema = z.object({
  version: z.literal(bodyProtocolVersion),
  seq: z.number().int().positive(),
  taskId: z.string().uuid(),
  at: z.string().datetime(),
});
export type BodyCancel = z.infer<typeof bodyCancelSchema>;

export const bodyTaskStatusValues = ["accepted", "running", "done", "interrupted", "failed", "cancelled"] as const;
export const bodyTerminalStatuses = new Set(["done", "interrupted", "failed", "cancelled"]);

export const bodyEventSchema = z.object({
  tick: z.number().int().nonnegative(),
  kind: z.string().min(1).max(32),
  detail: z.string().max(240),
});
export type BodyEvent = z.infer<typeof bodyEventSchema>;

/** Adapter -> plugin: `body/status/task-<seq>.json`, replaced on every change; `update` only grows. */
export const bodyTaskStatusSchema = z.object({
  version: z.literal(bodyProtocolVersion),
  taskId: z.string().uuid(),
  seq: z.number().int().positive(),
  status: z.enum(bodyTaskStatusValues),
  update: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  events: z.array(bodyEventSchema).max(32),
  /** Why a sequence ended early or failed (`arrived`, `blocked`, `monster`, `warped`, `preempted`, `unknown-input`, `cheat-off`...). */
  reason: z.string().max(240).nullable(),
  stateRevision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type BodyTaskStatus = z.infer<typeof bodyTaskStatusSchema>;

/** Plugin -> adapter: one line the companion says in the world, `<session>/speech/say-<seq>.json`. */
export const bodySpeechSchema = z.object({
  version: z.literal(bodyProtocolVersion),
  seq: z.number().int().positive(),
  text: z.string().trim().min(1).max(400),
  at: z.string().datetime(),
});
export type BodySpeech = z.infer<typeof bodySpeechSchema>;
