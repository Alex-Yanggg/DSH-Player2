import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { actionRequestSchema, bridgeFileLimit, decisionTurnVersion } from "@dsh-player2/contracts";

/**
 * The only DSH-facing operation the dispatcher needs: drive one Player decision
 * turn to an immutable bridge request (awaiting-player or autonomous).
 * Implementations must resolve only after that request file exists and
 * validates; the model's own words are not proof.
 */
export interface DecisionTurnRunner {
  runDecisionTurn(sequence: number): Promise<void>;
}

export class RequestNotWrittenError extends Error {
  public constructor(sequence: number, cause: string) {
    super(`Decision turn ${sequence} produced no valid bridge request: ${cause}`);
    this.name = "RequestNotWrittenError";
  }
}

/** Read one outbox request without following model-controlled paths. */
export async function readBridgeRequest(bridgeDirectory: string, sequence: number): Promise<unknown> {
  const path = join(bridgeDirectory, "outbox", `request-${sequence}.json`);
  let serialized: string;
  try {
    if (await stat(path).then((stats) => stats.size > bridgeFileLimit)) {
      throw new Error();
    }
    serialized = await readFile(path, "utf8");
  } catch {
    throw new RequestNotWrittenError(sequence, `outbox/request-${sequence}.json is missing, oversized, or unreadable`);
  }
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new RequestNotWrittenError(sequence, `outbox/request-${sequence}.json is not valid JSON`);
  }
}

/**
 * Verify that the Player file bridge received a bridge request for this sequence.
 * This file check, never the model's final message, is the dispatcher's completion signal.
 */
export async function verifyRequestWritten(bridgeDirectory: string, sequence: number): Promise<void> {
  const request = actionRequestSchema.safeParse(await readBridgeRequest(bridgeDirectory, sequence));
  if (!request.success) {
    throw new RequestNotWrittenError(sequence, "the persisted request does not match the action request schema");
  }
  if (request.data.sequence !== sequence) {
    throw new RequestNotWrittenError(sequence, `the persisted request declares sequence ${request.data.sequence}`);
  }
}
