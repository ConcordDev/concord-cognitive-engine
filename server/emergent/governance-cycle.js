// server/emergent/governance-cycle.js
//
// Living Society — Phase 11: the governance heartbeat. Per world: flow tribute
// UP the vassalage tree, sweep protection failures (undefended raids →
// grievance + secession-eligible), and recognize an Emperor after conquest.
// scope:'world'. Never throws. Kill-switch CONCORD_GOVERNANCE=0.

import { runTribute, sweepProtectionFailures, recognizeEmperor } from "../lib/vassalage.js";

export function runGovernanceCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (process.env.CONCORD_GOVERNANCE === "0") return { ok: false, reason: "disabled" };
  let worlds = [];
  try {
    worlds = db.prepare(`SELECT DISTINCT world_id FROM vassalage WHERE status = 'sworn'`).all().map((r) => r.world_id);
  } catch { return { ok: true, worlds: 0 }; }
  let flowed = 0, failures = 0, emperors = 0;
  for (const w of worlds) {
    try { flowed += runTribute(db, w).flowed || 0; } catch { /* isolation */ }
    try { failures += sweepProtectionFailures(db, w).failures || 0; } catch { /* isolation */ }
    try { if (recognizeEmperor(db, w).recognized && !recognizeEmperor(db, w).alreadyCrowned) emperors++; } catch { /* isolation */ }
  }
  return { ok: true, worlds: worlds.length, flowed, failures, emperors };
}
