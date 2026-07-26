// server/emergent/district-governance-cycle.js
//
// Player-influenced districts — resolution heartbeat.
//
// Frequency: every 200 ticks (~50 minutes, matching Layer 11's
// faction-strategy-cycle cadence — the closest existing analog: a
// proposal/vote state machine resolved on a heartbeat, never on request).
// Each pass calls resolveDistrictProposals(db), which is itself fully
// isolated per-proposal (try/catch) and never throws. Kill-switch:
// CONCORD_DISTRICT_GOVERNANCE=0.

import { resolveDistrictProposals } from "../lib/district-governance.js";

export async function runDistrictGovernanceCycle({ db } = {}) {
  if (process.env.CONCORD_DISTRICT_GOVERNANCE === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  try {
    return resolveDistrictProposals(db);
  } catch (err) {
    return { ok: false, reason: "cycle_failed", error: err?.message };
  }
}

export default runDistrictGovernanceCycle;
