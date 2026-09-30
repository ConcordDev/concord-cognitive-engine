// server/lib/capability-forge/index.js
//
// Runtime capability registration — discovered skills become mission tools.

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_capability_registry'`).get();
  } catch {
    return false;
  }
}

export function registerCapability(db, {
  capabilityId, name, description, domainPack, tools = [], status = "registered",
} = {}) {
  if (!db || !capabilityId || !name) return { ok: false, reason: "missing_inputs" };
  if (!tablesReady(db)) return { ok: false, reason: "migration_required" };
  const ts = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`
      INSERT INTO runtime_capability_registry
        (capability_id, name, description, domain_pack, tools_json, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(capability_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        domain_pack = excluded.domain_pack,
        tools_json = excluded.tools_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(capabilityId, name, description || null, domainPack || null, JSON.stringify(tools), status, ts);
    return { ok: true, capabilityId, status };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function activateCapability(db, capabilityId, benchmarkResult = null) {
  if (!db || !capabilityId || !tablesReady(db)) return { ok: false, reason: "missing_inputs" };
  try {
    db.prepare(`
      UPDATE runtime_capability_registry
      SET status = 'active', benchmark_json = ?, updated_at = ?
      WHERE capability_id = ?
    `).run(benchmarkResult ? JSON.stringify(benchmarkResult) : null, Math.floor(Date.now() / 1000), capabilityId);
    return { ok: true, capabilityId, status: "active", promoted: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function listCapabilities(db, { status, limit = 50 } = {}) {
  if (!db || !tablesReady(db)) return [];
  try {
    if (status) {
      return db.prepare(`
        SELECT * FROM runtime_capability_registry WHERE status = ? ORDER BY updated_at DESC LIMIT ?
      `).all(status, Math.min(limit, 100));
    }
    return db.prepare(`
      SELECT * FROM runtime_capability_registry ORDER BY updated_at DESC LIMIT ?
    `).all(Math.min(limit, 100));
  } catch {
    return [];
  }
}

export function forgeCapabilityFromNeed(db, { need, tools, domainPack } = {}) {
  if (!need || !tools?.length) return { ok: false, reason: "missing_inputs" };
  const capabilityId = `cap_${String(need).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`;
  return registerCapability(db, {
    capabilityId,
    name: String(need).slice(0, 80),
    description: `Forged capability for: ${need}`,
    domainPack,
    tools,
    status: "testing",
  });
}
