// server/lib/kingdom-takeover.js
//
// Sprint C / Track D3 — three takeover paths.
//
// 1. Conquest      — kill ruler in combat + hold capital_settlement_id 6h
//                    via cityPresence. legitimacy = 30.
// 2. Inheritance   — assassinate via Track A4 scheme + on heir slot OR
//                    ruler had no heir. legitimacy = 60.
// 3. Election      — kingdom-scoped governance proposal (uses
//                    `governance.js` infra) reaches threshold among
//                    citizens with loyalty ≥ 50. legitimacy = 80.

import logger from "../logger.js";
import { getKingdom, assignRuler } from "./kingdoms.js";
import { recordOpinionEvent } from "./npc-opinions.js";

const HOLD_HOURS_FOR_CONQUEST = 6;

const CONQUEST_LEGITIMACY = 30;
const INHERITANCE_LEGITIMACY = 60;
const ELECTION_LEGITIMACY = 80;

/**
 * Attempt a conquest takeover. Caller (combat path) supplies the proof
 * (ruler killed + capital held timestamp). For automated tests we accept
 * `proof.bypass = true`.
 */
export function takeoverByConquest(db, userId, kingdomId, proof = {}) {
  if (!db || !userId || !kingdomId) return { ok: false, reason: "missing_inputs" };
  const k = getKingdom(db, kingdomId);
  if (!k) return { ok: false, reason: "kingdom_not_found" };
  if (k.ruler_kind === "player" && k.ruler_id === userId) return { ok: false, reason: "already_ruler" };

  const now = Math.floor(Date.now() / 1000);
  if (!proof.bypass) {
    if (!proof.rulerKilledAt) return { ok: false, reason: "ruler_not_killed" };
    if (!proof.capitalHeldSince) return { ok: false, reason: "capital_not_held" };
    if ((now - proof.capitalHeldSince) < HOLD_HOURS_FOR_CONQUEST * 3600) {
      return { ok: false, reason: "hold_duration_short", needHours: HOLD_HOURS_FOR_CONQUEST };
    }
  }

  assignRuler(db, kingdomId, { rulerKind: "player", rulerId: userId, legitimacy: CONQUEST_LEGITIMACY });
  try { logger.info?.("kingdom_takeover_conquest", { userId, kingdomId }); } catch { /* noop */ }
  return { ok: true, legitimacy: CONQUEST_LEGITIMACY, path: "conquest" };
}

/**
 * Inheritance takeover — caller has assassinated (or otherwise
 * legitimately inherited from) the prior ruler.
 */
export function takeoverByInheritance(db, userId, kingdomId, { viaSchemeId = null, heirOfNpcId = null } = {}) {
  if (!db || !userId || !kingdomId) return { ok: false, reason: "missing_inputs" };
  const k = getKingdom(db, kingdomId);
  if (!k) return { ok: false, reason: "kingdom_not_found" };
  // Validate heir slot or no heirs at all.
  let qualified = !heirOfNpcId; // if heirOfNpcId is null, only allow when ruler has no heirs
  if (heirOfNpcId) {
    try {
      const heirRow = db.prepare(`
        SELECT 1 FROM npc_inheritance_links WHERE deceased_npc_id = ? AND heir_npc_id = ? LIMIT 1
      `).get(heirOfNpcId, userId);
      qualified = Boolean(heirRow);
    } catch { /* table missing — treat as not qualified */ }
  } else {
    try {
      const r = db.prepare(`SELECT COUNT(*) AS n FROM npc_inheritance_links WHERE deceased_npc_id = ?`).get(k.ruler_id);
      qualified = (r?.n ?? 0) === 0;
    } catch { /* fall through */ }
  }
  if (!qualified) return { ok: false, reason: "not_heir" };

  assignRuler(db, kingdomId, { rulerKind: "player", rulerId: userId, legitimacy: INHERITANCE_LEGITIMACY });
  try { logger.info?.("kingdom_takeover_inheritance", { userId, kingdomId, viaSchemeId }); } catch { /* noop */ }
  return { ok: true, legitimacy: INHERITANCE_LEGITIMACY, path: "inheritance" };
}

/**
 * Election takeover — caller has won a kingdom-scoped governance proposal.
 * The vote tally / quorum check is the caller's job; this function only
 * persists the transition.
 */
export function takeoverByElection(db, userId, kingdomId, { proposalId = null, voterTurnoutOk = true } = {}) {
  if (!db || !userId || !kingdomId) return { ok: false, reason: "missing_inputs" };
  const k = getKingdom(db, kingdomId);
  if (!k) return { ok: false, reason: "kingdom_not_found" };
  if (!voterTurnoutOk) return { ok: false, reason: "vote_invalid" };

  assignRuler(db, kingdomId, { rulerKind: "player", rulerId: userId, legitimacy: ELECTION_LEGITIMACY });
  try { logger.info?.("kingdom_takeover_election", { userId, kingdomId, proposalId }); } catch { /* noop */ }
  return { ok: true, legitimacy: ELECTION_LEGITIMACY, path: "election" };
}

/**
 * Player loses a kingdom — used by D4 rebellion path when player ruler
 * is "assassinated" (Sprint C decision: respawn + lose kingdom only).
 * Detaches the ruler binding into interregnum so a new takeover can land.
 */
export function deposeRuler(db, kingdomId, _reason) {
  if (!db || !kingdomId) return { ok: false };
  const k = getKingdom(db, kingdomId);
  if (!k) return { ok: false, reason: "kingdom_not_found" };
  assignRuler(db, kingdomId, { rulerKind: "interregnum", rulerId: null, legitimacy: 20 });
  // Suspend all active decrees (interregnum = "no rule").
  try {
    db.prepare(`UPDATE realm_decrees SET effect_state = 'expired' WHERE kingdom_id = ? AND effect_state = 'active'`).run(kingdomId);
  } catch { /* noop */ }
  return { ok: true };
}

/** Daily legitimacy regen / decay tick. */
export function tickLegitimacy(db) {
  if (!db) return { ok: false };
  // Decrement when last decree was unpopular; bump when last decree popular.
  // Cheap heuristic: look at most-recent active decree.
  const rows = db.prepare(`SELECT id FROM realms`).all();
  let touched = 0;
  for (const k of rows) {
    try {
      const last = db.prepare(`
        SELECT popularity_delta FROM realm_decrees WHERE kingdom_id = ?
        ORDER BY issued_at DESC LIMIT 1
      `).get(k.id);
      if (!last) continue;
      const delta = last.popularity_delta < 0 ? -2 : last.popularity_delta > 0 ? +1 : 0;
      if (delta !== 0) {
        db.prepare(`
          UPDATE realms SET legitimacy = MAX(0, MIN(100, legitimacy + ?)), updated_at = unixepoch() WHERE id = ?
        `).run(delta, k.id);
        touched++;
      }
    } catch { /* noop */ }
  }
  return { ok: true, touched };
}

export const TAKEOVER_CONSTANTS = Object.freeze({
  HOLD_HOURS_FOR_CONQUEST,
  CONQUEST_LEGITIMACY,
  INHERITANCE_LEGITIMACY,
  ELECTION_LEGITIMACY,
});
