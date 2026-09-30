// server/lib/runtime/supervisor.js
//
// P4 — Runtime supervisor. Aggregates subsystem health into RUNNING/DEGRADED/FAILED.

import { countActiveMissions, runtimeOverview } from "../mission-runtime.js";
import { fabricOverview } from "../parallel-agent-fabric.js";
import { memoryGraphOverview } from "./memory-graph.js";
import { listDomainPacks } from "./domain-packs.js";
import { bridgeOverview } from "../mission-marathon-bridge.js";
import { repoGraphOverview } from "./repo-graph.js";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function tablesReady(db) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_supervisor_snapshots'`).get();
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 * @param {object} opts.db
 * @param {Function} [opts.dispatchMCP]
 */
export async function collectSupervisorStatus({ db, dispatchMCP } = {}) {
  const subsystems = {};

  // Mission runtime
  const missionOv = runtimeOverview(db);
  subsystems.mission_runtime = {
    status: missionOv.ok ? (missionOv.killSwitch ? "DISABLED" : "HEALTHY") : "DEGRADED",
    active: missionOv.active,
    byStatus: missionOv.byStatus,
  };

  // Parallel fabric
  const fabric = fabricOverview(db);
  subsystems.parallel_fabric = {
    status: fabric.ok ? "HEALTHY" : "DEGRADED",
    workersByStatus: fabric.workersByStatus,
    concurrency: fabric.concurrency,
  };

  // Memory graph
  const mem = memoryGraphOverview(db);
  subsystems.memory_graph = {
    status: mem.ok ? "HEALTHY" : "DEGRADED",
    nodesByClass: mem.nodesByClass,
    edgeCount: mem.edgeCount,
  };

  // Event bus (always in-process)
  subsystems.event_bus = { status: "HEALTHY" };

  // Domain packs
  subsystems.domain_packs = {
    status: "HEALTHY",
    count: listDomainPacks().length,
  };

  // Dila workers (best-effort)
  try {
    const { getWorkerRoster } = await import("../dila-workers.js");
    const roster = await getWorkerRoster();
    const alive = roster.filter((w) => w.alive).length;
    subsystems.dila_workers = {
      status: alive > 0 ? "HEALTHY" : "DEGRADED",
      total: roster.length,
      alive,
    };
  } catch {
    subsystems.dila_workers = { status: "UNKNOWN" };
  }

  // Organ fleet (best-effort via MCP)
  if (typeof dispatchMCP === "function") {
    try {
      const r = await dispatchMCP("concordia_verify", {}, {
        actor: { id: "system", role: "system" },
        db,
        trace_id: `sup_${nowSec()}`,
      });
      const verdict = r?.result?.observation?.verdict || r?.result?.verdict;
      subsystems.organ_fleet = {
        status: verdict === "GREEN" ? "HEALTHY" : verdict === "AMBER" ? "DEGRADED" : verdict === "RED" ? "FAILED" : "UNKNOWN",
        verdict,
      };
    } catch {
      subsystems.organ_fleet = { status: "UNKNOWN" };
    }
  } else {
    subsystems.organ_fleet = { status: "UNKNOWN" };
  }

  // Predict (table presence)
  try {
    const row = db?.prepare(`SELECT COUNT(*) AS c FROM prediction_tickets`).get();
    subsystems.predict = { status: "HEALTHY", tickets: row?.c || 0 };
  } catch {
    subsystems.predict = { status: "UNKNOWN", tickets: 0 };
  }

  // Sister-system constellation (Dila / Zuko / Pentester / Trading / Concordia).
  // ABSENT homes (no ~/.zuko on CI) must not flip overall to DEGRADED.
  try {
    const { collectConstellationHealth } = await import("./constellation.js");
    const constellation = await collectConstellationHealth({ probeLab: false });
    subsystems.constellation = {
      status: constellation.overall === "FAILED" ? "FAILED" : "HEALTHY",
      overall: constellation.overall,
      domains: Object.fromEntries(
        Object.entries(constellation.domains || {}).map(([k, v]) => [k, { status: v.status, present: v.present, executeLocked: v.executeLocked }]),
      ),
    };
    for (const [name, domain] of Object.entries(constellation.domains || {})) {
      if (domain.status === "ABSENT") continue;
      subsystems[name] = {
        status: domain.status,
        present: domain.present,
        executeLocked: domain.executeLocked === true,
      };
    }
  } catch {
    subsystems.constellation = { status: "UNKNOWN" };
  }

  // Auth gate mode
  const authMode = process.env.CONCORD_AUTH_GATE_MODE || "observe";
  const enforceAutonomous = process.env.CONCORD_AUTH_GATE_ENFORCE_AUTONOMOUS === "true";
  subsystems.auth_gate = {
    status: authMode === "enforce" || enforceAutonomous ? "ENFORCING" : "OBSERVE",
    mode: authMode,
    enforceAutonomous,
  };

  // Marathon bridge
  const bridge = bridgeOverview(db);
  subsystems.marathon_bridge = {
    status: bridge.ok ? "HEALTHY" : "DEGRADED",
    totalLinks: bridge.totalLinks || 0,
    activeMarathons: bridge.activeMarathons || 0,
  };

  // Repo graph / coding intelligence
  const repo = repoGraphOverview(db);
  subsystems.coding_intelligence = {
    status: repo.ok && repo.files > 0 ? "HEALTHY" : repo.ok ? "DEGRADED" : "UNKNOWN",
    filesIndexed: repo.files || 0,
    exports: repo.exports || 0,
  };

  // Runtime tier counters
  try {
    const tier = db?.prepare(`SELECT * FROM runtime_tier_state WHERE id = 1`).get();
    subsystems.runtime_tier = {
      status: "HEALTHY",
      codingLoopsRun: tier?.coding_loops_run || 0,
      marathonsSpawned: tier?.marathons_spawned || 0,
      lastBenchmarkAt: tier?.last_benchmark_at || null,
    };
  } catch {
    subsystems.runtime_tier = { status: "UNKNOWN" };
  }

  // Marathon sessions (active count)
  try {
    const active = db?.prepare(`
      SELECT COUNT(*) AS c FROM agent_marathon_sessions WHERE status IN ('pending', 'running')
    `).get()?.c || 0;
    subsystems.marathon_runtime = {
      status: "HEALTHY",
      active,
    };
  } catch {
    subsystems.marathon_runtime = { status: "UNKNOWN" };
  }

  const statuses = Object.values(subsystems).map((s) => s.status);
  let overall = "RUNNING";
  if (statuses.includes("FAILED")) overall = "FAILED";
  else if (statuses.includes("DEGRADED") || statuses.includes("UNKNOWN")) overall = "DEGRADED";
  if (missionOv.killSwitch) overall = "DISABLED";

  return { overall, subsystems, observedAt: nowSec(), activeMissions: countActiveMissions(db) };
}

export async function collectFullSupervisorStatus(opts = {}) {
  const flat = await collectSupervisorStatus(opts);
  let hierarchy = null;
  try {
    const { collectHierarchicalSupervisor } = await import("./supervisor-tree.js");
    hierarchy = await collectHierarchicalSupervisor({
      db: opts.db,
      dispatchMCP: opts.dispatchMCP,
      flatStatus: flat,
    });
  } catch { /* optional */ }
  return { ...flat, hierarchy };
}

export async function snapshotSupervisor({ db, dispatchMCP } = {}) {
  const status = await collectSupervisorStatus({ db, dispatchMCP });
  if (!db || !tablesReady(db)) return { ok: true, ...status, persisted: false };

  const traceId = `sup_${nowSec()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    db.prepare(`
      INSERT INTO runtime_supervisor_snapshots (overall_status, subsystems_json, trace_id)
      VALUES (?, ?, ?)
    `).run(status.overall, JSON.stringify(status.subsystems), traceId);
    return { ok: true, ...status, traceId, persisted: true };
  } catch (e) {
    return { ok: true, ...status, persisted: false, error: e?.message };
  }
}

export function listSupervisorSnapshots(db, limit = 20) {
  if (!db || !tablesReady(db)) return [];
  try {
    return db.prepare(`
      SELECT id, observed_at, overall_status, trace_id
      FROM runtime_supervisor_snapshots
      ORDER BY observed_at DESC LIMIT ?
    `).all(Math.min(limit, 100));
  } catch {
    return [];
  }
}
