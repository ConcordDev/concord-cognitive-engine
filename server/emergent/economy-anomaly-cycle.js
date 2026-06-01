// server/emergent/economy-anomaly-cycle.js
//
// E2 — economy-anomaly promotion (the #1 Concordia-specific user-bug risk).
//
// The platform already DETECTS economy pathologies (world-health.js#detectPathologies
// escalates negative_balance + dupe_citation) and logs wash-trade suspicions
// (detectWashTrading), but those were advisory-only — no aggregate counter, no paging.
// This heartbeat promotes them: it rolls the findings into the concord_econ_anomaly_total
// Prometheus counter and routes Critical kinds (via bug-triage) to error-alerting so an
// impossible-balance or a dupe storm pages instead of sitting in a log.
//
// IMPORTANT: observe-and-alert ONLY. This NEVER mutates balances/ledgers — the
// constitutional economy invariants (MAX_ROYALTY_RATE, WITHDRAWAL_HOLD_HOURS, fees) are
// untouched. Wash-trade stays advisory (counted + alerted), it does NOT start blocking.
//
// Kill-switch: CONCORD_ECON_ANOMALY=0. Heartbeat: freq 240 (~1h), scope 'global'.

import { detectPathologies } from "../lib/world-health.js";
import { classify, ROUTE } from "../lib/bug-triage.js";
import { detectCollusionRings } from "../lib/collusion-detector.js";

// pathology name (from detectPathologies) → bug-triage kind
const PATHOLOGY_TO_KIND = {
  negative_balance: "negative_balance",
  dupe_citation: "dupe_citation",
};

function defaultIncCounter(kind) {
  try {
    globalThis._concordMETRICS?.counters?.econAnomaly?.inc({ kind });
  } catch { /* telemetry best-effort */ }
}

async function defaultAlert(payload) {
  try {
    const { sendAlert } = await import("../lib/error-alerting.js");
    await sendAlert(payload);
  } catch { /* alerting optional */ }
}

/**
 * Roll up economy anomalies once. Pure-ish: I/O is injectable for tests.
 *
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {(kind:string)=>void} [deps.incCounter]   counter increment (defaults to prom)
 * @param {(payload:object)=>any} [deps.alert]      pager (defaults to error-alerting)
 * @param {number} [deps.washTradeCount]            optional advisory wash-trade rollup count
 * @returns {Promise<{ ok:boolean, counted:number, paged:number, byKind:object }>}
 */
export async function runEconomyAnomalyCycle({ db, incCounter = defaultIncCounter, alert = defaultAlert, washTradeCount, collusionRings } = {}) {
  if (process.env.CONCORD_ECON_ANOMALY === "0") return { ok: true, counted: 0, paged: 0, byKind: {}, disabled: true };
  if (!db) return { ok: false, reason: "no_db", counted: 0, paged: 0, byKind: {} };

  const byKind = {};
  let counted = 0;
  let paged = 0;

  const bump = async (kind, detail) => {
    byKind[kind] = (byKind[kind] || 0) + 1;
    counted++;
    incCounter(kind);
    const verdict = classify({ source: "econ_anomaly", kind });
    if (verdict.route === ROUTE.PAGE) {
      paged++;
      await alert({
        title: `Economy anomaly: ${kind}`,
        message: `economy-anomaly-cycle flagged a ${verdict.severity} ${kind}`,
        severity: "error",
        fields: { kind, severity: verdict.severity, ...detail },
      });
    }
  };

  try {
    const findings = detectPathologies(db) || [];
    for (const f of findings) {
      if (f?.category !== "economy") continue;
      const kind = PATHOLOGY_TO_KIND[f.pathology] || f.pathology;
      await bump(kind, { subjectId: f.subjectId, ...(f.detail || {}) });
    }
  } catch (err) {
    return { ok: false, reason: err?.message, counted, paged, byKind };
  }

  // Advisory wash-trade rollup — counted (+ paged as Critical) but never blocks.
  const washN = Number.isFinite(washTradeCount)
    ? washTradeCount
    : (() => { try { return globalThis._washTradeHistory?.size || 0; } catch { return 0; } })();
  if (washN > 0) {
    try { await bump("wash_trade", { suspected: washN }); } catch { /* best-effort */ }
  }

  // F3 — multi-account collusion rings (the cycle case pairwise wash-trade
  // misses). Advisory: counted + paged as Critical, never blocks/mutates.
  const rings = Array.isArray(collusionRings)
    ? collusionRings
    : (() => { try { return detectCollusionRings(globalThis._washTradeHistory || new Map()).rings || []; } catch { return []; } })();
  for (const ring of rings) {
    try { await bump("collusion_ring", { accounts: ring.accounts, size: ring.size, totalTrades: ring.totalTrades }); } catch { /* best-effort */ }
  }

  return { ok: true, counted, paged, byKind };
}

/** Register on the heartbeat registry (mirrors world-health-monitor). */
export function registerEconomyAnomalyCycle(registerHeartbeat, db) {
  if (typeof registerHeartbeat !== "function") return;
  registerHeartbeat("economy-anomaly-cycle", {
    frequency: 240,
    scope: "global",
    handler: () => runEconomyAnomalyCycle({ db }),
  });
}

export default runEconomyAnomalyCycle;
