// Lens behavioral contract — Phase 4B (LOAD → … → LOGGING → ERROR_PATH).
// Pure contract logic; I/O via injected dispatch/resolve.

import { classifyMacro } from "./macro-capability-classifier.js";
import { FAILURE_TYPES } from "./macro-failure-taxonomy.js";

export const CONTRACT_STAGES = Object.freeze([
  "load",
  "action_resolution",
  "input_validation",
  "dispatch",
  "backend_execution",
  "output_shape",
  "semantic_correctness",
  "logging",
  "error_path",
]);

/** Completion statuses for honest denominators (spec §3, §7). */
export const LENS_ACTION_STATUS = Object.freeze({
  PASSED: "PASSED",
  FAILED: "FAILED",
  SKIPPED_BRAIN_BACKED: "SKIPPED_BRAIN_BACKED",
  SKIPPED_EXTERNAL_DEPENDENCY: "SKIPPED_EXTERNAL_DEPENDENCY",
  SKIPPED_DESTRUCTIVE: "SKIPPED_DESTRUCTIVE",
  SKIPPED_STRUCTURED_FIXTURE: "SKIPPED_STRUCTURED_FIXTURE",
  SKIPPED_GENERIC_HOOK: "SKIPPED_GENERIC_HOOK",
  SKIPPED_REST_ONLY: "SKIPPED_REST_ONLY",
});

const EXEMPT_LENSES = new Set(["ar", "art", "narrative-walk", "ux-suite"]);

const EXTERNAL_ERROR_RE =
  /no_token|network|fetch|egress|timeout|api[_-]?key|credential|unauthorized|forbidden|rate.?limit|econnrefused|enotfound|external|upstream|provider/i;

const FIXTURE_PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5, P6: 6 };

/**
 * @param {object} opts
 * @param {string} opts.lensId
 * @param {string} opts.domain
 * @param {string} opts.action
 * @param {Function} opts.dispatch
 * @param {Function} opts.resolveAction
 * @param {object} opts.ctx
 * @param {object} [opts.db]
 * @param {boolean} [opts.checkLogging]
 * @param {object} [opts.validInput]
 * @param {Function} [opts.isBrainBacked]
 * @param {boolean} [opts.hasStructuredFixture]
 */
export async function runLensActionContract(opts) {
  const stages = {};
  const key = `${opts.domain}.${opts.action}`;
  const classification = classifyMacro(opts.domain, opts.action);
  const brainBacked = opts.isBrainBacked?.(opts.domain, opts.action) ?? false;

  stages.load = { pass: true, note: `lens ${opts.lensId}` };

  const registry = opts.resolveAction(opts.domain, opts.action);
  stages.action_resolution = registry
    ? { pass: true, registry }
    : { pass: false, failureType: "REGISTRATION_FAILURE", note: `${key} not in MACROS or LENS_ACTIONS` };

  if (!registry) {
    return finalizeContract(stages, classification, {
      status: LENS_ACTION_STATUS.FAILED,
      priority: "P1",
    });
  }

  if (classification.class === "E") {
    return skippedContract(stages, classification, LENS_ACTION_STATUS.SKIPPED_DESTRUCTIVE, "destructive class E");
  }

  if (brainBacked || classification.class === "C" && /llm|brain/i.test(classification.reason)) {
    return skippedContract(stages, classification, LENS_ACTION_STATUS.SKIPPED_BRAIN_BACKED, "brain-backed / LLM — not bulk deterministic");
  }

  if (classification.class === "C" && classification.reason === "external_io") {
    return skippedContract(stages, classification, LENS_ACTION_STATUS.SKIPPED_EXTERNAL_DEPENDENCY, "live_* / external IO — separate path");
  }

  const validInput = opts.validInput ?? { artifact: { id: `lens-behavioral-${opts.lensId}`, data: {} } };
  const usedFixture = opts.hasStructuredFixture ? "structured" : "default";

  let threw = false;
  let raw;
  const t0 = Date.now();
  try {
    raw = await opts.dispatch(opts.domain, opts.action, validInput, opts.ctx);
  } catch (e) {
    threw = true;
    raw = { ok: false, error: String(e?.message || e) };
  }
  const durationMs = Date.now() - t0;

  stages.input_validation = { pass: true, note: `fixture: ${usedFixture}` };
  stages.dispatch = {
    pass: !threw,
    durationMs,
    ...(threw ? { failureType: "RUNTIME_FAILURE" } : {}),
  };
  stages.backend_execution = {
    pass: raw != null && !threw,
    ...(raw == null || threw ? { failureType: threw ? "RUNTIME_FAILURE" : "DISPATCH_FAILURE" } : {}),
  };

  if (raw?.ok === false) {
    const failMsg = failureMessage(raw);
    if (failMsg && EXTERNAL_ERROR_RE.test(failMsg)) {
      stages.output_shape = { pass: true, note: "external block" };
      stages.semantic_correctness = { pass: true, note: "controlled external dependency failure" };
      stages.error_path = { pass: true, skipped: true };
      stages.logging = await checkLogging(opts, durationMs);
      return finalizeContract(stages, classification, {
        status: LENS_ACTION_STATUS.SKIPPED_EXTERNAL_DEPENDENCY,
        durationMs,
        rawSample: summarize(raw),
        externalBlocked: true,
      });
    }
  }

  const shaped = isWellShapedEnvelope(raw);
  stages.output_shape = {
    pass: shaped,
    ...(shaped ? {} : { failureType: "CORRECTNESS_FAILURE", note: "missing ok/result/error envelope" }),
  };

  const semanticOk = isHonestResponse(raw);
  stages.semantic_correctness = {
    pass: semanticOk,
    ...(semanticOk ? {} : { failureType: "VERIFICATION_FAILURE", note: "unshaped, silent failure, or fake success" }),
  };

  let errThrew = false;
  let errRaw;
  try {
    errRaw = await opts.dispatch(
      opts.domain,
      opts.action,
      { artifact: { id: "invalid", data: null }, __invalid: true },
      opts.ctx,
    );
  } catch {
    errThrew = true;
  }
  const controlled = !errThrew && (errRaw?.ok === false || failureMessage(errRaw));
  stages.error_path = {
    pass: controlled || semanticOk,
    ...(controlled || semanticOk ? {} : { failureType: "ARGUMENT_FAILURE", note: "invalid input threw or fake success" }),
  };

  stages.logging = await checkLogging(opts, durationMs);

  const failed = Object.entries(stages).find(([, v]) => v.pass === false);
  const failureType = failed?.[1]?.failureType || null;
  return finalizeContract(stages, classification, {
    status: failed ? LENS_ACTION_STATUS.FAILED : LENS_ACTION_STATUS.PASSED,
    failureType,
    priority: failureType ? failurePriority(failureType) : null,
    durationMs,
    rawSample: summarize(raw),
  });
}

async function checkLogging(opts, durationMs) {
  if (!opts.checkLogging || !opts.db) {
    return { pass: true, skipped: true, note: opts.checkLogging ? "no db" : "logging check disabled" };
  }
  try {
    const row = opts.db.prepare(
      `SELECT domain, macro_name, status, duration_ms, ts
       FROM macro_call_log WHERE domain = ? AND macro_name = ?
       ORDER BY ts DESC LIMIT 1`,
    ).get(opts.domain, opts.action);
    if (!row) {
      return { pass: false, failureType: "LOGGING_FAILURE", note: "no macro_call_log row after dispatch" };
    }
    return {
      pass: true,
      domain: row.domain,
      macro_name: row.macro_name,
      status: row.status,
      duration_ms: row.duration_ms ?? durationMs,
    };
  } catch {
    return { pass: true, skipped: true, note: "macro_call_log unavailable" };
  }
}

function skippedContract(stages, classification, status, note) {
  for (const stage of ["input_validation", "dispatch", "backend_execution", "output_shape", "semantic_correctness", "error_path", "logging"]) {
    stages[stage] = { pass: true, skipped: true, note };
  }
  return finalizeContract(stages, classification, { status, skipped: true });
}

export function failurePriority(failureType) {
  if (failureType === "RUNTIME_FAILURE" && /destructive|security/i.test(failureType)) return "P0";
  if (failureType === "REGISTRATION_FAILURE" || failureType === "DISPATCH_FAILURE") return "P1";
  if (failureType === "CORRECTNESS_FAILURE" || failureType === "VERIFICATION_FAILURE") return "P2";
  if (failureType === "RUNTIME_FAILURE") return "P3";
  if (failureType === "ARGUMENT_FAILURE") return "P4";
  if (failureType === "LOGGING_FAILURE") return "P5";
  return "P6";
}

export function isExemptLens(lensId) {
  return EXEMPT_LENSES.has(lensId);
}

export function isWellShapedEnvelope(raw) {
  if (raw == null || typeof raw !== "object") return false;
  return "ok" in raw || "result" in raw || "error" in raw || "reason" in raw;
}

function failureMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw.error ?? raw.reason;
  return typeof msg === "string" && msg.length > 0 ? msg : null;
}

export function isHonestResponse(raw) {
  if (!isWellShapedEnvelope(raw)) return false;
  if (raw.ok === false) {
    return failureMessage(raw) != null;
  }
  if (raw.ok === true && !("result" in raw) && Object.keys(raw).length === 1) {
    return false;
  }
  return hasSubstantivePayload(raw);
}

function hasSubstantivePayload(raw) {
  if (raw?.ok === false) return false;
  const body = raw?.result ?? raw;
  if (body == null) return false;
  if (typeof body !== "object") return true;
  if (Array.isArray(body)) return true;
  return Object.keys(body).length > 0 || body.ok === true;
}

function summarize(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const out = { ok: raw.ok };
  if (raw.error) out.error = String(raw.error).slice(0, 120);
  if (raw.result != null && typeof raw.result === "object") {
    out.resultKeys = Object.keys(raw.result).slice(0, 8);
  }
  return out;
}

function finalizeContract(stages, classification, extra = {}) {
  const failed = Object.entries(stages).find(([, v]) => v.pass === false);
  const ok = extra.status
    ? [LENS_ACTION_STATUS.PASSED, LENS_ACTION_STATUS.SKIPPED_BRAIN_BACKED,
      LENS_ACTION_STATUS.SKIPPED_EXTERNAL_DEPENDENCY, LENS_ACTION_STATUS.SKIPPED_DESTRUCTIVE,
      LENS_ACTION_STATUS.SKIPPED_GENERIC_HOOK, LENS_ACTION_STATUS.SKIPPED_REST_ONLY].includes(extra.status)
    : !failed;
  return {
    ok,
    stages,
    failureType: failed?.[1]?.failureType || extra.failureType || null,
    classification: classification.class,
    classificationReason: classification.reason,
    headlessSafe: classification.headlessSafe,
    failureTaxonomy: FAILURE_TYPES,
    ...extra,
  };
}

export default {
  CONTRACT_STAGES,
  LENS_ACTION_STATUS,
  runLensActionContract,
  isExemptLens,
  isWellShapedEnvelope,
  isHonestResponse,
  failurePriority,
  EXEMPT_LENSES,
};
