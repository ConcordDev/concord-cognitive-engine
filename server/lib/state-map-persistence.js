// server/lib/state-map-persistence.js
//
// Smoking-gun cleanup helpers for migration 231:
//   - game_profiles      (was STATE.gameProfiles Map)
//   - custom_personas    (was STATE.customPersonas Map)
//   - council_proposals  (was STATE.councilProposals Map)
//
// Each section exposes a DB-first {get, list, save, delete} surface
// and a hydrate helper that warms the legacy in-memory Map shim on
// startup so any unchanged caller still sees the same data.

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

// ─── game_profiles ──────────────────────────────────────────────

export function getGameProfileRow(db, userId) {
  if (!db || !userId) return null;
  try {
    const r = db.prepare(`SELECT * FROM game_profiles WHERE user_id = ?`).get(userId);
    if (!r) return null;
    return {
      userId: r.user_id,
      xp: r.xp,
      level: r.level,
      badges: _safeJson(r.badges_json, []),
      streak: r.streak,
      lastActivityAt: r.last_activity_at,
      questsCompleted: r.quests_completed,
      concordCoin: r.concord_coin,
    };
  } catch { return null; }
}

export function upsertGameProfile(db, profile) {
  if (!db || !profile?.userId) return { ok: false, reason: "missing_args" };
  try {
    db.prepare(`
      INSERT INTO game_profiles (user_id, xp, level, badges_json, streak, last_activity_at, quests_completed, concord_coin, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        xp = excluded.xp,
        level = excluded.level,
        badges_json = excluded.badges_json,
        streak = excluded.streak,
        last_activity_at = excluded.last_activity_at,
        quests_completed = excluded.quests_completed,
        concord_coin = excluded.concord_coin,
        updated_at = excluded.updated_at
    `).run(
      profile.userId,
      Number(profile.xp) || 0,
      Number(profile.level) || 1,
      JSON.stringify(profile.badges || []),
      Number(profile.streak) || 0,
      profile.lastActivityAt || null,
      Number(profile.questsCompleted) || 0,
      Number(profile.concordCoin) || 0,
      _now(),
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "upsert_failed", error: err?.message };
  }
}

export function allGameProfiles(db) {
  if (!db) return [];
  try {
    const rows = db.prepare(`SELECT * FROM game_profiles`).all();
    return rows.map((r) => ({
      userId: r.user_id, xp: r.xp, level: r.level,
      badges: _safeJson(r.badges_json, []),
      streak: r.streak, lastActivityAt: r.last_activity_at,
      questsCompleted: r.quests_completed, concordCoin: r.concord_coin,
    }));
  } catch { return []; }
}

export function hydrateGameProfilesMap(db, map) {
  if (!map) return 0;
  const all = allGameProfiles(db);
  for (const p of all) map.set(p.userId, p);
  return all.length;
}

// ─── custom_personas ────────────────────────────────────────────

export function getCustomPersonaRow(db, id) {
  if (!db || !id) return null;
  try {
    const r = db.prepare(`SELECT * FROM custom_personas WHERE id = ?`).get(id);
    if (!r) return null;
    return {
      id: r.id, name: r.name, description: r.description,
      style: _safeJson(r.style_json, {}),
      traits: _safeJson(r.traits_json, []),
      systemPrompt: r.system_prompt,
      usageCount: r.usage_count,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  } catch { return null; }
}

export function upsertCustomPersona(db, persona) {
  if (!db || !persona?.id) return { ok: false, reason: "missing_args" };
  try {
    db.prepare(`
      INSERT INTO custom_personas (id, name, description, style_json, traits_json, system_prompt, usage_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        style_json = excluded.style_json,
        traits_json = excluded.traits_json,
        system_prompt = excluded.system_prompt,
        usage_count = excluded.usage_count,
        updated_at = excluded.updated_at
    `).run(
      persona.id, persona.name, persona.description || "",
      JSON.stringify(persona.style || {}),
      JSON.stringify(persona.traits || []),
      persona.systemPrompt || "",
      Number(persona.usageCount) || 0,
      persona.createdAt, persona.updatedAt,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "upsert_failed", error: err?.message };
  }
}

export function deleteCustomPersona(db, id) {
  if (!db || !id) return { ok: false };
  try {
    const r = db.prepare(`DELETE FROM custom_personas WHERE id = ?`).run(id);
    return { ok: r.changes > 0 };
  } catch { return { ok: false }; }
}

export function allCustomPersonas(db) {
  if (!db) return [];
  try {
    const rows = db.prepare(`SELECT * FROM custom_personas ORDER BY name`).all();
    return rows.map((r) => ({
      id: r.id, name: r.name, description: r.description,
      style: _safeJson(r.style_json, {}),
      traits: _safeJson(r.traits_json, []),
      systemPrompt: r.system_prompt,
      usageCount: r.usage_count,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  } catch { return []; }
}

export function hydrateCustomPersonasMap(db, map) {
  if (!map) return 0;
  const all = allCustomPersonas(db);
  for (const p of all) map.set(p.id, p);
  return all.length;
}

// ─── council_proposals ──────────────────────────────────────────

export function getCouncilProposalRow(db, id) {
  if (!db || !id) return null;
  try {
    const r = db.prepare(`SELECT * FROM council_proposals WHERE id = ?`).get(id);
    if (!r) return null;
    return {
      id: r.id, type: r.type, dtuId: r.dtu_id,
      proposedBy: r.proposed_by, reason: r.reason,
      status: r.status,
      votes: _safeJson(r.votes_json, {}),
      globalDtuId: r.global_dtu_id,
      createdAt: r.created_at, expiresAt: r.expires_at,
    };
  } catch { return null; }
}

export function upsertCouncilProposal(db, p) {
  if (!db || !p?.id) return { ok: false, reason: "missing_args" };
  try {
    db.prepare(`
      INSERT INTO council_proposals (id, type, dtu_id, proposed_by, reason, status, votes_json, global_dtu_id, created_at, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        reason = excluded.reason,
        status = excluded.status,
        votes_json = excluded.votes_json,
        global_dtu_id = excluded.global_dtu_id,
        updated_at = excluded.updated_at
    `).run(
      p.id, p.type || "promotion_to_global", p.dtuId,
      p.proposedBy, p.reason || "", p.status || "pending",
      JSON.stringify(p.votes || {}),
      p.globalDtuId || null,
      p.createdAt, p.expiresAt,
      _now(),
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "upsert_failed", error: err?.message };
  }
}

export function allCouncilProposals(db, { status = null, limit = 200 } = {}) {
  if (!db) return [];
  try {
    const sql = status
      ? `SELECT * FROM council_proposals WHERE status = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM council_proposals ORDER BY created_at DESC LIMIT ?`;
    const rows = status ? db.prepare(sql).all(status, limit) : db.prepare(sql).all(limit);
    return rows.map((r) => ({
      id: r.id, type: r.type, dtuId: r.dtu_id,
      proposedBy: r.proposed_by, reason: r.reason,
      status: r.status,
      votes: _safeJson(r.votes_json, {}),
      globalDtuId: r.global_dtu_id,
      createdAt: r.created_at, expiresAt: r.expires_at,
    }));
  } catch { return []; }
}

export function hydrateCouncilProposalsMap(db, map) {
  if (!map) return 0;
  const all = allCouncilProposals(db, { limit: 1000 });
  for (const p of all) map.set(p.id, p);
  return all.length;
}

export function expireOverdueProposals(db) {
  if (!db) return 0;
  try {
    const r = db.prepare(`
      UPDATE council_proposals
      SET status = 'expired', updated_at = ?
      WHERE status = 'pending' AND expires_at <= datetime('now')
    `).run(_now());
    return r.changes;
  } catch { return 0; }
}
