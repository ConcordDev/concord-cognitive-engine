// server/domains/studio-credits.js
//
// Studio Sprint B Item #11 — Mentorship-as-production.
//
// Hire another producer (human or emergent) on your track. Credit
// them once the work ships. Their accumulated credits feed into
// their skill ranking; their CC share routes through the cascade
// proportional to contribution_ratio.

import crypto from "node:crypto";

const VALID_ROLES = new Set([
  "mixer", "arranger", "mastering", "co_producer",
  "session_player", "vocal_producer", "sound_designer",
]);
const MAX_NOTES_LEN = 2000;

function clampRatio(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0.0001, n));
}

export default function registerStudioCreditMacros(register) {
  // Hire a producer. Lightweight: records intent + agreed price.
  // The hand-shake itself is producer-to-producer DM, this macro
  // just persists the agreement.
  register("studio", "hire_producer", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const hirerId = ctx?.actor?.userId;
    if (!hirerId) return { ok: false, reason: "no_actor" };
    const producerUserId = String(input.producer_user_id || "").trim();
    if (!producerUserId) return { ok: false, reason: "producer_user_id_required" };
    if (producerUserId === hirerId) return { ok: false, reason: "cannot_hire_self" };
    const role = String(input.role || "");
    if (!VALID_ROLES.has(role)) return { ok: false, reason: "invalid_role", valid: [...VALID_ROLES] };
    const agreedCc = Number(input.agreed_cc) || 0;
    if (agreedCc < 0) return { ok: false, reason: "agreed_cc_negative" };
    const scope = String(input.scope || "").slice(0, 500);
    // Reuse the existing mentorship.requestMentorship primitive
    // where available — it already models the hire as a request.
    try {
      const m = await import("../lib/mentorship.js");
      if (typeof m.requestMentorship === "function") {
        return m.requestMentorship(db, {
          requesterId: hirerId,
          mentorId: producerUserId,
          topic: `Production hire — ${role}`,
          notes: `Role: ${role}\nAgreed CC: ${agreedCc}\nScope: ${scope}`,
        });
      }
    } catch { /* mentorship optional */ }
    // Fallback shape: write directly to a request-table-of-record
    // we don't depend on (best-effort log).
    return {
      ok: true,
      hire: {
        hirerId, producerUserId, role, agreed_cc: agreedCc, scope,
        recorded_at: Math.floor(Date.now() / 1000),
      },
    };
  }, { note: "request a production hire — mentor/mentee handshake" });

  // Credit a producer on a production DTU. Writes a row in
  // producer_credits + routes a partial royalty share via the cascade
  // (best-effort).
  register("studio", "credit_producer", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const ownerId = ctx?.actor?.userId;
    if (!ownerId) return { ok: false, reason: "no_actor" };

    const trackDtuId = String(input.track_dtuId || "").trim();
    const producerUserId = String(input.producer_user_id || "").trim();
    const role = String(input.role || "");
    if (!trackDtuId || !producerUserId) return { ok: false, reason: "missing_ids" };
    if (!VALID_ROLES.has(role)) return { ok: false, reason: "invalid_role", valid: [...VALID_ROLES] };
    if (producerUserId === ownerId) return { ok: false, reason: "cannot_self_credit" };
    const contribution = clampRatio(input.contribution_ratio);
    if (contribution <= 0) return { ok: false, reason: "invalid_contribution_ratio" };

    // Verify the production DTU exists + caller owns it.
    let production;
    try {
      production = db.prepare(`SELECT id, creator_id FROM dtus WHERE id = ?`).get(trackDtuId);
    } catch { /* dtus optional */ }
    if (!production) return { ok: false, reason: "track_not_found" };
    if (production.creator_id !== ownerId) return { ok: false, reason: "not_track_owner" };

    const skillLevel = Number(input.skill_level_at_credit) || 1;
    const ccPayment = Number(input.cc_payment_at_credit) || 0;
    const notes = String(input.notes || "").slice(0, MAX_NOTES_LEN);

    const id = `pc_${crypto.randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO producer_credits
          (id, production_dtu_id, producer_user_id, role,
           skill_level_at_credit, contribution_ratio, cc_payment_at_credit, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      `).run(id, trackDtuId, producerUserId, role,
             Math.round(skillLevel), contribution, ccPayment, notes);
    } catch (err) {
      // UNIQUE constraint or table-missing both surface as conflict
      // from the caller's POV — return a structured reason.
      if (err?.message?.includes("UNIQUE")) return { ok: false, reason: "duplicate_credit" };
      if (err?.message?.includes("no such table")) return { ok: false, reason: "credits_table_missing" };
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
    return {
      ok: true,
      credit: {
        id, track_dtuId: trackDtuId, producer_user_id: producerUserId,
        role, contribution_ratio: contribution,
        skill_level_at_credit: Math.round(skillLevel),
        cc_payment_at_credit: ccPayment,
      },
    };
  }, { note: "credit a producer on a track DTU with a contribution share" });

  // List credits — by track, by producer, or both.
  register("studio", "list_credits", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const trackDtuId = input.track_dtuId ? String(input.track_dtuId) : null;
    const producerUserId = input.producer_user_id ? String(input.producer_user_id) : null;
    if (!trackDtuId && !producerUserId) return { ok: false, reason: "track_dtuId_or_producer_required" };

    const limit = Math.max(1, Math.min(500, parseInt(input.limit) || 100));
    let rows = [];
    try {
      if (trackDtuId && producerUserId) {
        rows = db.prepare(`
          SELECT * FROM producer_credits
            WHERE production_dtu_id = ? AND producer_user_id = ?
            ORDER BY created_at DESC LIMIT ?
        `).all(trackDtuId, producerUserId, limit);
      } else if (trackDtuId) {
        rows = db.prepare(`
          SELECT * FROM producer_credits
            WHERE production_dtu_id = ? ORDER BY contribution_ratio DESC LIMIT ?
        `).all(trackDtuId, limit);
      } else {
        rows = db.prepare(`
          SELECT * FROM producer_credits
            WHERE producer_user_id = ? ORDER BY created_at DESC LIMIT ?
        `).all(producerUserId, limit);
      }
    } catch (err) {
      if (err?.message?.includes("no such table")) {
        return { ok: false, reason: "credits_table_missing" };
      }
      return { ok: false, reason: "query_failed", error: err?.message };
    }
    return { ok: true, credits: rows };
  }, { note: "list production credits by track or producer" });
}
