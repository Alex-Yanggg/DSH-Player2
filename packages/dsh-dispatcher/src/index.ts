/**
 * Keyless bridge watcher used by the Player2 replays: it scans the Player file
 * bridge and hands each decision turn to an injected runner. Production turns
 * are drained by @dsh-player2/dsh-host-plugin inside DSH; this package has no
 * DSH dependency.
 *
 * @module @dsh-player2/dsh-dispatcher
 */

export {
  BridgeDispatcher,
  type BridgeDispatcherOptions,
  type DispatcherLogger,
  type DispatcherStats,
} from "./dispatcher.js";
export { BridgeLock } from "./bridge-lock.js";
export {
  RequestNotWrittenError,
  readBridgeRequest,
  verifyRequestWritten,
  type DecisionTurnRunner,
} from "./decision-runner.js";
