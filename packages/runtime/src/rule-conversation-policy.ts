import type { ConversationPolicy, SocialContext, SocialResponse } from "@dsh-player2/contracts";

/**
 * A transparent offline policy used as the replay baseline and as a provider-outage fallback.
 *
 * It does not parse instructions into actions. A request to perform a game action is answered as
 * a negotiation, while a semantic observation can support a short reply or suggestion.
 */
export class RuleConversationPolicy implements ConversationPolicy {
  public async respond(context: SocialContext): Promise<SocialResponse> {
    const content = context.message.content.trim();
    const observationIds = context.observations.map((observation) => observation.id);
    const latestReceipt = context.latestReceipt;

    if (this.requestsAction(content)) {
      return this.response(
        "disagreement",
        "I can talk through that with you, but I cannot turn a chat message into a game action.",
        observationIds,
      );
    }
    if (observationIds.length === 0) {
      return this.response("uncertain", "I do not have a current world fact to answer that honestly.", []);
    }
    if (this.requestsReason(content)) {
      return this.response(
        "reply",
        "I am answering from the current game facts I was given, not from a claim that I can see more than that.",
        observationIds,
      );
    }
    if (this.requestsSuggestion(content)) {
      return this.response(
        "suggestion",
        "Let us keep the next step small and check the current situation together before we promise anything larger.",
        observationIds,
        latestReceipt,
      );
    }
    return this.response(
      "question",
      "What outcome matters most to you for this game day? I want to understand before suggesting a plan.",
      observationIds,
    );
  }

  private response(
    kind: SocialResponse["kind"],
    text: string,
    basedOnObservationIds: readonly string[],
    latestReceipt: SocialContext["latestReceipt"] = null,
  ): SocialResponse {
    const rememberLatestReceipt = kind === "suggestion" && latestReceipt !== null && this.isMemorable(latestReceipt.status);
    return {
      kind,
      text,
      basedOnObservationIds: [...basedOnObservationIds],
      basedOnMemoryId: null,
      rememberLatestReceipt,
      memorySummary: rememberLatestReceipt
        ? `We recorded the ${latestReceipt.status} shared result for the next game day.`
        : null,
    };
  }

  private requestsAction(content: string): boolean {
    return /\b(do it|execute|water|mine|move|buy|fight)\b|去做|执行|浇水|挖矿|移动|购买|战斗/i.test(content);
  }

  private requestsReason(content: string): boolean {
    return /\b(why|what do you know)\b|为什么|知道什么/i.test(content);
  }

  private requestsSuggestion(content: string): boolean {
    return /\b(what should|suggest|plan)\b|做什么|建议|计划/i.test(content);
  }

  private isMemorable(status: string): boolean {
    return status === "completed" || status === "failed";
  }
}
