// Failure categories for macro/lens completion reporting (spec §13).

/** @typedef {typeof FAILURE_TYPES[number]} FailureType */

export const FAILURE_TYPES = Object.freeze([
  "REGISTRATION_FAILURE",
  "DISCOVERY_FAILURE",
  "IMPORT_FAILURE",
  "DISPATCH_FAILURE",
  "ARGUMENT_FAILURE",
  "RUNTIME_FAILURE",
  "CORRECTNESS_FAILURE",
  "VERIFICATION_FAILURE",
  "LOGGING_FAILURE",
  "LENS_WIRING_FAILURE",
  "EXTERNAL_DEPENDENCY_FAILURE",
  "STATE_FAILURE",
  "PERMISSION_FAILURE",
  "TIMEOUT",
  "UNKNOWN",
]);

/** @typedef {typeof COMPLETION_STATUS[number]} CompletionStatus */

export const COMPLETION_STATUS = Object.freeze([
  "VERIFIED",
  "BLOCKED_EXTERNAL_DEPENDENCY",
  "BLOCKED_REQUIRES_INTERACTIVE_STATE",
  "FAILED_BUG",
  "FAILED_INCORRECT_RESULT",
  "DEPRECATED",
  "INTENTIONALLY_DISABLED",
  "UNEXERCISED",
  "REGISTERED_ONLY",
]);

export function isFailureType(v) {
  return FAILURE_TYPES.includes(v);
}

export default { FAILURE_TYPES, COMPLETION_STATUS, isFailureType };
