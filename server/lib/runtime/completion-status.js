// Map coverage contract outcomes → completion statuses (spec §15).

import { COMPLETION_STATUS } from "./macro-failure-taxonomy.js";
import { LENS_ACTION_STATUS } from "./lens-behavioral-contract.js";

/**
 * @param {object} row
 * @param {string} [row.contractStatus]
 * @param {string} [row.classification]
 * @param {string} [row.failureType]
 * @param {boolean} [row.oracleVerified]
 * @param {boolean} [row.skippedClassD]
 */
export function deriveCompletionStatus(row) {
  if (row.oracleVerified) return "VERIFIED";
  if (row.skippedClassD) return "BLOCKED_REQUIRES_INTERACTIVE_STATE";

  switch (row.contractStatus) {
    case LENS_ACTION_STATUS.PASSED:
      return "VERIFIED";
    case LENS_ACTION_STATUS.SKIPPED_BRAIN_BACKED:
      return "UNEXERCISED";
    case LENS_ACTION_STATUS.SKIPPED_EXTERNAL_DEPENDENCY:
      return "BLOCKED_EXTERNAL_DEPENDENCY";
    case LENS_ACTION_STATUS.SKIPPED_DESTRUCTIVE:
      return "INTENTIONALLY_DISABLED";
    case LENS_ACTION_STATUS.SKIPPED_STRUCTURED_FIXTURE:
      return "UNEXERCISED";
    case LENS_ACTION_STATUS.FAILED:
      if (row.failureType === "CORRECTNESS_FAILURE" || row.failureType === "VERIFICATION_FAILURE") {
        return "FAILED_INCORRECT_RESULT";
      }
      return "FAILED_BUG";
    default:
      return "REGISTERED_ONLY";
  }
}

export function isExercisedStatus(status) {
  return status === "VERIFIED" || status === "FAILED_BUG" || status === "FAILED_INCORRECT_RESULT";
}

export { COMPLETION_STATUS };
