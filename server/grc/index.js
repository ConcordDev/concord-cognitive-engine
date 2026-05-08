/**
 * GRC v1 Module — Grounded Recursive Closure
 *
 * Entry point for the GRC output spec. Registers macros, provides the
 * formatAndValidate() pipeline that wraps llmChat output, and exposes
 * metrics for observability.
 *
 * Integration:
 *   import { init as initGRC } from "./grc/index.js";
 *   const grcModule = await initGRC({ register, STATE, helpers });
 *
 * Then call grcModule.formatAndValidate(rawLLMOutput, context) to get
 * the canonical GRC output shape.
 */

import { GRC_JSON_SCHEMA, validateGRC } from "./schema.js";
import { formatGRC, getGRCSystemPrompt } from "./formatter.js";
export { getGRCSystemPrompt };
import { runGRCInvariantChecks, CORE_INVARIANTS } from "./invariants.js";

// ---- Module State ----

const GRC_METRICS = {
  totalOutputs: 0,
  validOutputs: 0,
  repairedOutputs: 0,
  failedOutputs: 0,
  structuredParses: 0,
  envelopeWraps: 0,
  invariantRepairs: 0,
  forbiddenPatternHits: 0,
  compressionHits: 0,
};

// ---- Core Pipeline ----

/**
 * Full GRC pipeline: format → invariant check → validate → emit.
 *
 * @param {string} rawContent - Raw LLM output text
 * @param {object} context - Execution context (dtuRefs, macroRefs, mode, etc.)
 * @param {object} opts - Server bindings
 * @param {function} opts.inLatticeReality - Chicken2 reality gate
 * @param {object} opts.STATE - Server state
 * @param {object} opts.affectState - Current affect state
 * @returns {{ ok, grc, raw, validation, repairs, failures, metrics }}
 */
export function formatAndValidate(rawContent, context = {}, opts = {}) {
  GRC_METRICS.totalOutputs++;

  // Step 1: Format raw content into GRC shape
  const formatted = formatGRC(rawContent, context);

  if (!formatted.grc) {
    GRC_METRICS.failedOutputs++;
    return {
      ok: false,
      grc: null,
      raw: rawContent,
      validation: { valid: false, errors: ["Failed to format into GRC shape"], warnings: [] },
      repairs: [],
      failures: ["Format failed"],
      metrics: { ...GRC_METRICS },
    };
  }

  // Track parse method
  if (formatted.raw !== formatted.grc.payload) {
    GRC_METRICS.structuredParses++;
  } else {
    GRC_METRICS.envelopeWraps++;
  }

  // Step 2: Run invariant checks (may repair)
  const invariantResult = runGRCInvariantChecks(formatted.grc, {
    inLatticeReality: opts.inLatticeReality,
    STATE: opts.STATE,
    affectState: opts.affectState,
  });

  if (invariantResult.repairs.length > 0) {
    GRC_METRICS.repairedOutputs++;
    GRC_METRICS.invariantRepairs += invariantResult.repairs.length;
  }

  // Step 3: Final validation
  const finalValidation = validateGRC(invariantResult.grc);

  if (finalValidation.valid) {
    GRC_METRICS.validOutputs++;
  } else {
    GRC_METRICS.failedOutputs++;
  }

  return {
    ok: finalValidation.valid,
    grc: invariantResult.grc,
    raw: rawContent,
    validation: finalValidation,
    repairs: invariantResult.repairs,
    failures: invariantResult.failures,
    metrics: { ...GRC_METRICS },
  };
}

// ---- Init (Macro Registration) ----

/**
 * Initialize GRC module and register macros.
 */
export function init({ register, STATE, helpers }) {
  // Register GRC macros

  register("grc", "format", (ctx, input) => {
    const { content, dtuRefs, macroRefs, stateRefs, mode, invariantsApplied, realitySnapshot } = input;
    const result = formatAndValidate(
      content,
      { dtuRefs, macroRefs, stateRefs, mode, invariantsApplied, realitySnapshot },
      {
        inLatticeReality: helpers?.inLatticeReality || null,
        STATE,
        affectState: null,
      }
    );
    return result;
  }, {
    description: "Format raw LLM output into GRC v1 shape with invariant checks",
    inputExample: {
      content: "Here is my analysis of the DTU...",
      dtuRefs: ["Genesis", "Chicken2 Laws"],
      mode: "governed-response",
    },
    outputExample: {
      ok: true,
      grc: {
        toneLock: "Aligned.",
        anchor: { dtus: ["Genesis", "Chicken2 Laws"], mode: "governed-response" },
        invariants: ["NoNegativeValence", "RealityGateBeforeEffects"],
        reality: { facts: [], assumptions: [], unknowns: [] },
        payload: "Analysis...",
        nextLoop: { name: "DTU Context Deepening", why: "..." },
        question: "Which DTU anchor should be deepened next?",
      },
    },
  });

  register("grc", "validate", (ctx, input) => {
    const { grc } = input;
    // validateGRC returns {valid, errors[], warnings[]}. Wrap so the macro
    // contract holds: ok mirrors valid; the validation detail rides along.
    const r = validateGRC(grc);
    return { ok: !!r?.valid, ...r };
  }, {
    description: "Validate a GRC output object against the spec",
  });

  register("grc", "systemPrompt", (ctx, input) => {
    const { anchors } = input || {};
    return { ok: true, prompt: getGRCSystemPrompt(anchors) };
  }, {
    description: "Get the GRC system prompt for LLM instruction",
  });

  register("grc", "metrics", () => {
    return { ok: true, metrics: { ...GRC_METRICS } };
  }, {
    description: "Get GRC pipeline metrics",
  });

  register("grc", "schema", () => {
    return { ok: true, schema: GRC_JSON_SCHEMA };
  }, {
    description: "Get the GRC JSON schema for external validation",
  });

  register("grc", "invariants", () => {
    return { ok: true, invariants: CORE_INVARIANTS };
  }, {
    description: "List core GRC invariants",
  });

  return {
    name: "grc",
    version: "1.0.0",
    macros: ["format", "validate", "systemPrompt", "metrics", "schema", "invariants"],
    formatAndValidate,
    getGRCSystemPrompt,
    validateGRC,
    CORE_INVARIANTS,
  };
}
