import { DeepSeekHarness, type DeepSeekHarnessOptions, type RunResult } from "@deepseek-ai/dsh-sdk-client";
import type { DshTextRunner } from "@dsh-player2/runtime";

export interface DshSdkTextRunnerOptions {
  readonly launch: DeepSeekHarnessOptions["launch"];
  readonly cwd: string;
  readonly provider?: string;
  readonly model?: string;
  readonly maxTokens?: number;
}

/**
 * DSH's public SDK adapter for a Player social turn.
 *
 * A fresh session is used for each turn because Player's explicit observation, memory, and receipt
 * trace is the complete model context. The caller owns an isolated DSH configuration with no tools.
 */
export class DshSdkTextRunner implements DshTextRunner {
  private readonly harness: DeepSeekHarness;
  private nextSessionNumber = 0;
  private latestEvents: RunResult["events"] = [];

  public constructor(options: DshSdkTextRunnerOptions) {
    this.harness = new DeepSeekHarness({
      launch: options.launch,
      cwd: options.cwd,
      provider: options.provider ?? "deepseek-official",
      model: options.model ?? "deepseek-v4-flash",
      maxTokens: options.maxTokens ?? 600,
    });
  }

  public async runStructuredText(prompt: string): Promise<string> {
    this.nextSessionNumber += 1;
    const result = await this.harness.run(prompt, { sessionId: `player2-social-${this.nextSessionNumber}` });
    this.latestEvents = result.events;
    return result.finalResponse;
  }

  /** Events returned by the public DSH SDK for the latest completed social session. */
  public get lastRunEvents(): RunResult["events"] {
    return this.latestEvents;
  }

  public close(): Promise<void> {
    return this.harness.close();
  }
}
