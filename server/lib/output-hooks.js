/**
 * Output Hooks — Middleware for checking AI outputs before delivery
 *
 * Wires user-constitution checking and cognitive fingerprint recording
 * into the response pipeline. Import and call from chat/response handlers.
 *
 * Usage in any response handler:
 *   import outputHooks from '../lib/output-hooks.js';
 *   const processed = await outputHooks.processOutput(userId, outputText, { lens, domain });
 *   // processed.text may be modified, processed.flags may contain warnings
 */

import { checkOutput } from "../emergent/user-constitution.js";
import { recordQuery } from "../emergent/cognitive-fingerprint.js";
import { findRelevantInsights } from "../emergent/ghost-threads.js";
import logger from "../logger.js";

/**
 * Process an AI output through all hooks before delivery.
 *
 * @param {string} userId
 * @param {string} text - The output text
 * @param {object} context
 * @param {string} [context.lens] - Current lens
 * @param {string} [context.domain] - Current domain
 * @param {string} [context.query] - Original user query (for fingerprint)
 * @param {string[]} [context.tags]
 * @returns {{ text: string, flags: object[], blocked: boolean, ghostInsights: object[] }}
 */
async function processOutput(userId, text, context = {}) {
  const flags = [];
  let blocked = false;
  let processedText = text;
  let ghostInsights = [];

  // 1. Check against user's personal constitution
  try {
    const constitutionResult = checkOutput(userId, text, context);
    if (!constitutionResult.pass) {
      for (const violation of constitutionResult.violations) {
        flags.push({
          type: "constitution_violation",
          rule: violation.statement,
          category: violation.category,
          action: violation.action,
        });
      }

      if (constitutionResult.action === "block") {
        blocked = true;
        processedText = "[This response was blocked by your personal constitution rules. " +
          `Rule: "${constitutionResult.violations[0]?.statement || 'Unknown'}"]`;
      } else if (constitutionResult.action === "flag") {
        // Add flag notice but deliver
        processedText = text + "\n\n---\n_Note: This response may conflict with your personal rules: " +
          constitutionResult.violations.map(v => v.statement).join("; ") + "_";
      }
    }
  } catch (err) {
    logger.debug("output-hooks", `Constitution check failed: ${err.message}`);
  }

  // 2. Record query for cognitive fingerprint
  if (context.query) {
    try {
      recordQuery(userId, {
        text: context.query,
        domain: context.lens || context.domain,
        depth: context.depth || 0.5,
        tags: context.tags || [],
      });
    } catch (err) {
      logger.debug("output-hooks", `Fingerprint recording failed: ${err.message}`);
    }
  }

  // 3. Check for relevant ghost insights to surface
  if (context.query) {
    try {
      ghostInsights = findRelevantInsights(context.query, context.tags || []);
    } catch (err) {
      logger.debug("output-hooks", `Ghost insight lookup failed: ${err.message}`);
    }
  }

  return { text: processedText, flags, blocked, ghostInsights };
}

/**
 * Quick check — just constitution, no fingerprint or ghost threads.
 * For use in streaming responses where you need a fast check.
 */
function quickConstitutionCheck(userId, text, context = {}) {
  try {
    return checkOutput(userId, text, context);
  } catch (_) {
    return { pass: true, violations: [], action: "none" };
  }
}

export default { processOutput, quickConstitutionCheck };
