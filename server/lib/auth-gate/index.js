// server/lib/auth-gate/index.js (barrel)
//
// Re-exports the public surface of auth-gate for clean imports:
//   import { dispatchMCP, evaluate, buildEnvelope, DECISION } from "./lib/auth-gate/index.js";

export { dispatchMCP } from "./dispatch.js";
export { evaluate, DECISION } from "./evaluate.js";
export { buildEnvelope, applyDecision, hasAllEnvelopeFields, newTraceId, RISK_TO_AUTHORITY, DEFAULT_TTL_MS } from "./envelope.js";

// Gates — exported for advanced/test usage
export { check as checkSovereignty } from "./gates/sovereignty.js";
export { check as checkCapability } from "./gates/capability.js";
export { check as checkRefusal } from "./gates/refusal.js";
export { check as checkProvenance } from "./gates/provenance.js";
export { check as checkExpiration } from "./gates/expiration.js";
export { check as checkPreconditions } from "./gates/preconditions.js";
export { check as checkIdempotency, recordResult as recordIdempotentResult, hashEnvelope, _resetCache as _resetIdempotencyCache } from "./gates/idempotency.js";
export { check as checkVerification } from "./gates/verification.js";
export { check as checkResource } from "./gates/resource.js";
export { check as checkRollback } from "./gates/rollback.js";