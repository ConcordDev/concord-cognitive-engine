// server/lib/tessera-parity.js
//
// Managed parity — the Tessera funding both sides of a war so it never resolves.
// "Parity wasn't a stalemate; it was the product." The funder keeps each
// belligerent's momentum off the truce threshold (faction-strategy truces at
// momentum <= -0.6): whenever a funded faction's momentum sags toward collapse,
// the funding tops it back up to PARITY_FLOOR, so the war stays lit forever.
//
// Scoped by world_id (only ever acts on Sere). Kill-switch CONCORD_TESSERA_PARITY=0.
// Discoverable, not told: the faction_funding rows are what the Ledger lens
// surfaces; the main arc's payoff is REMOVING the funding (endFunding), after
// which the war can finally truce.

import crypto from "node:crypto";

const TRUCE_THRESHOLD = -0.6;       // faction-strategy seeks truce at/below this
const PARITY_ENGAGE = -0.45;        // when a funded faction sags past this...
const PARITY_FLOOR = -0.35;         // ...the funding tops it back up to here (still losing, never collapsing)

export function enabled() {
  return process.env.CONCORD_TESSERA_PARITY !== "0";
}

function tableOk(db) {
  try { db.prepare("SELECT 1 FROM faction_funding LIMIT 1").get(); return true; }
  catch { return false; }
}

/** Idempotent: record a funder keeping two belligerents in managed parity. */
export function recordFunding(db, { worldId, funderId, warFactionA, warFactionB }) {
  if (!db || !worldId || !funderId || !warFactionA || !warFactionB) return { ok: false, reason: "missing_inputs" };
  if (!tableOk(db)) return { ok: false, reason: "no_table" };
  try {
    const id = `fund_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO faction_funding (id, world_id, funder_id, war_faction_a, war_faction_b, active)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(world_id, funder_id, war_faction_a, war_faction_b)
      DO UPDATE SET active = 1, ended_at = NULL
    `).run(id, worldId, funderId, warFactionA, warFactionB);
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

/** The main-arc payoff: cut the funding so the war can finally resolve. */
export function endFunding(db, { worldId, warFactionA, warFactionB }) {
  if (!tableOk(db)) return { ok: false, reason: "no_table" };
  try {
    const r = db.prepare(`
      UPDATE faction_funding SET active = 0, ended_at = unixepoch()
      WHERE world_id = ? AND active = 1
        AND ((war_faction_a = ? AND war_faction_b = ?) OR (war_faction_a = ? AND war_faction_b = ?))
    `).run(worldId, warFactionA, warFactionB, warFactionB, warFactionA);
    return { ok: true, ended: r.changes };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

export function activeFunding(db, worldId) {
  if (!tableOk(db)) return [];
  try {
    return worldId
      ? db.prepare("SELECT * FROM faction_funding WHERE world_id = ? AND active = 1").all(worldId)
      : db.prepare("SELECT * FROM faction_funding WHERE active = 1").all();
  } catch { return []; }
}

/** Seed the canonical Sere managed-parity web (the Tessera funding the Border Mirror). Idempotent. */
export function seedManagedParity(db) {
  if (!enabled() || !tableOk(db)) return { ok: true, seeded: 0 };
  return { ok: true, seeded: recordFunding(db, {
    worldId: "sere", funderId: "the_tessera", warFactionA: "dovrane", warFactionB: "keshar",
  }).ok ? 1 : 0 };
}

/**
 * Clamp the momentum of funded belligerents so the war never reaches truce.
 * Pure-ish: reads/writes faction_strategy_state. Returns the factions topped up.
 * No-op when disabled, no table, or no faction_strategy_state.
 */
export function clampParity(db, worldId = "sere") {
  if (!enabled()) return { ok: true, reason: "disabled", clamped: [] };
  if (!tableOk(db)) return { ok: true, reason: "no_table", clamped: [] };
  let getMom, setMom;
  try {
    getMom = db.prepare("SELECT momentum FROM faction_strategy_state WHERE faction_id = ?");
    setMom = db.prepare("UPDATE faction_strategy_state SET momentum = ?, updated_at = unixepoch() WHERE faction_id = ?");
  } catch { return { ok: true, reason: "no_strategy_state", clamped: [] }; }

  const clamped = [];
  for (const f of activeFunding(db, worldId)) {
    for (const fid of [f.war_faction_a, f.war_faction_b]) {
      try {
        const row = getMom.get(fid);
        if (!row) continue;
        const m = Number(row.momentum) || 0;
        // Only intervene once a belligerent is sagging toward collapse — keep it
        // losing (below 0) but never low enough to sue for peace.
        if (m <= PARITY_ENGAGE && m > TRUCE_THRESHOLD - 0.5) {
          setMom.run(PARITY_FLOOR, fid);
          clamped.push({ factionId: fid, from: m, to: PARITY_FLOOR, funder: f.funder_id });
        } else if (m <= TRUCE_THRESHOLD) {
          // already at/below truce — the funding yanks it back so the war relights
          setMom.run(PARITY_FLOOR, fid);
          clamped.push({ factionId: fid, from: m, to: PARITY_FLOOR, funder: f.funder_id, relit: true });
        }
      } catch { /* per-faction isolation */ }
    }
  }
  return { ok: true, clamped };
}

export const _testing = { TRUCE_THRESHOLD, PARITY_ENGAGE, PARITY_FLOOR };
