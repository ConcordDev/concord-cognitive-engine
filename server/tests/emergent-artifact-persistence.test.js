// Restart-persistence for createAttributedArtifact → dtus body + lineage.
//
// Pins the fix that emergent artifacts must land in `dtus` (not only as an
// emergent_observations marker) so MCP dtu_get / dtu_search can recover the
// human-readable body. Uses a file-backed migrated DB and a second handle
// to prove durability across reopen.
//
// Run:
//   NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs \
//     --test-timeout=300000 tests/emergent-artifact-persistence.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createAttributedArtifact } from "../emergent/artifacts.js";

/** Same column list as MCP dtu_get in server/lib/mcp-tools.js. */
const DTU_GET_COLS =
  "SELECT id, title, tier, type, status, content, body_json, tags_json, visibility, creator_id, created_at, updated_at FROM dtus WHERE id = ? LIMIT 1";

let db;
let dbFile;

beforeEach(async () => {
  dbFile = path.join(
    os.tmpdir(),
    `emergent-artifact-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  db = new Database(dbFile);
  await runMigrations(db);
});

afterEach(() => {
  try { db.close(); } catch { /* noop */ }
  try { fs.unlinkSync(dbFile); } catch { /* noop */ }
  try { fs.unlinkSync(dbFile + "-wal"); } catch { /* noop */ }
  try { fs.unlinkSync(dbFile + "-shm"); } catch { /* noop */ }
});

describe("createAttributedArtifact — dtus persistence", () => {
  it("persists body + lineage into dtus readable via the dtu_get column set", () => {
    const marker = `EMERGENT_BODY_MARKER_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const emergent = { id: "emergent_aria_test", given_name: "Aria", dominantLens: "research" };
    const task = {
      id: "task_synth_1",
      task_type: "synthesis",
      task_data: { lens: "research", sourceDTUs: ["dtu_parent_a", "dtu_parent_b"] },
    };
    const result = {
      finalText: marker,
      brainUsed: "subconscious",
      tokensIn: 10,
      tokensOut: 20,
      dtuContributors: [{ dtuId: "dtu_parent_c" }],
    };

    const artifact = createAttributedArtifact(emergent, task, result, db);
    assert.ok(artifact);
    assert.ok(artifact.id.startsWith("edtu_"));

    const row = db.prepare(DTU_GET_COLS).get(artifact.id);
    assert.ok(row, "dtus row must exist for the artifact id");
    assert.equal(row.content, marker, "human-readable body must be in content for dtu_search");
    assert.equal(row.tier, "shadow");
    assert.equal(row.visibility, "private");
    assert.equal(row.creator_id, emergent.id);
    assert.equal(row.type, "synthesis_dtu");
    assert.equal(row.title, artifact.title);

    const body = JSON.parse(row.body_json);
    assert.deepEqual(body.lineage.sort(), ["dtu_parent_a", "dtu_parent_b", "dtu_parent_c"].sort());
    assert.equal(body.created_by_type, "emergent");
    assert.equal(body.creator_emergent_id, emergent.id);
    assert.equal(body.body, marker);

    // Observation marker still written (feed / listEmergentArtifacts).
    const obs = db.prepare(
      "SELECT observation FROM emergent_observations WHERE id = ?"
    ).get(artifact.id);
    assert.ok(obs?.observation?.startsWith("[artifact:synthesis_dtu]"));
  });

  it("survives a fresh DB connection to the same file (restart-equivalence)", () => {
    const marker = `REOPEN_MARKER_${Date.now()}`;
    const emergent = { id: "emergent_reopen", given_name: "Nova", dominantLens: "general" };
    const task = { id: "task_reopen", task_type: "governance", task_data: { sourceDTUs: ["dtu_x"] } };
    const result = { finalText: marker, brainUsed: "conscious" };

    const artifact = createAttributedArtifact(emergent, task, result, db);
    assert.ok(artifact?.id);
    db.close();

    const db2 = new Database(dbFile, { readonly: true });
    try {
      const row = db2.prepare(DTU_GET_COLS).get(artifact.id);
      assert.ok(row, "row must be visible from a second independent handle");
      assert.equal(row.content, marker);
      const body = JSON.parse(row.body_json);
      assert.deepEqual(body.lineage, ["dtu_x"]);
      assert.equal(row.creator_id, emergent.id);
      assert.equal(row.tier, "shadow");
    } finally {
      db2.close();
    }

    // Re-open writable handle so afterEach can close/cleanup cleanly.
    db = new Database(dbFile);
  });

  it("is idempotent for the same artifact id (INSERT OR IGNORE)", () => {
    const marker = `IDEM_MARKER_${Date.now()}`;
    const emergent = { id: "emergent_idem", given_name: "Idem", dominantLens: "general" };
    const task = { id: "task_idem", task_type: "synthesis", task_data: {} };
    const artifact = createAttributedArtifact(emergent, task, { finalText: marker }, db);
    assert.ok(artifact?.id);

    // Simulate a retry of the same id — must not throw or duplicate.
    assert.doesNotThrow(() => {
      db.prepare(`
        INSERT OR IGNORE INTO dtus
          (id, owner_user_id, title, body_json, tags_json, visibility, tier,
           type, creator_id, content, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        artifact.id,
        null,
        artifact.title,
        JSON.stringify({ lineage: [], body: marker }),
        "[]",
        "private",
        "shadow",
        artifact.type,
        emergent.id,
        marker,
        "active",
        new Date().toISOString(),
        new Date().toISOString()
      );
    });

    const count = db.prepare("SELECT COUNT(*) AS c FROM dtus WHERE id = ?").get(artifact.id).c;
    assert.equal(count, 1);
  });
});
