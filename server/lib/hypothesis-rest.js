/**
 * REST adapters for the hypothesis lifecycle engine.
 *
 * `hypothesis.metrics`, `hypothesis.add_test`, and `hypothesis.add_evidence`
 * are registered only inside initGhostFleet (server.js). That loader starts
 * after CONCORD_GHOST_FLEET_DELAY_MS and does not run at all when
 * CONCORD_DISABLE_GHOST_FLEET=true. The boot-time hypothesis.* set is the
 * legacy stub and does not include those three names, so
 * runMacro("hypothesis", "metrics") throws "macro not found" and the status
 * route's error handler answers HTTP 500.
 *
 * These helpers call emergent/hypothesis-engine.js directly. That module
 * owns the in-memory store the fleet macros close over, so a direct call
 * is the same engine, with or without the fleet registration. If the
 * module cannot be loaded, callers get 503 and no stats object — never a
 * fabricated zero count presented as a live engine.
 */

export const HYPOTHESIS_ENGINE_UNAVAILABLE = Object.freeze({
  ok: false,
  error: "hypothesis_engine_unavailable",
  code: "ENGINE_UNAVAILABLE",
});

export async function loadHypothesisEngine() {
  try {
    const hypo = await import("../emergent/hypothesis-engine.js");
    if (!hypo || typeof hypo.getHypothesisMetrics !== "function") return null;
    return hypo;
  } catch {
    return null;
  }
}

/**
 * @param {object|null|undefined} metrics  getHypothesisMetrics() result, or null
 * @returns {{ status: number, body: object }}
 */
export function hypothesisStatusFromMetrics(metrics) {
  const by = metrics?.byStatus;
  if (!metrics || metrics.ok !== true || by == null || typeof by !== "object" || Array.isArray(by)) {
    return {
      status: 503,
      body: {
        ok: false,
        error: (metrics && typeof metrics.error === "string" && metrics.error) || HYPOTHESIS_ENGINE_UNAVAILABLE.error,
        code: "ENGINE_UNAVAILABLE",
      },
    };
  }
  return {
    status: 200,
    body: {
      ...metrics,
      // NerveCenter still reads the legacy stub's
      // stats.{proposed,supported,refuted,inconclusive}. Those names are
      // the retired engine's vocabulary; the counts themselves are the
      // lifecycle engine's byStatus (confirmed→supported, rejected→refuted,
      // testing→inconclusive).
      stats: {
        proposed: by.proposed ?? 0,
        supported: by.confirmed ?? 0,
        refuted: by.rejected ?? 0,
        inconclusive: by.testing ?? 0,
      },
    },
  };
}

export async function readHypothesisStatus() {
  const hypo = await loadHypothesisEngine();
  if (!hypo) return hypothesisStatusFromMetrics(null);
  let metrics;
  try {
    metrics = hypo.getHypothesisMetrics();
  } catch {
    return hypothesisStatusFromMetrics(null);
  }
  return hypothesisStatusFromMetrics(metrics);
}

/**
 * Call one lifecycle-engine function. A missing module is 503. An engine
 * result such as { ok:false, error:"not_found" } stays HTTP 200 — that is
 * a real answer about an id, not an unavailable engine.
 *
 * @param {string} method
 * @param {unknown[]} args
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function callHypothesisEngine(method, args) {
  const hypo = await loadHypothesisEngine();
  const fn = hypo?.[method];
  if (typeof fn !== "function") {
    return { status: 503, body: { ...HYPOTHESIS_ENGINE_UNAVAILABLE } };
  }
  let out;
  try {
    out = await fn(...args);
  } catch {
    return { status: 503, body: { ...HYPOTHESIS_ENGINE_UNAVAILABLE } };
  }
  if (out == null || typeof out !== "object") {
    return { status: 503, body: { ...HYPOTHESIS_ENGINE_UNAVAILABLE } };
  }
  return { status: 200, body: out };
}
