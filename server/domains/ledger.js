// server/domains/ledger.js — macros behind the Ledger lens (the flows the Curtain
// hides). Read-only. See lib/economy-flows.js.

import { anomalousFlows, factionEconomyState, flowSummary } from "../lib/economy-flows.js";

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

  register("ledger", "flow_summary", (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return flowSummary(db, {});
  }, { note: "Recent economy-ledger rollup by type." });
}
