import logger from "../logger.js";
import { applyPendingConsequences } from "../lib/consequence-apply.js";
import { sweepFadedMemories } from "../lib/npc-memory.js";

export async function runConsequenceApplyCycle({ db } = {}) {
  if (process.env.CONCORD_CONSEQUENCES === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const r = applyPendingConsequences(db, { limit: 50 });
    try { sweepFadedMemories(db); } catch { /* */ }
    return { ok: true, ...r };
  } catch (err) {
    try { logger.warn?.("consequence-apply-cycle", "failed", { error: err?.message }); } catch { /* */ }
    return { ok: false, reason: "exception", error: err?.message };
  }
}
