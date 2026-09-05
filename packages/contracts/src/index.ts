import { z } from "zod";

export const contractVersion = "0.1" as const;

export const decisionTurnVersion = "0.1.1" as const;

export const accessModeSchema = z.enum(["semantic", "network", "vision"]);
export type AccessMode = z.infer<typeof accessModeSchema>;

export const observationSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  observedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  source: z.string().min(1),
  accessMode: accessModeSchema,
  confidence: z.number().min(0).max(1),
  facts: z.record(z.string(), z.json()),
});
export type Observation = z.infer<typeof observationSchema>;

export const capabilityDescriptorSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  scope: z.string().min(1),
  accessMode: accessModeSchema,
  requiresExplicitConsent: z.boolean(),
  isReversible: z.boolean(),
  inputSchemaRef: z.string().min(1),
});
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;

export const adapterDescriptorSchema = z.object({
  id: z.string().min(1),
  gameId: z.string().min(1),
  accessMode: accessModeSchema,
  capabilities: z.array(capabilityDescriptorSchema),
});
export type AdapterDescriptor = z.infer<typeof adapterDescriptorSchema>;

export const proposalSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  basedOnObservationIds: z.array(z.string().min(1)).min(1),
  capabilityId: z.string().min(1),
  intent: z.record(z.string(), z.json()),
  scope: z.string().min(1),
  reason: z.string().min(1),
  /** Persona-authored player-facing speech; hosts display it verbatim. */
  utterance: z.string().trim().min(1).max(800),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const permissionGrantSchema = z.object({
  proposalId: z.string().min(1),
  granted: z.boolean(),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  /**
   * Present only on the runtime's own autonomous authorization record, when a
   * `companion.autonomy: full` composition executes without a player answer.
   * It is a Player-side marker, never data the DSH side can produce.
   */
  autonomy: z.literal("full").optional(),
});
export type PermissionGrant = z.infer<typeof permissionGrantSchema>;

export const receiptSchema = z.object({
  proposalId: z.string().min(1),
  capabilityId: z.string().min(1),
  status: z.enum(["completed", "failed", "declined", "expired"]),
  occurredAt: z.string().datetime(),
  target: z.string().nullable(),
  scope: z.string().min(1),
  detail: z.string().min(1),
  /**
   * Autonomous-execution marker. Receipts written by the consult lane carry no
   * marker (their authorization was a player answer); receipts produced
   * without per-action consent must say so, because the receipt is the fact
   * source the next day's memory is projected from.
   */
  autonomy: z.literal("full").optional(),
});
export type ActionReceipt = z.infer<typeof receiptSchema>;

export interface ObservationRequest {
  readonly kinds: readonly string[];
}

export interface DecisionContext {
  readonly adapter: AdapterDescriptor;
  readonly observations: readonly Observation[];
}

export interface DecisionPolicy {
  decide(context: DecisionContext): Promise<Proposal | null>;
}

export interface ApprovedCommand {
  readonly proposal: Proposal;
  readonly grant: PermissionGrant;
}

export interface GameAdapter {
  readonly descriptor: AdapterDescriptor;
  observe(request: ObservationRequest): Promise<readonly Observation[]>;
  execute(command: ApprovedCommand): Promise<ActionReceipt>;
  present(receipt: ActionReceipt): Promise<void>;
}

export const playerMessageSchema = z.object({
  id: z.string().min(1),
  content: z.string().trim().min(1).max(800),
  createdAt: z.string().datetime(),
});
export type PlayerMessage = z.infer<typeof playerMessageSchema>;

export const socialResponseKindSchema = z.enum([
  "reply",
  "question",
  "disagreement",
  "suggestion",
  "uncertain",
]);
export type SocialResponseKind = z.infer<typeof socialResponseKindSchema>;

/** A constrained response that cannot request an adapter action. */
export const socialResponseSchema = z.object({
  kind: socialResponseKindSchema,
  text: z.string().trim().min(1).max(800),
  basedOnObservationIds: z.array(z.string().min(1)).max(8),
  basedOnMemoryId: z.string().min(1).nullable(),
  rememberLatestReceipt: z.boolean(),
  memorySummary: z.string().trim().min(1).max(400).nullable(),
}).refine(
  (response) => response.rememberLatestReceipt === (response.memorySummary !== null),
  "A receipt memory must have a summary, and only a receipt memory may have one.",
);
export type SocialResponse = z.infer<typeof socialResponseSchema>;

/** The one player-visible result that may be carried into the following game day. */
export const sharedOutcomeMemorySchema = z.object({
  id: z.string().min(1),
  sourceProposalId: z.string().min(1),
  gameDay: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  status: z.enum(["completed", "failed"]),
  target: z.string().nullable(),
  scope: z.string().min(1),
  summary: z.string().trim().min(1).max(400),
});
export type SharedOutcomeMemory = z.infer<typeof sharedOutcomeMemorySchema>;

export const socialTraceEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("observations"), at: z.string().datetime(), observations: z.array(observationSchema) }),
  z.object({ type: z.literal("player-message"), at: z.string().datetime(), message: playerMessageSchema }),
  z.object({ type: z.literal("latest-receipt"), at: z.string().datetime(), receipt: receiptSchema.nullable() }),
  z.object({ type: z.literal("response"), at: z.string().datetime(), response: socialResponseSchema }),
  z.object({ type: z.literal("memory-retained"), at: z.string().datetime(), memory: sharedOutcomeMemorySchema }),
  z.object({ type: z.literal("policy-fallback"), at: z.string().datetime(), reason: z.string().min(1) }),
]);
export type SocialTraceEvent = z.infer<typeof socialTraceEventSchema>;

export const socialTurnTraceSchema = z.object({
  version: z.literal("0.0.2"),
  id: z.string().min(1),
  gameDay: z.number().int().positive(),
  messageId: z.string().min(1),
  events: z.array(socialTraceEventSchema).min(3),
});
export type SocialTurnTrace = z.infer<typeof socialTurnTraceSchema>;

export interface SocialContext {
  readonly adapter: AdapterDescriptor;
  readonly gameDay: number;
  readonly observations: readonly Observation[];
  readonly priorMemory: SharedOutcomeMemory | null;
  readonly latestReceipt: ActionReceipt | null;
  readonly message: PlayerMessage;
}

/** Produces words only; it never receives an adapter executor or permission grant. */
export interface ConversationPolicy {
  respond(context: SocialContext): Promise<SocialResponse>;
}

/** Presentation belongs to the game host and is intentionally separate from game actions. */
export interface SocialPresenter {
  presentSocial(response: SocialResponse): Promise<void>;
}

/**
 * Player-authored stable persona commitments: the soul layer of the
 * companion's five-layer personality. Values, bonds, voice, and hard
 * boundaries travel beside the identity on every turn so the DSH side can
 * bind them into its system prompt as a constitution that turn data can
 * never rewrite.
 */
export const companionSoulSchema = z.object({
  values: z.array(z.string().trim().min(1).max(160)).min(1).max(8),
  bonds: z.array(z.string().trim().min(1).max(160)).min(1).max(8),
  voice: z.string().trim().min(1).max(240),
  boundaries: z.array(z.string().trim().min(1).max(160)).min(1).max(8),
});
export type CompanionSoul = z.infer<typeof companionSoulSchema>;

/** The player-chosen companion identity carried on one bridge turn. */
export const companionIdentitySchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  soul: companionSoulSchema,
});
export type CompanionIdentity = z.infer<typeof companionIdentitySchema>;

/** One receipt-grounded insight the companion drew about itself. */
export const companionGrowthInsightSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1).max(240),
  basedOnReceiptSequences: z.array(z.number().int().positive()).min(1).max(8),
  createdAt: z.string().datetime(),
});
export type CompanionGrowthInsight = z.infer<typeof companionGrowthInsightSchema>;

/**
 * Player-owned growth asset: the companion's self-authored interpretation of
 * its receipt-backed shared history, applied only from validated DSH reflect
 * proposals. There is deliberately no soul field — the deposit-model ruling
 * keeps the soul read-only, and this type makes that structurally true. The
 * asset is bounded (insights are trimmed oldest-first) and its revision is the
 * sequence of the last applied proposal, so stale proposals are rejected.
 */
export const companionGrowthSchema = z.object({
  version: z.literal(decisionTurnVersion),
  revision: z.number().int().nonnegative(),
  insights: z.array(companionGrowthInsightSchema).max(12),
  focus: z.string().trim().max(160).nullable(),
});
export type CompanionGrowth = z.infer<typeof companionGrowthSchema>;

/**
 * A DSH-authored, write-once growth proposal for one decision turn: bounded
 * insights grounded in receipt sequences the recall digest actually returned,
 * plus an optional self-chosen focus. The Player validates and applies it;
 * like an action request it is never executed from the DSH side.
 */
export const growthProposalSchema = z.object({
  version: z.literal(decisionTurnVersion),
  sequence: z.number().int().positive(),
  insights: z.array(z.object({
    text: z.string().trim().min(1).max(240),
    basedOnReceiptSequences: z.array(z.number().int().positive()).min(1).max(8),
  })).min(1).max(3),
  focus: z.string().trim().min(1).max(160).nullable(),
});
export type GrowthProposal = z.infer<typeof growthProposalSchema>;

/** Versioned, Player-owned file envelope for a live native DSH social turn. */
export const socialBridgeVersion = "0.0.9" as const;

export const socialBridgeTurnSchema = z.object({
  movementCommand: z.enum(["come", "follow", "stay"]).nullable().optional(),
  version: z.literal(socialBridgeVersion),
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  gameDay: z.number().int().positive(),
  companion: companionIdentitySchema,
  adapter: adapterDescriptorSchema,
  observations: z.array(observationSchema).min(1).max(8),
  priorMemory: sharedOutcomeMemorySchema.nullable(),
  latestReceipt: receiptSchema.nullable(),
  message: playerMessageSchema,
});
export type SocialBridgeTurn = z.infer<typeof socialBridgeTurnSchema>;

/** Only a completed DSH run may write a player-visible social response. */
export const socialBridgeResultSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.literal(socialBridgeVersion),
    id: z.string().uuid(),
    status: z.literal("completed"),
    source: z.literal("dsh"),
    traceId: z.string().min(1),
    sessionId: z.string().min(1),
    response: socialResponseSchema,
  }),
  z.object({
    version: z.literal(socialBridgeVersion),
    id: z.string().uuid(),
    status: z.literal("error"),
    source: z.literal("dsh"),
    traceId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1).max(800),
  }),
]);
export type SocialBridgeResult = z.infer<typeof socialBridgeResultSchema>;

/**
 * Autonomy tier of one composition. `consult` (default) keeps the
 * proposal → consent → execute chain; `full` skips per-action consent and the
 * Player host executes grounded proposals directly, still writing receipts.
 * Invalid values must fail loudly at mount time, never fall back silently.
 */
export const autonomyModeSchema = z.enum(["consult", "full"]);
export type AutonomyMode = z.infer<typeof autonomyModeSchema>;

/** The two request statuses the decision bridge knows. */
export const awaitingPlayerStatus = "awaiting-player" as const;
export const autonomousStatus = "autonomous" as const;

/**
 * Single byte bound for one persisted bridge file. Writers refuse more and
 * readers refuse to buffer more, so both ends drift together, never apart.
 */
export const bridgeFileLimit = 64 * 1024;

const decisionAdapterDescriptorSchema = adapterDescriptorSchema.extend({
  capabilities: z.array(capabilityDescriptorSchema).max(16),
});

/** Immutable Player-authored input for one DSH decision turn. */
export const decisionTurnEnvelopeSchema = z.object({
  version: z.literal(decisionTurnVersion),
  sequence: z.number().int().positive(),
  createdAt: z.string().datetime(),
  gameDay: z.number().int().positive(),
  adapter: decisionAdapterDescriptorSchema,
  observations: z.array(observationSchema).min(1).max(32),
  // The C# writer omits the field entirely when no identity is chosen
  // (JsonIgnoreCondition.WhenWritingNull), so absence is the null case.
  companion: companionIdentitySchema.optional(),
  // The companion's applied growth asset, attached by the Player host when one
  // exists. Same omission rule as `companion`; a mod built before the growth
  // lane simply never sends it, so both ends drift together, never apart.
  growth: companionGrowthSchema.optional(),
});
export type DecisionTurnEnvelope = z.infer<typeof decisionTurnEnvelopeSchema>;

/**
 * A DSH-authored request for one persisted proposal.
 *
 * `awaiting-player` (consult lane) waits for an explicit player answer.
 * `autonomous` (full lane) orders immediate Player-side execution through the
 * game adapter; the DSH side still cannot reach `GameAdapter.execute` — the
 * Player host performs and receipts every execution itself.
 */
export const actionRequestSchema = z.object({
  version: z.literal(decisionTurnVersion),
  sequence: z.number().int().positive(),
  status: z.union([z.literal(awaitingPlayerStatus), z.literal(autonomousStatus)]),
  proposal: proposalSchema,
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

/** A terminal DSH-host failure for a decision turn; never a local fallback. */
export const decisionBridgeErrorSchema = z.object({
  version: z.literal(decisionTurnVersion),
  sequence: z.number().int().positive(),
  traceId: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1).max(800),
});
export type DecisionBridgeError = z.infer<typeof decisionBridgeErrorSchema>;
