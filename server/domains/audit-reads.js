// server/domains/audit-reads.js
//
// Smoking-gun cleanup I9 — read paths for the 8 write-only audit
// tables. Each had data flowing in but no consumer; dashboards
// showed empty / achievements blocked. This domain exposes one
// macro per table so the corresponding UI/diagnostics surface can
// finally query the data.

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

export default function registerAuditReadsMacros(register) {

  // ─── affect_events_log ────────────────────────────────────────
  // Powers "entity emotion over time" charts. Per-entity (NPC) timeline
  // of affect deltas (valence/arousal/salience/etc).
  register("affect", "affect_history", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const entityId = String(input.entityId || input.npcId || "");
    if (!entityId) return { ok: false, reason: "entityId_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 200), 1000);
    try {
      const rows = db.prepare(`
        SELECT id, entity_id, world_id, event_type, delta_json, occurred_at
        FROM affect_events_log
        WHERE entity_id = ?
        ORDER BY occurred_at DESC LIMIT ?
      `).all(entityId, limit);
      return { ok: true, history: rows.map((r) => ({ ...r, delta: _safeJson(r.delta_json, {}) })), count: rows.length };
    } catch (err) {
      return { ok: true, history: [], count: 0, reason: "table_unavailable", note: err?.message };
    }
  }, { note: "Per-entity affect event timeline (closes write-only on affect_events_log)" });

  // ─── homework_submissions ─────────────────────────────────────
  // Teachers can now list pending submissions and grade them.
  register("classroom", "list_submissions", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const cohortId = Number(input.cohortId);
    if (!cohortId) return { ok: false, reason: "cohortId_required" };
    const filter = input.filter === "graded" ? "AND reviewed_at IS NOT NULL"
                 : input.filter === "ungraded" ? "AND reviewed_at IS NULL"
                 : "";
    try {
      const rows = db.prepare(`
        SELECT id, cohort_id, student_user_id, dtu_id, score, submitted_at, reviewed_at
        FROM homework_submissions WHERE cohort_id = ? ${filter}
        ORDER BY submitted_at DESC LIMIT 500
      `).all(cohortId);
      return { ok: true, submissions: rows, count: rows.length };
    } catch (err) {
      return { ok: true, submissions: [], count: 0, reason: "table_unavailable", note: err?.message };
    }
  }, { note: "List homework submissions for a cohort (closes write-only on homework_submissions)" });

  register("classroom", "grade_submission", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = Number(input.submissionId || input.id);
    const score = Number(input.score);
    if (!id || !Number.isFinite(score)) return { ok: false, reason: "submissionId_and_score_required" };
    const clamped = Math.max(0, Math.min(100, score));
    try {
      const r = db.prepare(`UPDATE homework_submissions SET score = ?, reviewed_at = unixepoch() WHERE id = ?`).run(clamped, id);
      return { ok: r.changes > 0, score: clamped };
    } catch (err) {
      return { ok: false, reason: "update_failed", error: err?.message };
    }
  }, { destructive: true, note: "Teacher grades a submission" });

  // ─── land_claim_events ────────────────────────────────────────
  // Players can finally see their claim's event timeline.
  register("land-claims", "history", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const claimId = String(input.claimId || "");
    if (!claimId) return { ok: false, reason: "claimId_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 100), 500);
    try {
      const rows = db.prepare(`
        SELECT id, claim_id, kind, actor_id, detail_json, occurred_at
        FROM land_claim_events
        WHERE claim_id = ?
        ORDER BY occurred_at DESC LIMIT ?
      `).all(claimId, limit);
      return { ok: true, events: rows.map((r) => ({ ...r, detail: _safeJson(r.detail_json, {}) })), count: rows.length };
    } catch (err) {
      return { ok: true, events: [], count: 0, reason: "table_unavailable", note: err?.message };
    }
  }, { note: "Land claim activity log: trespass / build / decay / maintenance_paid / expired / invite" });

  // ─── npc_ambition_log ─────────────────────────────────────────
  // "What are the NPCs scheming?" — debugging visibility + potential
  // player-facing surface.
  register("npc", "ambition_log", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId ? String(input.worldId) : null;
    const limit = Math.min(Math.max(1, Number(input.limit) || 100), 500);
    try {
      const sql = worldId
        ? `SELECT id, npc_id, move_kind, target_kind, target_id, world_id, outcome, logged_at FROM npc_ambition_log WHERE world_id = ? ORDER BY logged_at DESC LIMIT ?`
        : `SELECT id, npc_id, move_kind, target_kind, target_id, world_id, outcome, logged_at FROM npc_ambition_log ORDER BY logged_at DESC LIMIT ?`;
      const rows = worldId ? db.prepare(sql).all(worldId, limit) : db.prepare(sql).all(limit);
      return { ok: true, ambitions: rows, count: rows.length };
    } catch (err) {
      return { ok: true, ambitions: [], count: 0, reason: "table_unavailable", note: err?.message };
    }
  }, { note: "NPC high-stakes moves log (war declarations, ambitious schemes)" });

  // ─── npc_skill_acquisitions ───────────────────────────────────
  // NPC-to-NPC knowledge trade audit (economy health diagnostics).
  register("npc-economy", "skill_acquisitions", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 100), 500);
    try {
      const filters = [];
      const args = [];
      if (input.buyerNpcId) { filters.push("buyer_npc_id = ?"); args.push(String(input.buyerNpcId)); }
      if (input.sellerNpcId) { filters.push("seller_npc_id = ?"); args.push(String(input.sellerNpcId)); }
      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      args.push(limit);
      const rows = db.prepare(`
        SELECT id, buyer_npc_id, seller_npc_id, recipe_dtu_id, price, acquired_at
        FROM npc_skill_acquisitions ${where} ORDER BY acquired_at DESC LIMIT ?
      `).all(...args);
      return { ok: true, acquisitions: rows, count: rows.length };
    } catch (err) {
      return { ok: true, acquisitions: [], count: 0, reason: "table_unavailable", note: err?.message };
    }
  }, { note: "NPC-to-NPC skill purchase audit trail" });

  // ─── procgen_region_visits ────────────────────────────────────
  // Blocks regional-discovery achievements. Now achievement checks can
  // actually compute coverage.
  register("procgen", "user_visits", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const targetUserId = String(input.userId || userId || "");
    if (!targetUserId) return { ok: false, reason: "userId_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 200), 1000);
    try {
      const rows = db.prepare(`
        SELECT id, region_id, user_id, visited_at
        FROM procgen_region_visits
        WHERE user_id = ?
        ORDER BY visited_at DESC LIMIT ?
      `).all(targetUserId, limit);
      const uniqueRegions = new Set(rows.map((r) => r.region_id));
      return { ok: true, visits: rows, count: rows.length, uniqueRegions: uniqueRegions.size };
    } catch (err) {
      return { ok: true, visits: [], count: 0, uniqueRegions: 0, reason: "table_unavailable", note: err?.message };
    }
  }, { note: "Per-user procgen region visit history (closes achievement-blocker)" });

  // ─── social_ranking_audit ─────────────────────────────────────
  // Transparency surface — "why was MY post ranked low?"
  register("social-ai", "get_ranking_audit", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const postId = String(input.postId || "");
    if (!postId) return { ok: false, reason: "postId_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 50), 500);
    try {
      const rows = db.prepare(`
        SELECT id, user_id, post_id, algo_id, score, breakdown_json, reasons_json, created_at
        FROM social_ranking_audit
        WHERE post_id = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(postId, limit);
      return {
        ok: true,
        audit: rows.map((r) => ({
          ...r,
          breakdown: _safeJson(r.breakdown_json, {}),
          reasons: _safeJson(r.reasons_json, []),
        })),
        count: rows.length,
      };
    } catch (err) {
      return { ok: true, audit: [], count: 0, reason: "table_unavailable", note: err?.message };
    }
  }, { note: "Per-post ranking audit (algorithmic transparency — 'why am I seeing this?' history)" });

  // ─── war_town_captures ────────────────────────────────────────
  // War-history surface for faction lens / narrative replay.
  register("war-campaigns", "town_capture_history", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 100), 500);
    try {
      const filters = [];
      const args = [];
      if (input.campaignId) { filters.push("campaign_id = ?"); args.push(String(input.campaignId)); }
      if (input.territoryId) { filters.push("territory_id = ?"); args.push(String(input.territoryId)); }
      if (input.realmId) { filters.push("(from_realm_id = ? OR to_realm_id = ?)"); args.push(String(input.realmId), String(input.realmId)); }
      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      args.push(limit);
      const rows = db.prepare(`
        SELECT id, campaign_id, territory_id, from_realm_id, to_realm_id, captured_at
        FROM war_town_captures ${where} ORDER BY captured_at DESC LIMIT ?
      `).all(...args);
      return { ok: true, captures: rows, count: rows.length };
    } catch (err) {
      return { ok: true, captures: [], count: 0, reason: "table_unavailable", note: err?.message };
    }
  }, { note: "Territory capture history for war campaigns / faction narrative" });
}
