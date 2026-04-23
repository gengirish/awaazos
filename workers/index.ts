/**
 * BullMQ worker entry — voice parse telemetry; extend with receipt workers in Phase 3+.
 */
import "./voiceLog.worker";
import "./receipt.worker";

console.log("[worker] voiceLog ready");
console.log("[worker] receipt ready");
