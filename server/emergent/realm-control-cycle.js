// server/emergent/realm-control-cycle.js
//
// Wave 5 #19 — civilization-as-control heartbeat. Each pass, per realm, runs the
// PID feedback (lib/viability/realm-control.js) that drives legitimacy toward
// its viable setpoint by modulating tax_rate, then applies the populace's
// response. A self-governing ruler that steers away from the rebellion cliff.
// Behind CONCORD_REALM_CONTROL; no-ops (and writes nothing) when off. Never
// throws. scope:'world', freq ~30.

import logger from "../logger.js";
import { realmControlEnabled, recommendTax, legitimacyResponse } from "../lib/viability/realm-control.js";

export const REALM_CONTROL_FREQUENCY = 30;

// Per-realm controller state (integral + prevError). Cleared on restart — the
// loop re-converges; the persisted legitimacy/tax_rate carry the real state.
const _ctl = new Map();

export async function runRealmControlCycle({ db } = {}) {
  if (!realmControlEnabled()) return { ok: true, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  const emit = (typeof globalThis.realtimeEmit === "function") ? globalThis.realtimeEmit : () => {};
  let adjusted = 0;
  try {
    let realms = [];
    try {
      realms = db.prepare(`SELECT id, legitimacy, tax_rate FROM realms`).all();
    } catch { return { ok: true, adjusted: 0, reason: "no_realms_table" }; }

    const update = db.prepare(`UPDATE realms SET legitimacy = ?, tax_rate = ?, updated_at = unixepoch() WHERE id = ?`);
    for (const realm of realms) {
      try {
        const prior = _ctl.get(realm.id) || {};
        const { newTax, integral, prevError } = recommendTax(realm, prior);
        _ctl.set(realm.id, { integral, prevError });
        const newLegitimacy = Math.round(legitimacyResponse(realm.legitimacy, newTax));
        update.run(newLegitimacy, newTax, realm.id);
        adjusted++;
        try { emit("realm:governance-adjusted", { realmId: realm.id, legitimacy: newLegitimacy, taxRate: newTax }); } catch { /* noop */ }
      } catch { /* per-realm isolation */ }
    }
    return { ok: true, adjusted };
  } catch (err) {
    try { logger.debug?.("realm-control-cycle", "pass_failed", { error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: String(err?.message || err) };
  }
}

// test seam
export const _testing = { reset() { _ctl.clear(); } };
