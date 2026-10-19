// server/tests/inc-100-mission-runtime-stall.test.js
//
// Regression test for INC-100: the mission-runtime-cycle heartbeat was stalling
// the event loop for 4–7 s every ~2 minutes because ensureRepoIndexFresh()
// defaulted to process.cwd() (server/) while the indexer persisted rows under
// the workspace root, forcing a full re-index every cycle.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../migrations/423_mission_runtime.js";
import { up as upRuntimePhases } from "../migrations/424_runtime_phases.js";
import { up as upDilaRuntimeV1 } from "../migrations/426_dila_runtime_v1.js";
import { up as upDilaRuntimeV2 } from "../migrations/427_dila_runtime_v2.js";
import { up as upInc100Index } from "../migrations/478_inc100_repo_graph_index.js";

function setupDb() {
  const db = new Database(":memory:");
  upMission(db);
  upRuntimePhases(db);
  upDilaRuntimeV1(db);
  upDilaRuntimeV2(db);
  upInc100Index(db);

  // Minimal mission_runtime_state row so spawnAutonomousMissions can update
  // the fleet counter without failing.
  try {
    db.prepare(`
      INSERT INTO mission_runtime_state (id, fleet_cycle_counter, created_at, updated_at)
      VALUES (1, 0, unixepoch(), unixepoch())
    `).run();
  } catch { /* may already exist depending on migration */ }

  return db;
}

function seedRepoGraph(db, repoRoot, count = 20000) {
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(`
    INSERT INTO runtime_repo_symbols
      (repo_root, file_path, symbol_kind, symbol_name, line_number, imports_json, indexed_at)
    VALUES (?, ?, 'file', ?, 0, '[]', ?)
  `);
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      insert.run(repoRoot, `src/file_${i}.js`, `symbol_${i}`, now);
    }
  })();

  db.prepare(`
    INSERT INTO runtime_repo_meta (repo_root, last_full_index_at, files_count, edges_count, graphs_json)
    VALUES (?, ?, ?, 0, '{}')
    ON CONFLICT(repo_root) DO UPDATE SET
      last_full_index_at = excluded.last_full_index_at,
      files_count = excluded.files_count
  `).run(repoRoot, now, count);
}

// The test harness runs from server/, matching production. Reset state that
// would otherwise cause the cycle to do real work.
beforeEach(() => {
  process.env.CONCORD_REPO_GRAPH_MAX_FILES = "50";
  process.env.CONCORD_SELF_IMPROVE_AUTO = "0";
  process.env.CONCORD_MISSION_MAX_CONCURRENT = "0";
});

describe("INC-100 — mission-runtime-cycle repo-index stall", () => {
  it("ensureRepoIndexFresh skips re-index when repo rows are fresh", async () => {
    const { defaultRepoRoot, ensureRepoIndexFresh } = await import("../lib/runtime/repo-graph.js");
    const db = setupDb();
    const repoRoot = defaultRepoRoot();
    seedRepoGraph(db, repoRoot, 20000);

    // First call from the heartbeat (no repoRoot) should find the fresh index
    // and skip the expensive file walk.
    const r1 = await ensureRepoIndexFresh(db);
    assert.equal(r1.ok, true);
    assert.equal(r1.refreshed, false, "expected a fresh repo to skip re-index");
    assert.ok((r1.files ?? 0) > 0, "freshness check should see existing files");

    const start = performance.now();
    const r2 = await ensureRepoIndexFresh(db);
    const ms = performance.now() - start;
    assert.equal(r2.refreshed, false);
    assert.ok(ms < 150, `freshness check took ${Math.round(ms)}ms; should be near-instant`);
  });

  it("heartbeat cycle does not refresh the repo graph on a fresh index", async () => {
    const { defaultRepoRoot, ensureRepoIndexFresh } = await import("../lib/runtime/repo-graph.js");
    const db = setupDb();
    const repoRoot = defaultRepoRoot();
    seedRepoGraph(db, repoRoot, 20000);

    // Prime the cache so the cycle only measures the skip path.
    await ensureRepoIndexFresh(db);

    // Import the heartbeat handler fresh after setting MAX_CONCURRENT=0 so
    // spawnAutonomousMissions returns before invoking any MCP tools.
    const { runMissionRuntimeCycle } = await import("../emergent/mission-runtime-cycle.js");

    // Warm up module imports / first-use side effects on a throwaway cycle.
    await runMissionRuntimeCycle({ db });

    const start = performance.now();
    const result = await runMissionRuntimeCycle({ db });
    const ms = performance.now() - start;

    assert.equal(result.ok, true, result.reason || "heartbeat failed");
    assert.equal(result.repoGraph?.refreshed, false, "heartbeat must not re-index an unchanged repo");
    assert.ok(ms < 500, `mission-runtime-cycle took ${Math.round(ms)}ms; expected < 500ms`);
  });
});
