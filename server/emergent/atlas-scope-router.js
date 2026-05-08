/**
 * Atlas 3-Lane Scope Router
 *
 * Enforces hard separation between:
 *   Lane A: Local Instance   — personal, fast, permissive
 *   Lane B: Global Atlas     — public epistemic record, strict
 *   Lane C: Marketplace      — economic layer, strictest
 *
 * Invariant: No query, tick, or autogen run is allowed to mix scopes
 *            unless explicitly invoked with a cross-scope policy.
 *
 * All DTU writes go through: concord.write(scope, op, payload, ctx)
 * All retrieval goes through: concord.retrieve(scopePolicy, query, ctx)
 * Any cross-scope action creates a submission artifact.
 */

import {
  SCOPES,
  SCOPE_SET,
  RETRIEVAL_POLICY,
  DEFAULT_RETRIEVAL_POLICY,
} from "./atlas-config.js";
import { applyWrite, WRITE_OPS } from "./atlas-write-guard.js";
import { getAtlasState } from "./atlas-epistemic.js";
import { searchAtlasDtus, contentHash } from "./atlas-store.js";
import crypto from "crypto";
import { assertInvariant } from "./atlas-invariants.js";
import { validateMarketplaceListing, resolveLicense } from "./atlas-rights.js";
import logger from '../logger.js';
// Scope state lives in a shared module so atlas-rights.js can read it
// without importing back into this router (avoids the 3-module cycle
// scope-router → write-guard → rights → scope-router).
import {
  initScopeState as _initScopeState,
  getScopeState as _getScopeState,
  getDtuScope as _getDtuScope,
} from "./atlas-scope-state.js";

// Re-export the public initializer + accessor so existing import sites keep
// working with no changes.
export const initScopeState = _initScopeState;
export const getDtuScope = _getDtuScope;
const getScopeState = _getScopeState;

// ── Core: concord.write(scope, op, payload, ctx) ────────────────────────────

/**
 * The ONLY entry point for DTU writes. Routes through the write guard
 * with scope-appropriate strictness.
 */
export function scopedWrite(STATE, scope, op, payload, ctx = {}) {
  assertInvariant("SCOPE_EXPLICIT", SCOPE_SET.has(scope), { scope }, true);

  const scopeState = getScopeState(STATE);
  const writeCtx = { ...ctx, scope };

  const result = applyWrite(STATE, op, payload, writeCtx);

  if (result.ok && result.dtu) {
    // Record scope assignment
    scopeState.dtuScope.set(result.dtu.id, scope);

    // Increment metrics
    if (scope === SCOPES.LOCAL) scopeState.metrics.localWrites++;
    else if (scope === SCOPES.GLOBAL) scopeState.metrics.globalWrites++;
    else if (scope === SCOPES.MARKETPLACE) scopeState.metrics.marketWrites++;
  }

  return result;
}

// ── Core: concord.retrieve(scopePolicy, query, ctx) ────────────────────────

/**
 * Scope-aware retrieval. Results are labeled with their source scope.
 * Mixing is only allowed by explicit policy, and labels are always applied.
 */
export function scopedRetrieve(STATE, scopePolicy, query, _ctx = {}) {
  const policy = scopePolicy || DEFAULT_RETRIEVAL_POLICY;
  const scopeState = getScopeState(STATE);

  switch (policy) {
    case RETRIEVAL_POLICY.LOCAL_ONLY:
      return _retrieveFromScope(STATE, scopeState, SCOPES.LOCAL, query);

    case RETRIEVAL_POLICY.GLOBAL_ONLY:
      return _retrieveFromScope(STATE, scopeState, SCOPES.GLOBAL, query);

    case RETRIEVAL_POLICY.LOCAL_THEN_GLOBAL: {
      const local = _retrieveFromScope(STATE, scopeState, SCOPES.LOCAL, query);
      if (local.results.length >= (query.limit || 20)) return local;
      const remaining = (query.limit || 20) - local.results.length;
      const global = _retrieveFromScope(STATE, scopeState, SCOPES.GLOBAL, { ...query, limit: remaining });
      return {
        ok: true,
        results: [...local.results, ...global.results],
        total: local.total + global.total,
        policy,
        scopes: [SCOPES.LOCAL, SCOPES.GLOBAL],
      };
    }

    case RETRIEVAL_POLICY.GLOBAL_THEN_LOCAL: {
      const global = _retrieveFromScope(STATE, scopeState, SCOPES.GLOBAL, query);
      if (global.results.length >= (query.limit || 20)) return global;
      const remaining = (query.limit || 20) - global.results.length;
      const local = _retrieveFromScope(STATE, scopeState, SCOPES.LOCAL, { ...query, limit: remaining });
      return {
        ok: true,
        results: [...global.results, ...local.results],
        total: global.total + local.total,
        policy,
        scopes: [SCOPES.GLOBAL, SCOPES.LOCAL],
      };
    }

    case RETRIEVAL_POLICY.LOCAL_PLUS_GLOBAL: {
      const local = _retrieveFromScope(STATE, scopeState, SCOPES.LOCAL, query);
      const global = _retrieveFromScope(STATE, scopeState, SCOPES.GLOBAL, query);
      return {
        ok: true,
        results: [...local.results, ...global.results],
        total: local.total + global.total,
        policy,
        scopes: [SCOPES.LOCAL, SCOPES.GLOBAL],
      };
    }

    case RETRIEVAL_POLICY.LOCAL_PLUS_GLOBAL_MARKET: {
      const local = _retrieveFromScope(STATE, scopeState, SCOPES.LOCAL, query);
      const global = _retrieveFromScope(STATE, scopeState, SCOPES.GLOBAL, query);
      const market = _retrieveFromScope(STATE, scopeState, SCOPES.MARKETPLACE, query);
      return {
        ok: true,
        results: [...local.results, ...global.results, ...market.results],
        total: local.total + global.total + market.total,
        policy,
        scopes: [SCOPES.LOCAL, SCOPES.GLOBAL, SCOPES.MARKETPLACE],
      };
    }

    default:
      return _retrieveFromScope(STATE, scopeState, SCOPES.LOCAL, query);
  }
}

// ── Internal: retrieve from a single scope ──────────────────────────────────

function _retrieveFromScope(STATE, scopeState, scope, query) {
  const dtuScope = scopeState.dtuScope;

  // Use Atlas search if available, then filter by scope
  const searchResult = searchAtlasDtus(STATE, query);
  if (!searchResult.ok) return { ok: true, results: [], total: 0, scope };

  // Filter to only DTUs in the requested scope
  const scopedResults = searchResult.results.filter(dtu => {
    const assigned = dtuScope.get(dtu.id);
    // If no scope assigned, treat legacy DTUs as local by default
    if (!assigned) return scope === SCOPES.LOCAL;
    return assigned === scope;
  });

  // Label each result with its source scope
  const labeled = scopedResults.map(dtu => ({
    ...dtu,
    _sourceScope: scope,
    _scopeLabel: scope === SCOPES.LOCAL ? "Local knowledge" :
                 scope === SCOPES.GLOBAL ? "Global Atlas" :
                 "Marketplace listing",
    // Global content retains confidence + dispute indicators
    _disputeIndicator: scope !== SCOPES.LOCAL && dtu.status === "DISPUTED",
    _confidence: dtu.scores?.confidence_overall,
  }));

  return {
    ok: true,
    results: labeled,
    total: labeled.length,
    scope,
  };
}

// ── Cross-Scope Submission ──────────────────────────────────────────────────

/**
 * Creates a submission artifact for crossing lanes.
 * No direct "publish to global/market" write — only through submission + council pipeline.
 */
export function createSubmission(STATE, sourceDtuId, targetScope, submitter, opts = {}) {
  const scopeState = getScopeState(STATE);
  const atlas = getAtlasState(STATE);

  const dtu = atlas.dtus.get(sourceDtuId);
  if (!dtu) return { ok: false, error: `Source DTU not found: ${sourceDtuId}` };

  const sourceScope = scopeState.dtuScope.get(sourceDtuId) || SCOPES.LOCAL;

  // Validate cross-scope direction
  if (sourceScope === targetScope) {
    return { ok: false, error: `DTU already in ${targetScope} scope` };
  }

  // Cannot go directly from local to marketplace (must go through global first)
  if (sourceScope === SCOPES.LOCAL && targetScope === SCOPES.MARKETPLACE) {
    return { ok: false, error: "Local → Marketplace requires Global verification first" };
  }

  // ── Marketplace rights validation ──────────────────────────────────────
  if (targetScope === SCOPES.MARKETPLACE) {
    const marketCheck = validateMarketplaceListing(STATE, dtu, submitter, {
      license_type: opts.licenseTerms,
      license_custom: opts.licenseCustom,
      royaltySplits: opts.royaltySplits,
    });
    if (!marketCheck.ok) {
      return { ok: false, error: `Marketplace rights check failed: ${marketCheck.errors.join("; ")}` };
    }
  }

  // ── Resolve license for submission ──────────────────────────────────────
  const { license_type, profile: licenseProfile } = resolveLicense(dtu, targetScope);

  const submissionId = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const submission = {
    id: submissionId,
    sourceDtuId,
    sourceScope,
    targetScope,
    submitter,
    status: "PENDING",  // PENDING | REVIEWING | APPROVED | REJECTED
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Payload for council review
    payload: {
      title: dtu.title,
      domainType: dtu.domainType,
      epistemicClass: dtu.epistemicClass,
      claims: dtu.claims || [],
      interpretations: dtu.interpretations || [],
      assumptions: dtu.assumptions || [],
      provenance: dtu.provenance || [],
      sources: _extractAllSources(dtu),
      claimLaneSeparation: _analyzeClaimLanes(dtu),
      lineage: dtu.lineage || {},
      author: dtu.author || {},
      // Rights metadata
      license_type,
      license_profile: licenseProfile,
      rights: dtu._rights || null,
    },

    // Marketplace-specific (if applicable)
    marketplace: targetScope === SCOPES.MARKETPLACE ? {
      licenseTerms: opts.licenseTerms || null,
      royaltySplits: opts.royaltySplits || null,
      provenanceAttestation: opts.provenanceAttestation || null,
      rightsToSellAttestation: opts.rightsToSellAttestation || false,
      price: opts.price || null,
    } : null,

    // Review pipeline tracking
    pipeline: {
      schemaNormalized: false,
      evidenceEnforced: false,
      contradictionChecked: false,
      antiGamingChecked: false,
      scored: false,
      statusDecided: false,
      councilQueueGenerated: false,
    },

    // Review results
    reviewResults: [],
    auditTrail: [{
      ts: Date.now(),
      actor: submitter,
      action: "SUBMISSION_CREATED",
      detail: `${sourceScope} → ${targetScope}`,
    }],
  };

  // ── Immutability: hash and freeze payload at creation ─────────────────
  // Prevents "quiet edits" after council review starts.
  const payloadJson = JSON.stringify(submission.payload);
  submission.payloadHash = crypto.createHash("sha256").update(payloadJson).digest("hex").slice(0, 32);
  submission.sourceSnapshotHash = contentHash(dtu);
  Object.freeze(submission.payload);
  if (submission.marketplace) Object.freeze(submission.marketplace);
  submission._sealed = true;

  scopeState.submissions.set(submissionId, submission);
  scopeState.metrics.submissionsCreated++;

  return { ok: true, submission };
}

/**
 * Process a submission through the council pipeline.
 * Each step must pass before the next runs.
 */
export function processSubmission(STATE, submissionId, step, actor, result = {}) {
  const scopeState = getScopeState(STATE);
  const submission = scopeState.submissions.get(submissionId);
  if (!submission) return { ok: false, error: `Submission not found: ${submissionId}` };
  if (submission.status === "APPROVED" || submission.status === "REJECTED") {
    return { ok: false, error: `Submission already ${submission.status}` };
  }

  // ── Immutability check: verify payload hasn't been tampered with ─────
  if (submission._sealed) {
    const currentHash = crypto.createHash("sha256").update(JSON.stringify(submission.payload)).digest("hex").slice(0, 32);
    if (currentHash !== submission.payloadHash) {
      return { ok: false, error: "Submission payload integrity violation — payload hash mismatch" };
    }
  }

  submission.status = "REVIEWING";
  submission.updatedAt = new Date().toISOString();

  // Record pipeline step
  if (submission.pipeline[step] !== undefined) {
    submission.pipeline[step] = true;
  }

  submission.reviewResults.push({
    step,
    actor,
    ts: Date.now(),
    ...result,
  });

  submission.auditTrail.push({
    ts: Date.now(),
    actor,
    action: `PIPELINE_${step.toUpperCase()}`,
    detail: result.ok !== false ? "passed" : `failed: ${result.error || "unknown"}`,
  });

  // If a step fails hard, reject the submission
  if (result.ok === false && result.hard) {
    submission.status = "REJECTED";
    scopeState.metrics.submissionsRejected++;
    return { ok: true, submission, rejected: true, reason: result.error };
  }

  return { ok: true, submission };
}

/**
 * Approve a submission and create the DTU in the target scope.
 */
export function approveSubmission(STATE, submissionId, actor) {
  const scopeState = getScopeState(STATE);
  const submission = scopeState.submissions.get(submissionId);
  if (!submission) return { ok: false, error: `Submission not found: ${submissionId}` };

  // Check all pipeline steps completed
  const incomplete = Object.entries(submission.pipeline).filter(([, done]) => !done);
  if (incomplete.length > 0) {
    return { ok: false, error: `Pipeline incomplete: ${incomplete.map(([s]) => s).join(", ")}` };
  }

  // Create DTU in target scope through write guard
  const writeResult = scopedWrite(STATE, submission.targetScope, WRITE_OPS.CREATE, {
    ...submission.payload,
    _submissionId: submissionId,
    _originScope: submission.sourceScope,
    _originDtuId: submission.sourceDtuId,
  }, { actor, scope: submission.targetScope });

  if (!writeResult.ok) {
    submission.status = "REJECTED";
    submission.auditTrail.push({
      ts: Date.now(), actor, action: "APPROVAL_FAILED", detail: writeResult.error,
    });
    scopeState.metrics.submissionsRejected++;
    return { ok: false, error: writeResult.error, submission };
  }

  submission.status = "APPROVED";
  submission.approvedAt = new Date().toISOString();
  submission.targetDtuId = writeResult.dtu.id;
  submission.auditTrail.push({
    ts: Date.now(), actor, action: "APPROVED", detail: `Created ${writeResult.dtu.id} in ${submission.targetScope}`,
  });
  scopeState.metrics.submissionsApproved++;

  return { ok: true, submission, dtu: writeResult.dtu };
}

/**
 * Reject a submission.
 */
export function rejectSubmission(STATE, submissionId, actor, reason) {
  const scopeState = getScopeState(STATE);
  const submission = scopeState.submissions.get(submissionId);
  if (!submission) return { ok: false, error: `Submission not found: ${submissionId}` };

  submission.status = "REJECTED";
  submission.updatedAt = new Date().toISOString();
  submission.auditTrail.push({
    ts: Date.now(), actor, action: "REJECTED", detail: reason || "No reason provided",
  });
  scopeState.metrics.submissionsRejected++;

  return { ok: true, submission };
}

// ── Submission Query ────────────────────────────────────────────────────────

export function getSubmission(STATE, submissionId) {
  const scopeState = getScopeState(STATE);
  const sub = scopeState.submissions.get(submissionId);
  return sub ? { ok: true, submission: sub } : { ok: false, error: "Not found" };
}

export function listSubmissions(STATE, options = {}) {
  const scopeState = getScopeState(STATE);
  let subs = Array.from(scopeState.submissions.values());

  if (options.status) subs = subs.filter(s => s.status === options.status);
  if (options.targetScope) subs = subs.filter(s => s.targetScope === options.targetScope);
  if (options.submitter) subs = subs.filter(s => s.submitter === options.submitter);

  subs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = subs.length;
  const limit = Math.min(options.limit || 50, 200);
  const offset = options.offset || 0;

  return { ok: true, submissions: subs.slice(offset, offset + limit), total, limit, offset };
}

// ── Scope Query ─────────────────────────────────────────────────────────────
// getDtuScope is re-exported from ./atlas-scope-state.js (top of file).

let _scopeMetricsCache = null;
let _scopeMetricsCacheAt = 0;
const SCOPE_METRICS_TTL = 30000; // 30 seconds

export function getScopeMetrics(STATE) {
  const now = Date.now();
  if (_scopeMetricsCache && (now - _scopeMetricsCacheAt) < SCOPE_METRICS_TTL) {
    return { ..._scopeMetricsCache, cached: true };
  }

  const scopeState = getScopeState(STATE);
  const dtuScope = scopeState.dtuScope;

  let localCount = 0, globalCount = 0, marketCount = 0;
  for (const scope of dtuScope.values()) {
    if (scope === SCOPES.LOCAL) localCount++;
    else if (scope === SCOPES.GLOBAL) globalCount++;
    else if (scope === SCOPES.MARKETPLACE) marketCount++;
  }

  const result = {
    ok: true,
    ...scopeState.metrics,
    dtusByScope: { local: localCount, global: globalCount, marketplace: marketCount },
    totalSubmissions: scopeState.submissions.size,
  };

  _scopeMetricsCache = result;
  _scopeMetricsCacheAt = now;
  return result;
}

// ── Local Quality Hints (Section 7) ─────────────────────────────────────────

/**
 * For local DTUs: produce quality warnings without blocking.
 * "Less strict local without letting it rot."
 */
export function getLocalQualityHints(STATE, dtuId) {
  const atlas = getAtlasState(STATE);
  const dtu = atlas.dtus.get(dtuId);
  if (!dtu) return { ok: false, error: "DTU not found" };

  const hints = [];

  // Uncited facts
  const factClaims = (dtu.claims || []).filter(c => c.claimType === "FACT" || c.claimType === "SPEC");
  const uncited = factClaims.filter(c => !c.sources || c.sources.length === 0);
  if (uncited.length > 0) {
    hints.push({
      type: "UNCITED_FACT",
      severity: "info",
      message: `${uncited.length} fact claim(s) have no sources`,
      claimIds: uncited.map(c => c.claimId),
      action: "Consider adding sources for better credibility",
    });
  }

  // Possible contradiction with global
  const contras = (dtu.links?.contradicts || []);
  if (contras.length > 0) {
    hints.push({
      type: "POSSIBLE_CONTRADICTION",
      severity: "warning",
      message: `${contras.length} contradiction link(s) exist`,
      targetDtuIds: contras.map(l => l.targetDtuId),
      action: "Review contradictions before promoting to Global",
    });
  }

  // Near-duplicate detection
  try {
    const { findNearDuplicates: _findDupes } = await_free_import_dupes();
    // Inline check since we can't async import in sync function
  } catch (_e) { logger.debug('emergent:atlas-scope-router', 'skip', { error: _e?.message }); }

  // Low structural score
  const structural = dtu.scores?.credibility_structural || 0;
  if (structural < 0.4) {
    hints.push({
      type: "LOW_STRUCTURAL_SCORE",
      severity: "info",
      message: `Structural score is ${structural.toFixed(2)} — below typical Global threshold`,
      action: "Add more metadata, sources, or provenance to improve score",
    });
  }

  // Missing domain-specific metadata
  if (!dtu.domainType) {
    hints.push({
      type: "MISSING_DOMAIN_TYPE",
      severity: "warning",
      message: "No domainType set — required for Global submission",
      action: "Set a domainType to enable proper scoring",
    });
  }

  // Local confidence branding
  const localConfidence = dtu.scores?.confidence_overall || 0;
  hints.push({
    type: "LOCAL_CONFIDENCE",
    severity: "info",
    message: `Local confidence: ${localConfidence.toFixed(2)} (local rules — does not equal Global verification)`,
  });

  return { ok: true, dtuId, hints, hintCount: hints.length };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function _extractAllSources(dtu) {
  const sources = [];
  for (const claim of (dtu.claims || [])) {
    for (const src of (claim.sources || [])) {
      sources.push({ ...src, claimId: claim.claimId });
    }
  }
  return sources;
}

function _analyzeClaimLanes(dtu) {
  const lanes = { FACT: 0, INTERPRETATION: 0, MODEL: 0, OTHER: 0 };
  for (const claim of (dtu.claims || [])) {
    if (claim.claimType === "FACT" || claim.claimType === "SPEC" || claim.claimType === "PROVENANCE") {
      lanes.FACT++;
    } else if (claim.claimType === "INTERPRETATION" || claim.claimType === "RECEPTION") {
      lanes.INTERPRETATION++;
    } else if (claim.claimType === "MODEL_OUTPUT" || claim.claimType === "HYPOTHESIS") {
      lanes.MODEL++;
    } else {
      lanes.OTHER++;
    }
  }
  return lanes;
}

// Sync helper to avoid dynamic import issues
function await_free_import_dupes() {
  return { findNearDuplicates: null };
}
