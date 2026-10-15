// server/lib/conkay/physics/solvers/joint-governing-check.js
//
// Joint verdict aggregator. The point: a PASS from joint.bolt-shear does
// NOT mean a joint is sound. AISC 360-16 has many limit states, and the
// joint can only be declared PASS when every applicable required check
// has run and passed. This solver reads the existing solver envelopes
// for a joint node, maps them against the applicability registry
// (verification/coverage.js), and reports a single verdict per joint:
//
//   PASS       — every applicable required check ran and passed
//   FAIL       — at least one applicable check ran and failed
//   INCOMPLETE — a required check is unavailable (solver missing OR
//                required input missing) for this joint
//   ERROR      — execution failure prevented a reliable verdict
//
// This solver does NOT call other solvers. It is a pure aggregator over
// the envelopes already produced by the design's run. It also does not
// invent capacity values or "borrow" results from unrelated checks.
//
// Acceptance criteria (P0-1):
//   - A bolt-shear PASS alone never produces a joint PASS.
//   - Missing edge distances block a complete verdict when tear-out is applicable.
//   - A missing solver cannot be silently treated as a passing check.
//   - A failed applicable check produces an overall FAIL.
//   - All applicable checks passing, with prerequisites satisfied, permits PASS for the declared scope.

import { registerSolver } from "../registry.js";
import { KIND_DOMAINS } from "../../verification/coverage.js";

// Joint kinds: a Joint node CONTAINS at least one Bolt, and a Joint has a
// `props.kind` that picks the governing limit-state set. We default to
// "bearing" (the AISC §J3 bolted-bearing baseline) for joints without
// an explicit kind.
const JOINT_KINDS = new Set(["bearing", "slip-critical", "friction-grip", "tension-control", "preloaded-tension"]);

// Limit states that are required for each joint kind. A check that is
// "applicable" must be present and PASS. A check that is "n/a" for the
// joint kind is omitted from the verdict; that is the scope-aware
// applicability registry the user asked for.
//
// The 2026-10-12 update reflects the full 8+ bolted-joint limit state
// list. The "bearing" kind is now the most comprehensive: it includes
// the connection-level bolt checks (shear, bearing, tearout, group-
// distribution) AND the member-level checks (gross-section, net-
// section, block-shear). Tension + combined are added on demand
// (tension load detected in the load cases).
const JOINT_KIND_LIMIT_STATES = {
  // A standard bearing-type bolted joint: full set of AISC §J3 connection
  // checks plus the §D2 member checks (yielding, rupture) and §J4-3
  // block-shear. This is the most common case and the most
  // comprehensive. Tension / combined are added on demand.
  bearing: [
    "structural.shear",         // AISC §J3.6  — bolt shear
    "structural.bearing",       // AISC §J3-6a — bolt bearing on plate
    "structural.tearout",       // AISC §J3-6c — bolt tear-out
    "structural.gross-section", // AISC §D2-1  — member gross yielding
    "structural.net-section",   // AISC §D2-2  — member net rupture
    "structural.block-shear",   // AISC §J4-3  — block shear
    "structural.bolt-group",    // Crawford-Kulak distribution
  ],
  // Slip-critical joints transfer load by friction, not bolt shear.
  // The slip-critical capacity is the primary check; bearing-type
  // checks are the secondary limit state (in case the friction fails
  // and the connection reverts to bearing).
  "slip-critical": ["structural.slip-critical", "structural.shear", "structural.bearing", "structural.tearout", "structural.gross-section", "structural.net-section", "structural.block-shear"],
  // A preloaded tension joint: tension + prying on the T-stub flange.
  "preloaded-tension": ["structural.tension", "structural.prying", "structural.bolt-group"],
  // Tension-control / TC bolts (e.g. F1852): tension and combined.
  "tension-control": ["structural.tension", "structural.shear", "structural.combined", "structural.bolt-group"],
  // Friction-grip (older UK/Euro term): same as slip-critical for our purposes.
  "friction-grip": ["structural.slip-critical", "structural.shear", "structural.bearing", "structural.tearout", "structural.gross-section", "structural.net-section", "structural.block-shear"],
};

// Limit states that are "always applicable" for any bolted joint that has
// any load. These are NEVER omitted, even if a tighter joint kind would
// otherwise be enough.
const ALWAYS_APPLICABLE = new Set([
  "structural.shear", // any joint with bolts + shear
  "structural.bearing", // any bolted joint
]);

// The verdict enum. We use a frozen set to prevent typos in the type.
export const JOINT_VERDICT = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  INCOMPLETE: "INCOMPLETE",
  ERROR: "ERROR",
});

/**
 * Aggregate a single joint's verdict from its solver envelopes.
 *
 * @param {string} jointId        the Joint node id
 * @param {object} ctx            design context (children, get, etc.)
 * @param {Array}  envelopes      the full list of run envelopes for the design
 * @param {object} [opts]         optional: { jointKind: string, scope: "declared"|"full" }
 * @returns {object} { verdict, checks: [...], missing: [...], failed: [...], blocked: [...] }
 */
export function aggregateJointVerdict(jointId, ctx, envelopes, opts = {}) {
  const jointKindRaw = (ctx?.get?.(jointId, "props.kind")) || opts.jointKind || "bearing";
  const jointKind = JOINT_KINDS.has(jointKindRaw) ? jointKindRaw : "bearing";
  const limitStates = new Set(JOINT_KIND_LIMIT_STATES[jointKind] || JOINT_KIND_LIMIT_STATES.bearing);
  // Tension is required if a tension load is present, OR if the joint
  // kind explicitly demands it. We detect tension load from envelopes
  // (a load case targeting this joint with .tension > 0) and from the
  // design's loadCases.
  const tensionLoad = hasTensionLoad(ctx, jointId, envelopes);
  if (tensionLoad) limitStates.add("structural.tension");
  // Combined is required when both shear and tension are demanded.
  if (limitStates.has("structural.shear") && limitStates.has("structural.tension")) {
    limitStates.add("combined");
  }

  // Restrict the limits to domains the applicability table knows about
  // for Joint nodes. Anything outside the table is "not applicable."
  const jointTable = (KIND_DOMAINS.Joint || []);
  const applicable = [...limitStates].filter((d) => jointTable.includes(d));
  const notApplicable = [...limitStates].filter((d) => !jointTable.includes(d));

  // For each applicable required limit state, find the envelope(s) for
  // this joint. The envelope's `covers` array may list multiple node ids
  // (e.g. the bolt + the joint + the plate for a shear check).
  const checks = [];
  const failed = [];
  const missing = [];
  const blocked = [];
  const solverErrors = [];

  for (const domain of applicable) {
    const envs = envelopes.filter((e) => {
      const envDomains = e?.solver?.domains || [e?.solver?.domain];
      const covers = e?.covers || [e?.target];
      return envDomains.includes(domain) && covers.includes(jointId);
    });
    if (!envs.length) {
      // No solver envelope for this domain on this joint.
      // Distinguish "solver exists but didn't apply" from "no solver at all".
      const solverExists = (ctx?._solverDomains || new Set()).has(domain);
      const reason = solverExists
        ? "solver did not apply to this joint (input prerequisite missing)"
        : `no ${domain} solver is registered yet`;
      missing.push({ domain, reason });
      continue;
    }
    // Use the latest envelope (last in the list) for this domain.
    const env = envs[envs.length - 1];
    if (env.status === "PASS") {
      checks.push({ domain, status: "PASS", runId: env.runId });
    } else if (env.status === "FAIL" || env.status === "WARN") {
      failed.push({ domain, runId: env.runId, status: env.status, reason: env.failures?.[0]?.reason || "margin exceeded" });
      checks.push({ domain, status: env.status, runId: env.runId });
    } else if (env.status === "NOT_COMPUTED") {
      // Solver ran but couldn't compute: the inputs were missing or
      // the configuration was unsupported. That is a "blocked" check.
      blocked.push({ domain, runId: env.runId, reason: env.reason || "not computed" });
      checks.push({ domain, status: "NOT_COMPUTED", runId: env.runId, reason: env.reason });
    } else if (env.status === "ERROR") {
      solverErrors.push({ domain, runId: env.runId, error: env.error || "execution error" });
      checks.push({ domain, status: "ERROR", runId: env.runId, error: env.error });
    } else {
      // Unknown status: treat as blocked.
      blocked.push({ domain, runId: env.runId, reason: `unknown envelope status: ${env.status}` });
      checks.push({ domain, status: "UNKNOWN", runId: env.runId });
    }
  }

  // Compute the verdict.
  let verdict;
  if (solverErrors.length > 0) {
    verdict = JOINT_VERDICT.ERROR;
  } else if (failed.length > 0) {
    verdict = JOINT_VERDICT.FAIL;
  } else if (missing.length > 0 || blocked.length > 0) {
    verdict = JOINT_VERDICT.INCOMPLETE;
  } else if (checks.length === 0) {
    // No required checks identified for this joint — that's odd, but
    // treat as INCOMPLETE rather than PASS to be safe.
    verdict = JOINT_VERDICT.INCOMPLETE;
  } else {
    verdict = JOINT_VERDICT.PASS;
  }

  return {
    jointId,
    jointKind,
    declaredScope: "aisc-360-16-lrfd",
    verdict,
    checks,
    missing,
    blocked,
    failed,
    solverErrors,
    notApplicable: notApplicable.length ? notApplicable : undefined,
    scopeNote: notApplicable.length
      ? `${notApplicable.length} limit state(s) were not in the Joint applicability table; they are excluded from the verdict.`
      : undefined,
    verdictDefinition: {
      PASS: "every applicable required check ran and passed",
      FAIL: "at least one applicable check ran and failed",
      INCOMPLETE: "a required check is unavailable (solver missing or required input missing) for this joint",
      ERROR: "execution or numerical failure prevented a reliable result",
    },
  };
}

/**
 * Detect whether any load on this joint is a tension load. We look at:
 *   1. The design's loadCases for any load targeting the joint with .tension > 0
 *   2. Envelopes that mention the joint with a tension demand
 * Tension is "tension-control" or "tensile" demand on the joint.
 */
function hasTensionLoad(ctx, jointId, envelopes) {
  // If the context exposes loadCases (most do), inspect them.
  const loadCases = ctx?.loadCases?.() || ctx?.design?.loadCases || [];
  for (const lc of loadCases) {
    for (const load of (lc.loads || [])) {
      if (load.target === jointId && Number.isFinite(load.tension) && load.tension > 0) {
        return true;
      }
      // Also accept "axial" / "tensile" names.
      if (load.target === jointId && Number.isFinite(load.axial) && load.axial > 0) {
        return true;
      }
    }
  }
  // Fall back to envelope names (some compilers record the demand in the
  // solver inputs even when no loadCases are exposed).
  for (const e of envelopes) {
    const covers = e?.covers || [e?.target];
    if (!covers.includes(jointId)) continue;
    const inputs = e?.inputs || {};
    if (inputs["tension.demand"] || inputs["axial.demand"] || inputs["tension.LC1"]) {
      return true;
    }
  }
  return false;
}

// The solver registration. targets() returns the Joint node ids that
// have at least one Bolt child — the same gating as joint.bolt-shear so
// the coverage is consistent.
const jointTargets = (g) => g.nodesOfKind("Joint").map((n) => n.id).filter((id) => g.children(id).some((k) => k.kind === "Bolt"));

export const jointGoverningCheck = registerSolver({
  id: "joint.governing-check",
  version: "1.0.0",
  domain: "verification.governing",
  domains: ["verification.governing"],
  fidelity: 0, // L0 symbolic — pure aggregation
  method: "Verdict aggregator over existing solver envelopes. AISC 360-16 LRFD scope. Maps Joint kind → required limit states; reads envelopes; emits PASS|FAIL|INCOMPLETE|ERROR.",
  reference: "AISC 360-16 Chapter J; ConKay verdict semantics v1 (joint.governing-check)",
  targets: jointTargets,
  run(ctx, id) {
    // The envelope list is exposed by the design's engine through ctx.
    // Different compiler versions expose it as `envelopes()`, `_envelopes`,
    // or pass it as a hidden field. We look for each, gracefully degrade.
    const envelopes =
      (typeof ctx.envelopes === "function" && ctx.envelopes()) ||
      ctx._envelopes ||
      ctx.envelopes ||
      [];
    const solverDomains = (typeof ctx.solverDomains === "function" && ctx.solverDomains()) ||
      new Set((ctx?._solverDomains || []));
    const v = aggregateJointVerdict(id, { ...ctx, _solverDomains: solverDomains }, envelopes);

    // The envelope status enum is PASS|FAIL|WARN|NOT_COMPUTED|ERROR.
    // Map the joint verdict into that enum. INCOMPLETE is honest NOT_COMPUTED
    // at the envelope level — the joint verdict is "couldn't compute a final
    // answer" — and the per-domain missing/blocked/failed lists carry the
    // detail so a downstream consumer can render the verdict verbatim.
    const missingList = [
      ...v.missing.map((m) => `${m.domain} (${m.reason})`),
      ...v.blocked.map((b) => `${b.domain} (${b.reason})`),
      ...v.failed.map((f) => `${f.domain} (${f.reason || f.status})`),
      ...v.solverErrors.map((e) => `${e.domain} (${e.error})`),
    ];

    // Demand/capacity ratio encodes the verdict:
    //   PASS        -> 0 / 4 (no demand, full capacity)
    //   FAIL        -> 4 / 0 (full demand, no capacity)
    //   INCOMPLETE  -> 2 / 4 (partial demand: can answer "not all checks done")
    //   ERROR       -> 4 / 4 (full demand, full capacity: not really useful, but
    //                  the envelope's status is what carries the ERROR signal)
    const VERDICT_TO_RATIO = {
      PASS:       { demand: 0, capacity: 4 },
      FAIL:       { demand: 4, capacity: 0 },
      INCOMPLETE: { demand: 2, capacity: 4 },
      ERROR:      { demand: 4, capacity: 4 },
    };
    const ratio = VERDICT_TO_RATIO[v.verdict] || { demand: 4, capacity: 0 };

    // The envelope's status comes from a `failures` array (FAIL) or
    // a `notComputed` string (NOT_COMPUTED). We use those as the
    // transport so the existing wrapper emits the right status.
    let notComputed = null;
    let failures = [];
    if (v.verdict === "PASS") {
      // nothing
    } else if (v.verdict === "FAIL") {
      failures = [{
        kind: "joint_verdict",
        reason: `joint failed: ${v.failed.map((f) => f.domain).join(", ") || "see failed[]"}`,
      }];
    } else if (v.verdict === "INCOMPLETE") {
      notComputed = `joint INCOMPLETE: ${missingList.join("; ") || "no applicable checks identified"}`;
    } else if (v.verdict === "ERROR") {
      notComputed = `joint ERROR: ${v.solverErrors.map((e) => `${e.domain}: ${e.error}`).join("; ")}`;
    }

    return {
      notComputed,
      outputs: {
        verdict: v.verdict,
        jointKind: v.jointKind,
        declaredScope: v.declaredScope,
        checks: v.checks,
        missing: v.missing,
        blocked: v.blocked,
        failed: v.failed,
        solverErrors: v.solverErrors,
        notApplicable: v.notApplicable,
        scopeNote: v.scopeNote,
        verdictDefinition: v.verdictDefinition,
      },
      margins: [{
        check: `joint verdict for ${id}`,
        ...ratio,
        unit: "verdict",
        utilization: ratio.capacity > 0 ? ratio.demand / ratio.capacity : Infinity,
        marginPct: ratio.demand > 0 ? (ratio.capacity / ratio.demand - 1) * 100 : Infinity,
        verdict: v.verdict,
      }],
      failures,
      assumptions: [
        `AISC 360-16 LRFD scope, joint kind: ${v.jointKind}.`,
        `Verdict derived from ${v.checks.length} applicable check(s).`,
        ...(v.notApplicable?.length
          ? [`Excluded (not in Joint applicability table): ${v.notApplicable.join(", ")}`]
          : []),
        ...missingList.map((m) => `Missing: ${m}`),
      ],
      covers: [id],
    };
  },
});
