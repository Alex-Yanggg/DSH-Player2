import { z } from "zod";

export const contractVersion = "0.1" as const;

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
  facts: z.record(z.string(), z.unknown()),
});
export type Observation = z.infer<typeof observationSchema>;

export const capabilityDescriptorSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
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
  intent: z.record(z.string(), z.unknown()),
  scope: z.string().min(1),
  reason: z.string().min(1),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const permissionGrantSchema = z.object({
  proposalId: z.string().min(1),
  granted: z.boolean(),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
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
