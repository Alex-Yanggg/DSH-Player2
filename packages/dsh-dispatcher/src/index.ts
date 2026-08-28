/**
 * Harness-native auto-dispatch for the Player2 companion: watches the Player
 * file bridge and wakes one dedicated DSH session per decision turn.
 *
 * @module @dsh-player2/dsh-dispatcher
 */

export {
  BridgeDispatcher,
  type BridgeDispatcherOptions,
  type DispatcherLogger,
  type DispatcherStats,
} from "./dispatcher.js";
export {
  DshSessionDecisionRunner,
  RequestNotWrittenError,
  readBridgeRequest,
  verifyRequestWritten,
  type DshSessionDecisionRunnerOptions,
  type DecisionTurnRunner,
} from "./decision-runner.js";
