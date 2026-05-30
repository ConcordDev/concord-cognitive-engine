// server/lib/npc-persona.js
//
// Phase 9.1 (idea #3) — NPC-persona marketplace.
//
// Pack an NPC (their grudges + schemes + schedule + opinions +
// asymmetry traits) as a kind='npc_persona' DTU. Other players
// import it into their world; the system spawns a fresh world_npcs
// row attached to the imported persona.
//
// Reuses Phase 0 universal file format (DTU envelope) + Phase 1
// NPC-creator path on `mintForgeAppAsDtu` (mentor royalty cascade).

import crypto from "node:crypto";

export function serialiseNPC(db, npcId) {
  if (!db || !npcId) return { ok: false, reason: "missing_inputs" };
  const npc = db.prepare(`SELECT * FROM world_npcs WHERE id = ?`).get(npcId);
  if (!npc) return { ok: false, reason: "npc_not_found" };

  const pkg = { schema: "concord-npc-persona/v1", origin_npc_id: npcId, npc };

  const tries = [
    ["grudges",       `SELECT * FROM npc_grudges WHERE npc_id = ?`,       [npcId]],
    ["schemes",       `SELECT * FROM npc_schemes WHERE plotter_kind = 'npc' AND plotter_id = ?`, [npcId]],
    ["schedule",      `SELECT * FROM npc_schedules WHERE npc_id = ?`,     [npcId]],
    ["opinions",      `SELECT * FROM character_opinions WHERE holder_npc_id = ?`, [npcId]],
    ["preoccupations",`SELECT * FROM npc_preoccupations WHERE npc_id = ?`,[npcId]],
    ["desires",       `SELECT * FROM npc_desires WHERE npc_id = ?`,       [npcId]],
    ["secrets",       `SELECT * FROM secrets WHERE holder_npc_id = ?`,    [npcId]],
  ];
  // @sql-loop-ok: iterates 7 fixed query templates, NOT user-supplied
  // data — each prepare runs at most once per call (7 total), with
  // the same npcId scalar bound each time. This is fan-out across
  // distinct tables, not N+1 against rows of a single result set.
  // performance-hotspot detector flags any `db.prepare(...).all` inside
  // a `for` loop; this is the documented exemption pattern.
  for (const [field, sql, args] of tries) {
    try { pkg[field] = db.prepare(sql).all(...args); }
    catch { pkg[field] = []; }
  }

  const sha256 = crypto.createHash("sha256").update(JSON.stringify(pkg)).digest("hex");
  return { ok: true, package: pkg, sha256 };
}

export function mintPersonaDtu(db, { authorUserId, npcId, summary }) {
  if (!db || !authorUserId || !npcId) return { ok: false, reason: "missing_inputs" };
  const ser = serialiseNPC(db, npcId);
  if (!ser.ok) return ser;

  const dtuId = `npc_persona:${npcId}:${crypto.randomBytes(4).toString("hex")}`;
  const meta = {
    skill_kind: "npc_persona",
    package_sha256: ser.sha256,
    origin_npc_id: npcId,
    npc_name: ser.package.npc.name,
    grudge_count: ser.package.grudges.length,
    scheme_count: ser.package.schemes.length,
    package: ser.package,
  };
  try {
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, skill_level, total_experience, created_at)
      VALUES (?, 'npc_persona', ?, ?, ?, 1, 0, unixepoch())
    `).run(
      dtuId,
      `Persona: ${ser.package.npc.name || npcId}`,
      authorUserId,
      JSON.stringify({ ...meta, summary: summary || `Packaged NPC ${ser.package.npc.name || npcId}` }),
    );
    db.prepare(`
      INSERT INTO npc_persona_packages (origin_npc_id, author_user_id, dtu_id, package_sha256,
        includes_grudges, includes_schemes, includes_schedule)
      VALUES (?, ?, ?, ?, 1, 1, 1)
    `).run(npcId, authorUserId, dtuId, ser.sha256);
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }

  return { ok: true, dtuId, sha256: ser.sha256 };
}

export function installPersona(db, { dtuId, worldId, installerUserId, x = 0, z = 0 }) {
  if (!db || !dtuId || !worldId) return { ok: false, reason: "missing_inputs" };
  const dtu = db.prepare(`SELECT meta_json FROM dtus WHERE id = ?`).get(dtuId);
  if (!dtu) return { ok: false, reason: "dtu_not_found" };
  let meta = {};
  try { meta = JSON.parse(dtu.meta_json || "{}"); } catch { return { ok: false, reason: "bad_meta_json" }; }
  const pkg = meta.package;
  if (!pkg || pkg.schema !== "concord-npc-persona/v1") return { ok: false, reason: "not_a_persona_package" };

  const newId = `imported_${crypto.randomBytes(6).toString("hex")}`;
  const npc = pkg.npc || {};
  try {
    db.prepare(`
      INSERT INTO world_npcs (id, world_id, archetype, x, y, z, level, is_dead, is_conscious, is_immortal, narrative_context, state)
      VALUES (?, ?, ?, ?, 0, ?, ?, 0, 0, 0, ?, ?)
    `).run(
      newId, worldId,
      npc.archetype || "imported_persona",
      Number(x), Number(z),
      npc.level || 1,
      typeof npc.narrative_context === "string" ? npc.narrative_context : JSON.stringify(npc.narrative_context || {}),
      // world_npcs has no `name` column — the NPC name lives in the state JSON blob.
      JSON.stringify({ name: npc.name || "Imported NPC" }),
    );
  } catch (err) { return { ok: false, error: String(err?.message || err), at: "world_npcs_insert" }; }

  // Re-attach grudges, schedules, etc. to the new NPC id.
  const installs = [
    ["npc_grudges",        pkg.grudges,        ["npc_id", "target_kind", "target_id", "severity"]],
    ["npc_schemes",        pkg.schemes,        ["plotter_kind", "plotter_id", "kind", "phase"]],
    ["npc_schedules",      pkg.schedule,       ["npc_id", "block_idx", "activity_kind", "location_kind"]],
    ["character_opinions", pkg.opinions,       ["holder_npc_id", "subject_kind", "subject_id", "score"]],
  ];
  let imported = 0;
  for (const [table, rows, cols] of installs) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const vals = cols.map(c => {
        if (c === "npc_id" || c === "holder_npc_id" || c === "plotter_id") return newId;
        return r[c];
      });
      try {
        const placeholders = cols.map(() => "?").join(",");
        // @resource-leak-ok: iterates persona-package fields — fixed schema
        db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`).run(...vals);
        imported++;
      } catch { /* per-row best-effort */ }
    }
  }

  return { ok: true, importedNpcId: newId, importedRows: imported };
}
