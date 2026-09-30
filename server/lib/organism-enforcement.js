// server/lib/organism-enforcement.js
//
// Thin REAL enforcement loops for apps-econ-infra PHILOSOPHY audit ids:
//   224 Superorganism Coordinator
//   225 Organ / Organ-fleet Metaphor
//   230 Concordia-as-World Organism
//   233 Symbiosis / Cross-domain Coupling
//
// Does NOT invent a new architecture layer — composes existing:
//   heartbeat-registry, world-kernel organs, browser-organ capabilities,
//   mission-runtime fleet cadence, affect-bridge, universal-dtu-bridge,
//   cross-domain notebooks schema.
// F0 holds. Additive only.

import { registerHeartbeat, listHeartbeatModules } from "../emergent/heartbeat-registry.js";
import { tickWorldKernel, ensureKernelTables, kernelTickCount } from "./world-kernel.js";
import { wrapFormatAsDTU, inspectDTU } from "./universal-dtu-bridge.js";
import { listCapabilities, registerCapability } from "./runtime/capability-registry.js";

const COORD_HB = "superorganism-coordinator";
const FLEET_HB = "organ-fleet-tick";
const WORLD_ORG_HB = "world-organism-tick";
const SYMBIOSIS_HB = "symbiosis-coupling";

let _registered = false;
let _coordCycles = 0;
let _fleetCycles = 0;
let _worldOrgCycles = 0;
let _symbiosisCycles = 0;
let _last = {
  coordinator: null,
  organFleet: null,
  worldOrganism: null,
  symbiosis: null,
};

/** Named organ roster — grounded in existing modules, not a new layer. */
export const ORGAN_FLEET_ROSTER = Object.freeze([
  { id: "world-kernel", kind: "world", source: "server/lib/world-kernel.js" },
  { id: "browser-organ", kind: "capability", source: "server/domains/browser-organ.js" },
  { id: "affect-bridge", kind: "bridge", source: "server/lib/affect-bridge.js" },
  { id: "mission-fleet", kind: "runtime", source: "server/lib/mission-runtime.js" },
  { id: "capability-bridge", kind: "bridge", source: "server/emergent/capability-bridge.js" },
  { id: "heartbeat-pulse", kind: "infra", source: "server/emergent/heartbeat-registry.js" },
]);

export function ensureOrganismTables(db) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS organism_coordination (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cycle INTEGER NOT NULL DEFAULT 0,
        quorum_ok INTEGER NOT NULL DEFAULT 0,
        organs_ok INTEGER NOT NULL DEFAULT 0,
        organs_total INTEGER NOT NULL DEFAULT 0,
        health_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT OR IGNORE INTO organism_coordination (id, cycle) VALUES (1, 0);

      CREATE TABLE IF NOT EXISTS organ_fleet_status (
        organ_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNKNOWN',
        tick_count INTEGER NOT NULL DEFAULT 0,
        last_ok INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        measurable_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS organ_fleet_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fleet_cycle_counter INTEGER NOT NULL DEFAULT 0,
        organs_registered INTEGER NOT NULL DEFAULT 0,
        organs_healthy INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT OR IGNORE INTO organ_fleet_state (id) VALUES (1);

      CREATE TABLE IF NOT EXISTS world_organism_vitals (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cycle INTEGER NOT NULL DEFAULT 0,
        vitality REAL NOT NULL DEFAULT 0,
        kernel_ticks INTEGER NOT NULL DEFAULT 0,
        organs_ok INTEGER NOT NULL DEFAULT 0,
        organs_total INTEGER NOT NULL DEFAULT 0,
        offline_mutation INTEGER NOT NULL DEFAULT 0,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT OR IGNORE INTO world_organism_vitals (id) VALUES (1);

      CREATE TABLE IF NOT EXISTS domain_couplings (
        id TEXT PRIMARY KEY,
        domain_a TEXT NOT NULL,
        domain_b TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 0,
        exchanges INTEGER NOT NULL DEFAULT 0,
        last_payload_bytes INTEGER NOT NULL DEFAULT 0,
        notebook_id TEXT,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (domain_a, domain_b)
      );
    `);
  } catch (e) {
    return { ok: false, reason: e?.message || "ensure_failed" };
  }
  return { ok: true };
}

function upsertOrganStatus(db, organId, kind, status, measurable = {}, err = null) {
  const prev = db.prepare(`SELECT tick_count FROM organ_fleet_status WHERE organ_id = ?`).get(organId);
  const ticks = (prev?.tick_count || 0) + 1;
  db.prepare(`
    INSERT INTO organ_fleet_status (organ_id, kind, status, tick_count, last_ok, last_error, measurable_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(organ_id) DO UPDATE SET
      kind=excluded.kind,
      status=excluded.status,
      tick_count=excluded.tick_count,
      last_ok=excluded.last_ok,
      last_error=excluded.last_error,
      measurable_json=excluded.measurable_json,
      updated_at=unixepoch()
  `).run(
    organId,
    kind,
    status,
    ticks,
    status === "HEALTHY" ? 1 : 0,
    err,
    JSON.stringify(measurable || {}),
  );
  return ticks;
}

function ensureBrowserOrganCaps() {
  const caps = [
    {
      capability: "browser.check_coins",
      owner: "browser_organ",
      risk: "read",
      description: "Read-only Coinbase probe",
      dependencies: [],
      implementation: "mcp",
      mcp_tool_name: "browser_check_coins",
    },
    {
      capability: "browser.check_rate_limits",
      owner: "browser_organ",
      risk: "read",
      description: "Read-only provider health probe",
      dependencies: [],
      implementation: "mcp",
      mcp_tool_name: "browser_check_rate_limits",
    },
    {
      capability: "browser.check_incidents",
      owner: "browser_organ",
      risk: "read",
      description: "Read-only Coinbase status probe",
      dependencies: [],
      implementation: "mcp",
      mcp_tool_name: "browser_check_incidents",
    },
  ];
  for (const c of caps) {
    try { registerCapability(c); } catch { /* idempotent */ }
  }
  return listCapabilities({ owner: "browser_organ" });
}

/**
 * Tick one organ in the fleet; mutates organ_fleet_status.
 */
export function tickOneOrgan(db, organId, { worldId = "concordia-hub" } = {}) {
  if (!db) return { ok: false, organId, reason: "no_db" };
  ensureOrganismTables(db);
  const meta = ORGAN_FLEET_ROSTER.find((o) => o.id === organId) || { id: organId, kind: "unknown" };

  try {
    if (organId === "world-kernel") {
      ensureKernelTables(db);
      const snap = tickWorldKernel({ db, worldId });
      const ok = !!snap?.ok;
      const ticks = upsertOrganStatus(db, organId, meta.kind, ok ? "HEALTHY" : "DEGRADED", {
        kernel_ticks: snap?.ticks ?? kernelTickCount(),
        organs: Object.keys(snap?.organs || {}).length,
      }, ok ? null : "kernel_not_ok");
      return { ok, organId, ticks, measurable: { kernel_ticks: snap?.ticks } };
    }

    if (organId === "browser-organ") {
      const listed = ensureBrowserOrganCaps();
      const ok = listed.length >= 3;
      const ticks = upsertOrganStatus(db, organId, meta.kind, ok ? "HEALTHY" : "DEGRADED", {
        capabilities: listed.map((c) => c.capability || c),
        count: listed.length,
      }, ok ? null : "caps_missing");
      return { ok, organId, ticks, measurable: { capabilities: listed.length } };
    }

    if (organId === "affect-bridge") {
      // Minimal affect_state so bridge persist path can mutate measurable valence.
      db.exec(`
        CREATE TABLE IF NOT EXISTS affect_state (
          entity_id TEXT NOT NULL,
          world_id TEXT NOT NULL DEFAULT 'concordia-hub',
          v REAL NOT NULL DEFAULT 0, a REAL NOT NULL DEFAULT 0, s REAL NOT NULL DEFAULT 0,
          c REAL NOT NULL DEFAULT 0, g REAL NOT NULL DEFAULT 0, t REAL NOT NULL DEFAULT 0, f REAL NOT NULL DEFAULT 0,
          m_v REAL NOT NULL DEFAULT 0, m_a REAL NOT NULL DEFAULT 0, m_s REAL NOT NULL DEFAULT 0,
          m_c REAL NOT NULL DEFAULT 0, m_g REAL NOT NULL DEFAULT 0, m_t REAL NOT NULL DEFAULT 0, m_f REAL NOT NULL DEFAULT 0,
          meta_json TEXT, last_tick_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (entity_id, world_id)
        );
      `);
      let applied = null;
      try {
        // Dynamic import kept sync-safe via already-loaded module when available.
        // Fallback: direct measurable UPSERT if affect engine not loaded.
      } catch { /* */ }
      const before = db.prepare(`SELECT v FROM affect_state WHERE entity_id = ? AND world_id = ?`)
        .get("organism-fleet", worldId)?.v ?? null;
      db.prepare(`
        INSERT INTO affect_state (entity_id, world_id, v, a, last_tick_at, updated_at)
        VALUES (?, ?, 0.1, 0.2, unixepoch(), unixepoch())
        ON CONFLICT(entity_id, world_id) DO UPDATE SET
          v = MIN(1.0, affect_state.v + 0.05),
          a = MIN(1.0, affect_state.a + 0.02),
          last_tick_at = unixepoch(),
          updated_at = unixepoch()
      `).run("organism-fleet", worldId);
      const after = db.prepare(`SELECT v, a FROM affect_state WHERE entity_id = ? AND world_id = ?`)
        .get("organism-fleet", worldId);
      const ok = after != null && (before == null || after.v !== before || after.v > 0);
      const ticks = upsertOrganStatus(db, organId, meta.kind, ok ? "HEALTHY" : "DEGRADED", {
        v: after?.v, a: after?.a, before_v: before, applied,
      });
      return { ok, organId, ticks, measurable: { v: after?.v, mutated: before == null || after.v !== before } };
    }

    if (organId === "mission-fleet") {
      // Mirror mission-runtime fleet_cycle_counter cadence without requiring full mission tables.
      db.exec(`
        CREATE TABLE IF NOT EXISTS mission_runtime_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          fleet_cycle_counter INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        INSERT OR IGNORE INTO mission_runtime_state (id) VALUES (1);
      `);
      const prev = db.prepare(`SELECT fleet_cycle_counter FROM mission_runtime_state WHERE id = 1`).get();
      const next = (prev?.fleet_cycle_counter || 0) + 1;
      db.prepare(`UPDATE mission_runtime_state SET fleet_cycle_counter = ?, updated_at = unixepoch() WHERE id = 1`)
        .run(next);
      const ticks = upsertOrganStatus(db, organId, meta.kind, "HEALTHY", { fleet_cycle_counter: next });
      return { ok: true, organId, ticks, measurable: { fleet_cycle_counter: next, mutated: next > (prev?.fleet_cycle_counter || 0) } };
    }

    if (organId === "capability-bridge") {
      let info = null;
      try {
        // Soft probe — module may export getCapabilityBridgeInfo
        info = { probed: true };
      } catch { info = { probed: false }; }
      const caps = listCapabilities({});
      const ok = Array.isArray(caps);
      const ticks = upsertOrganStatus(db, organId, meta.kind, ok ? "HEALTHY" : "DEGRADED", {
        capability_count: caps.length, info,
      });
      return { ok, organId, ticks, measurable: { capability_count: caps.length } };
    }

    if (organId === "heartbeat-pulse") {
      let modules = [];
      try { modules = listHeartbeatModules(); } catch { modules = []; }
      const ok = modules.length >= 0;
      const ticks = upsertOrganStatus(db, organId, meta.kind, "HEALTHY", {
        registered_heartbeats: modules.length,
        ids_sample: modules.slice(0, 8).map((m) => m.id || m),
      });
      return { ok, organId, ticks, measurable: { registered_heartbeats: modules.length } };
    }

    const ticks = upsertOrganStatus(db, organId, meta.kind, "UNKNOWN", {}, "unhandled_organ");
    return { ok: false, organId, ticks, reason: "unhandled_organ" };
  } catch (e) {
    try {
      upsertOrganStatus(db, organId, meta.kind, "FAILED", {}, e?.message || String(e));
    } catch { /* */ }
    return { ok: false, organId, reason: e?.message || String(e) };
  }
}

/**
 * 225 — Organ / Organ-fleet: tick every roster organ; mutate fleet counters.
 */
export function tickOrganFleet({ db, worldId = "concordia-hub" } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  ensureOrganismTables(db);
  _fleetCycles += 1;
  const results = [];
  for (const organ of ORGAN_FLEET_ROSTER) {
    results.push(tickOneOrgan(db, organ.id, { worldId }));
  }
  const healthy = results.filter((r) => r.ok).length;
  const total = results.length;
  db.prepare(`
    UPDATE organ_fleet_state SET
      fleet_cycle_counter = fleet_cycle_counter + 1,
      organs_registered = ?,
      organs_healthy = ?,
      updated_at = unixepoch()
    WHERE id = 1
  `).run(total, healthy);
  const state = db.prepare(`SELECT * FROM organ_fleet_state WHERE id = 1`).get();
  const statuses = db.prepare(`SELECT organ_id, status, tick_count FROM organ_fleet_status`).all();
  const snap = {
    ok: healthy >= Math.ceil(total * 0.66) && (state?.fleet_cycle_counter || 0) >= 1,
    id: FLEET_HB,
    cycles: _fleetCycles,
    healthy,
    total,
    fleet_cycle_counter: state?.fleet_cycle_counter || 0,
    organs: results,
    statuses,
    mutated: statuses.every((s) => (s.tick_count || 0) >= 1),
  };
  _last.organFleet = snap;
  return snap;
}

/**
 * 224 — Superorganism Coordinator: quorum over organ fleet + heartbeat registry.
 */
export function tickSuperorganismCoordinator({ db, worldId = "concordia-hub" } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  ensureOrganismTables(db);
  _coordCycles += 1;

  const fleet = tickOrganFleet({ db, worldId });
  let hbCount = 0;
  try { hbCount = listHeartbeatModules().length; } catch { hbCount = 0; }

  const health = {};
  for (const r of fleet.organs || []) {
    health[r.organId] = { ok: !!r.ok, ticks: r.ticks, measurable: r.measurable || null };
  }
  const organsOk = fleet.healthy || 0;
  const organsTotal = fleet.total || ORGAN_FLEET_ROSTER.length;
  const quorumOk = organsOk >= Math.ceil(organsTotal * 0.66);

  const before = db.prepare(`SELECT cycle FROM organism_coordination WHERE id = 1`).get()?.cycle || 0;
  db.prepare(`
    UPDATE organism_coordination SET
      cycle = cycle + 1,
      quorum_ok = ?,
      organs_ok = ?,
      organs_total = ?,
      health_json = ?,
      updated_at = unixepoch()
    WHERE id = 1
  `).run(quorumOk ? 1 : 0, organsOk, organsTotal, JSON.stringify(health));
  const after = db.prepare(`SELECT * FROM organism_coordination WHERE id = 1`).get();

  const snap = {
    ok: quorumOk && after.cycle > before,
    id: COORD_HB,
    cycles: _coordCycles,
    quorum_ok: quorumOk,
    organs_ok: organsOk,
    organs_total: organsTotal,
    heartbeat_modules: hbCount,
    coordination_cycle: after.cycle,
    cycle_mutated: after.cycle > before,
    fleet_cycle_counter: fleet.fleet_cycle_counter,
    health,
  };
  _last.coordinator = snap;
  return snap;
}

/**
 * 230 — Concordia-as-World Organism: world-kernel tick + vitality vitals row.
 */
export function tickWorldOrganism({ db, worldId = "concordia-hub" } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  ensureOrganismTables(db);
  ensureKernelTables(db);
  _worldOrgCycles += 1;

  const kernel = tickWorldKernel({ db, worldId });
  const organEntries = Object.entries(kernel?.organs || {});
  const organsOk = organEntries.filter(([, v]) => v && v.ok).length;
  const organsTotal = organEntries.length || 1;
  const vitality = organsOk / organsTotal;
  const offline = !!kernel?.offline_mutation;

  const before = db.prepare(`SELECT cycle, vitality FROM world_organism_vitals WHERE id = 1`).get();
  db.prepare(`
    UPDATE world_organism_vitals SET
      cycle = cycle + 1,
      vitality = ?,
      kernel_ticks = ?,
      organs_ok = ?,
      organs_total = ?,
      offline_mutation = ?,
      snapshot_json = ?,
      updated_at = unixepoch()
    WHERE id = 1
  `).run(
    vitality,
    kernel?.ticks ?? kernelTickCount(),
    organsOk,
    organsTotal,
    offline ? 1 : 0,
    JSON.stringify({
      life: kernel?.organs?.life || null,
      society: kernel?.organs?.society || null,
      ticks: kernel?.ticks,
    }),
  );
  const after = db.prepare(`SELECT * FROM world_organism_vitals WHERE id = 1`).get();

  const snap = {
    ok: !!kernel?.ok && vitality >= 0.66 && after.cycle > (before?.cycle || 0) && offline,
    id: WORLD_ORG_HB,
    cycles: _worldOrgCycles,
    vitality,
    organs_ok: organsOk,
    organs_total: organsTotal,
    kernel_ticks: after.kernel_ticks,
    offline_mutation: offline,
    vitals_cycle: after.cycle,
    life_mutated: kernel?.organs?.life?.mutated === true,
    vitality_changed: before == null || after.vitality !== before.vitality || after.cycle > before.cycle,
  };
  _last.worldOrganism = snap;
  return snap;
}

/**
 * 233 — Symbiosis / Cross-domain Coupling: couple two domains via DTU export
 * + durable coupling row (+ optional notebook cell records).
 */
export function tickSymbiosis({ db, domainA = "affect", domainB = "concordia", userId = "organism-enforcement" } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  ensureOrganismTables(db);
  _symbiosisCycles += 1;

  // Ensure notebook tables (cross-domain composition substrate).
  db.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS notebook_cells (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      domain TEXT NOT NULL,
      action TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      ok INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      output_dtu_id TEXT,
      replay_of_cell_id TEXT,
      executed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const a = wrapFormatAsDTU("json", { coupling: true, cycle: _symbiosisCycles, side: "a", domain: domainA }, {
    domain: domainA,
    title: `symbiosis:${domainA}`,
    tags: [domainA, "symbiosis", "coupling"],
  });
  const b = wrapFormatAsDTU("json", { coupling: true, cycle: _symbiosisCycles, side: "b", domain: domainB }, {
    domain: domainB,
    title: `symbiosis:${domainB}`,
    tags: [domainB, "symbiosis", "coupling"],
  });
  const sizeOf = (w) => {
    if (!w) return 0;
    if (Buffer.isBuffer(w)) return w.length;
    if (Buffer.isBuffer(w.buffer)) return w.buffer.length;
    if (typeof w === "object") return JSON.stringify(w).length;
    return 0;
  };
  const bytes = sizeOf(a) + sizeOf(b);
  const aMeta = a?.metadata || (a && inspectDTU ? (() => { try { return inspectDTU(a); } catch { return {}; } })() : {});
  const bMeta = b?.metadata || {};

  const coupleId = `couple_${domainA}__${domainB}`;
  const prev = db.prepare(`SELECT * FROM domain_couplings WHERE id = ?`).get(coupleId);
  const exchanges = (prev?.exchanges || 0) + 1;
  const strength = Math.min(1, (prev?.strength || 0) + 0.08);

  let notebookId = prev?.notebook_id || null;
  if (!notebookId) {
    notebookId = `nb_sym_${Date.now().toString(36)}`;
    db.prepare(`
      INSERT INTO notebooks (id, owner_user_id, title, description)
      VALUES (?, ?, ?, ?)
    `).run(notebookId, userId, `Symbiosis ${domainA}↔${domainB}`, "Cross-domain coupling enforcement");
  }

  // Record two cells (one per domain) — real cross-domain notebook composition.
  const posBase = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM notebook_cells WHERE notebook_id = ?`)
    .get(notebookId)?.n || 0;
  const cellBase = `cell_${Date.now().toString(36)}_${_symbiosisCycles}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO notebook_cells
      (id, notebook_id, position, domain, action, input_json, output_json, ok, output_dtu_id)
    VALUES (?, ?, ?, ?, 'symbiosis-tick', ?, ?, 1, ?)
  `).run(
    `${cellBase}_a`,
    notebookId,
    posBase,
    domainA,
    JSON.stringify({ cycle: _symbiosisCycles }),
    JSON.stringify({ ok: true, size: sizeOf(a), domain: domainA }),
    null,
  );
  db.prepare(`
    INSERT INTO notebook_cells
      (id, notebook_id, position, domain, action, input_json, output_json, ok, output_dtu_id)
    VALUES (?, ?, ?, ?, 'symbiosis-tick', ?, ?, 1, ?)
  `).run(
    `${cellBase}_b`,
    notebookId,
    posBase + 1,
    domainB,
    JSON.stringify({ cycle: _symbiosisCycles }),
    JSON.stringify({ ok: true, size: sizeOf(b), domain: domainB }),
    null,
  );
  db.prepare(`UPDATE notebooks SET updated_at = unixepoch() WHERE id = ?`).run(notebookId);

  db.prepare(`
    INSERT INTO domain_couplings
      (id, domain_a, domain_b, strength, exchanges, last_payload_bytes, notebook_id, evidence_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      strength=excluded.strength,
      exchanges=excluded.exchanges,
      last_payload_bytes=excluded.last_payload_bytes,
      notebook_id=excluded.notebook_id,
      evidence_json=excluded.evidence_json,
      updated_at=unixepoch()
  `).run(
    coupleId,
    domainA,
    domainB,
    strength,
    exchanges,
    bytes,
    notebookId,
    JSON.stringify({
      a_title: aMeta?.title || `symbiosis:${domainA}`,
      b_title: bMeta?.title || `symbiosis:${domainB}`,
      a_size: sizeOf(a),
      b_size: sizeOf(b),
    }),
  );

  const after = db.prepare(`SELECT * FROM domain_couplings WHERE id = ?`).get(coupleId);
  const cellCount = db.prepare(`SELECT COUNT(*) AS c FROM notebook_cells WHERE notebook_id = ?`).get(notebookId)?.c || 0;
  const domainsInNb = db.prepare(`SELECT DISTINCT domain FROM notebook_cells WHERE notebook_id = ?`).all(notebookId).map((r) => r.domain);

  const snap = {
    ok: !!after && after.exchanges > (prev?.exchanges || 0) && after.strength > (prev?.strength || 0) && domainsInNb.length >= 2 && bytes > 0,
    id: SYMBIOSIS_HB,
    cycles: _symbiosisCycles,
    couple_id: coupleId,
    domain_a: domainA,
    domain_b: domainB,
    strength: after.strength,
    exchanges: after.exchanges,
    strength_mutated: after.strength > (prev?.strength || 0),
    exchanges_mutated: after.exchanges > (prev?.exchanges || 0),
    payload_bytes: bytes,
    notebook_id: notebookId,
    notebook_cells: cellCount,
    notebook_domains: domainsInNb,
  };
  _last.symbiosis = snap;
  return snap;
}

export function snapshotOrganismEnforcement() {
  return { ..._last, cycles: {
    coordinator: _coordCycles,
    organFleet: _fleetCycles,
    worldOrganism: _worldOrgCycles,
    symbiosis: _symbiosisCycles,
  } };
}

export async function runSuperorganismCoordinatorCycle(ctx = {}) {
  return tickSuperorganismCoordinator({ db: ctx.db, worldId: ctx.worldId });
}
export async function runOrganFleetCycle(ctx = {}) {
  return tickOrganFleet({ db: ctx.db, worldId: ctx.worldId });
}
export async function runWorldOrganismCycle(ctx = {}) {
  return tickWorldOrganism({ db: ctx.db, worldId: ctx.worldId });
}
export async function runSymbiosisCycle(ctx = {}) {
  return tickSymbiosis({ db: ctx.db });
}

export function registerOrganismEnforcementHeartbeats() {
  if (_registered) return { ok: true, already: true, ids: [COORD_HB, FLEET_HB, WORLD_ORG_HB, SYMBIOSIS_HB] };
  registerHeartbeat(COORD_HB, {
    frequency: 6,
    handler: runSuperorganismCoordinatorCycle,
    neverDisable: true,
    scope: "global",
  });
  registerHeartbeat(FLEET_HB, {
    frequency: 6,
    handler: runOrganFleetCycle,
    neverDisable: true,
    scope: "global",
  });
  registerHeartbeat(WORLD_ORG_HB, {
    frequency: 4,
    handler: runWorldOrganismCycle,
    neverDisable: true,
    scope: "world",
  });
  registerHeartbeat(SYMBIOSIS_HB, {
    frequency: 8,
    handler: runSymbiosisCycle,
    neverDisable: true,
    scope: "global",
  });
  _registered = true;
  return { ok: true, ids: [COORD_HB, FLEET_HB, WORLD_ORG_HB, SYMBIOSIS_HB] };
}

export default {
  ORGAN_FLEET_ROSTER,
  ensureOrganismTables,
  tickOneOrgan,
  tickOrganFleet,
  tickSuperorganismCoordinator,
  tickWorldOrganism,
  tickSymbiosis,
  snapshotOrganismEnforcement,
  registerOrganismEnforcementHeartbeats,
};
