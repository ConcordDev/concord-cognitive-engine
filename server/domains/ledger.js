// server/domains/ledger.js — macros behind the Ledger lens (the flows the Curtain
// hides). Read-only. See lib/economy-flows.js.

import { anomalousFlows, factionEconomyState, flowSummary } from "../lib/economy-flows.js";

// Fail-CLOSED numeric guard (copied shape from domains/literary.js): a present
// numeric field must be a finite, non-negative number within a sane bound, or
// the macro rejects it instead of coercing NaN/Infinity/huge values into the
// underlying SQL LIMIT. Absent fields are allowed (the lib carries defaults).
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

export default function registerLedgerMacros(register) {
  register("ledger", "anomalies", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return anomalousFlows(db, input.worldId || "sere");
  }, { note: "The managed-parity funding + extraction liens the Curtain keeps off the public record." });

  register("ledger", "faction_economy", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.factionId) return { ok: false, reason: "missing_inputs" };
    return factionEconomyState(db, input.worldId || "sere", input.factionId);
  }, { note: "A faction/realm's treasury + funding received + liens against it." });

  register("ledger", "flow_summary", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const bad = badNumericField(input, ["limit"]);
    if (bad) return { ok: false, reason: "bad_numeric_field", field: bad };
    const limit = input.limit === undefined ? undefined : Number(input.limit);
    return flowSummary(db, limit === undefined ? {} : { limit });
  }, { note: "Recent economy-ledger rollup by type." });
}
