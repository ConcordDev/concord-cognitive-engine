// server/lib/chronicle/chronicle.js
//
// Living Society — Phase 7: the Chronicle ledger, weave-ingest, saga mint, and
// the ruler's "Realm Health" symptom surface.
//
// - recordEntry: write a composed beat (idempotent on (world, dedupe_key)).
// - weaveWorld: cursor-driven ingestion across the new labor/pay/grievance/
//   movement sources — exactly-once per source row.
// - realmHealth: DERIVED symptoms (fields untended %, worker flight, treasury,
//   avg loyalty) — the ruler reads the uprising through labor, not a bar.
// - mintSaga: a kind='chronicle' DTU citing the entries (earns royalties).

import crypto from "node:crypto";
import { composeEntry } from "./compose.js";

/** Write a composed entry. Idempotent on (world_id, dedupe_key). */
export function recordEntry(db, worldId, kind, payload = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  const c = composeEntry(kind, payload);
  if (!c.ok) return c;
  const id = `chr_${crypto.randomUUID()}`;
  try {
    const r = db.prepare(`
      INSERT INTO world_chronicle (id, world_id, kind, dedupe_key, title, body, refs_json, importance, composer)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'deterministic')
      ON CONFLICT(world_id, dedupe_key) DO NOTHING
    `).run(id, worldId, kind, c.dedupeKey, c.title, c.body, JSON.stringify(payload.refs || []), c.importance);
    return { ok: true, inserted: r.changes > 0, id, dedupeKey: c.dedupeKey };
  } catch (e) { return { ok: false, reason: "persist_failed", error: e?.message }; }
}

function cursor(db, worldId, source) {
  try { return db.prepare(`SELECT last_cursor FROM world_chronicle_cursor WHERE world_id = ? AND source = ?`).get(worldId, source)?.last_cursor ?? 0; }
  catch { return 0; }
}
function setCursor(db, worldId, source, value) {
  try {
    db.prepare(`
      INSERT INTO world_chronicle_cursor (world_id, source, last_cursor, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(world_id, source) DO UPDATE SET last_cursor = ?, updated_at = unixepoch()
    `).run(worldId, source, value, value);
  } catch { /* table absent */ }
}

/**
 * Ingest new beats for a world from each source past its cursor. Returns the
 * count written. Exactly-once via the cursor + the dedupe_key unique index.
 */
export function weaveWorld(db, worldId, now = Math.floor(Date.now() / 1000)) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  let written = 0;

  // Source: uprisings (movement_uprisings).
  try {
    const last = cursor(db, worldId, "uprising");
    const rows = db.prepare(`SELECT movement_id, target_id, member_count, erupted_at FROM movement_uprisings WHERE world_id = ? AND erupted_at > ? ORDER BY erupted_at ASC LIMIT 100`).all(worldId, last);
    for (const r of rows) {
      const res = recordEntry(db, worldId, "uprising", { id: r.movement_id, target_id: r.target_id, members: r.member_count, world_id: worldId });
      if (res.inserted) written++;
      setCursor(db, worldId, "uprising", r.erupted_at);
    }
  } catch { /* source absent */ }

  // Source: world_events (decrees, generic) — only events not already chronicled.
  try {
    const last = cursor(db, worldId, "world_events");
    const rows = db.prepare(`SELECT id, event_type, title, created_at FROM world_events WHERE world_id = ? AND created_at > ? AND event_type IN ('uprising','decree','crisis') ORDER BY created_at ASC LIMIT 100`).all(worldId, last);
    for (const r of rows) {
      if (r.event_type === "decree") { if (recordEntry(db, worldId, "decree", { id: r.id, kind: r.title, world_id: worldId }).inserted) written++; }
      setCursor(db, worldId, "world_events", r.created_at);
    }
  } catch { /* source absent */ }

  // Source: recruitment growth (movements with rising visibility) — sampled.
  try {
    const last = cursor(db, worldId, "recruitment");
    const rows = db.prepare(`SELECT id, target_id, updated_at FROM movements WHERE world_id = ? AND status IN ('recruiting','organized') AND updated_at > ? ORDER BY updated_at ASC LIMIT 50`).all(worldId, last);
    for (const r of rows) {
      const m = db.prepare(`SELECT COUNT(*) AS n FROM movement_members WHERE movement_id = ? AND left_at IS NULL`).get(r.id)?.n ?? 0;
      if (recordEntry(db, worldId, "recruitment", { id: `${r.id}:${m}`, target_id: r.target_id, members: m, world_id: worldId }).inserted) written++;
      setCursor(db, worldId, "recruitment", r.updated_at);
    }
  } catch { /* source absent */ }

  return { ok: true, written };
}

/**
 * Ruler symptom surface. DERIVED only — never a rebellion %. Returns the labor
 * health a ruler actually observes.
 */
export function realmHealth(db, worldId, realmId = null) {
  const out = { worldId, fieldsUntendedPct: 0, untendedCrops: 0, totalCrops: 0, depletedNodes: 0, treasury: null, avgLoyalty: null, activeMovements: 0, openGrievance: 0 };
  try {
    const crops = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN growth_stage < 3 AND COALESCE(watered_at,0) < unixepoch() - 86400 THEN 1 ELSE 0 END) AS untended FROM claim_crops`).get();
    out.totalCrops = crops?.total || 0; out.untendedCrops = crops?.untended || 0;
    out.fieldsUntendedPct = out.totalCrops > 0 ? Math.round((out.untendedCrops / out.totalCrops) * 100) : 0;
  } catch { /* optional */ }
  try { out.depletedNodes = db.prepare(`SELECT COUNT(*) AS n FROM world_resource_nodes WHERE world_id = ? AND is_depleted = 1`).get(worldId)?.n || 0; } catch { /* optional */ }
  try { out.activeMovements = db.prepare(`SELECT COUNT(*) AS n FROM movements WHERE world_id = ? AND status IN ('recruiting','organized','acting')`).get(worldId)?.n || 0; } catch { /* optional */ }
  try { out.openGrievance = db.prepare(`SELECT COALESCE(SUM(g.severity),0) AS s FROM npc_grudges g JOIN world_npcs n ON n.id = g.npc_id WHERE n.world_id = ? AND g.resolved_at IS NULL AND g.target_kind IN ('faction','npc')`).get(worldId)?.s || 0; } catch { /* optional */ }
  if (realmId) {
    try { out.treasury = db.prepare(`SELECT treasury FROM realms WHERE id = ?`).get(realmId)?.treasury ?? null; } catch { /* optional */ }
    try { out.avgLoyalty = db.prepare(`SELECT AVG(loyalty) AS a FROM realm_citizens WHERE realm_id = ?`).get(realmId)?.a ?? null; } catch { /* optional */ }
  }
  return out;
}

/** Recent chronicle entries for a world. */
export function listEntries(db, worldId, limit = 50) {
  try { return db.prepare(`SELECT id, kind, title, body, importance, created_at FROM world_chronicle WHERE world_id = ? ORDER BY created_at DESC LIMIT ?`).all(worldId, limit); }
  catch { return []; }
}

/**
 * Mint a saga DTU from recent chronicle entries. kind='chronicle', default
 * scope 'personal'. Cites the entries so it earns royalties when reused. The
 * caller (HTTP route on the parent process) owns the DTU write — never the
 * heartbeat.
 */
export function mintSaga(db, { worldId, userId, title = null, entryLimit = 20 } = {}) {
  if (!db || !worldId || !userId) return { ok: false, reason: "missing_inputs" };
  const entries = listEntries(db, worldId, entryLimit);
  if (entries.length === 0) return { ok: false, reason: "no_entries" };
  const sagaTitle = title || `The Chronicle of ${worldId}`;
  const body = entries.map((e) => `• ${e.title}: ${e.body}`).join("\n");
  const dtuId = `chronicle_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, visibility, created_at)
      VALUES (?, 'chronicle', ?, ?, ?, 'private', unixepoch())
    `).run(dtuId, sagaTitle, userId, JSON.stringify({ human_summary: body.slice(0, 4000), scope: "personal" }));
  } catch (e) {
    // dtus column shape varies — best-effort minimal insert.
    try { db.prepare(`INSERT INTO dtus (id, type, title, creator_id) VALUES (?, 'chronicle', ?, ?)`).run(dtuId, sagaTitle, userId); }
    catch { return { ok: false, reason: "mint_failed", error: e?.message }; }
  }
  return { ok: true, dtuId, title: sagaTitle, citedEntries: entries.length };
}
