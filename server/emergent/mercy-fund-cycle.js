// server/emergent/mercy-fund-cycle.js
//
// Heartbeat for extraction-by-rescue (Sere / the Mercy Fund). Each pass: offer a
// rescue to any Sere realm in crisis, then default every overdue loan (which
// transfers its collateral to the creditor). The debt-trap, on a clock — watchable.
//
// Scoped to world_id='sere'; never throws; kill-switched (CONCORD_MERCY_FUND=0).

import { offerRescuesForCrises, sweepDueLoans, enabled } from "../lib/extraction-loans.js";
import logger from "../logger.js";

export async function runMercyFundCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!enabled()) return { ok: true, reason: "disabled", offered: 0, defaulted: 0 };
  try {
    const offered = offerRescuesForCrises(db, { worldId: "sere" });
    const swept = sweepDueLoans(db, { worldId: "sere" });
    return { ok: true, offered: offered.offered.length, defaulted: swept.defaulted.length };
  } catch (e) {
    logger.warn?.("mercy-fund", "cycle_error", { error: e?.message });
    return { ok: false, reason: e?.message };
  }
}

export default runMercyFundCycle;
