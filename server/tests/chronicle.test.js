/**
 * Living Society — Phase 7: The Chronicle.
 *
 *   - composers are deterministic, never invent, never leak secrets (canary);
 *   - weave ingestion is idempotent via the cursor + dedupe_key;
 *   - realmHealth is a DERIVED labor-symptom surface (not a rebellion bar);
 *   - mintSaga writes a kind='chronicle' DTU citing the beats.
 *
 * Run: node --test tests/chronicle.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up286 } from "../migrations/286_chronicle.js";
import { composeEntry, scrubSecrets, CHRONICLE_KINDS } from "../lib/chronicle/compose.js";
import { recordEntry, weaveWorld, realmHealth, listEntries, mintSaga } from "../lib/chronicle/chronicle.js";

const W = "w1";
function mkDb() {
  const db = new Database(":memory:");
  up286(db);
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE movement_uprisings (movement_id TEXT PRIMARY KEY, world_id TEXT, target_kind TEXT, target_id TEXT, member_count INTEGER, strategy_log_id TEXT, world_event_id TEXT, erupted_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE movements (id TEXT PRIMARY KEY, world_id TEXT, target_id TEXT, status TEXT, updated_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE movement_members (movement_id TEXT, member_kind TEXT, member_id TEXT, left_at INTEGER, PRIMARY KEY (movement_id, member_kind, member_id));
    CREATE TABLE world_events (id TEXT PRIMARY KEY, world_id TEXT, event_type TEXT, title TEXT, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE claim_crops (claim_id TEXT, tile_x INTEGER, tile_y INTEGER, growth_stage INTEGER, watered_at INTEGER, PRIMARY KEY (claim_id, tile_x, tile_y));
    CREATE TABLE world_resource_nodes (id TEXT PRIMARY KEY, world_id TEXT, is_depleted INTEGER DEFAULT 0);
    CREATE TABLE npc_grudges (id TEXT PRIMARY KEY, npc_id TEXT, target_kind TEXT, target_id TEXT, severity INTEGER, resolved_at INTEGER);
    CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT, visibility TEXT, created_at INTEGER);
  `);
  return db;
}

describe("Phase 7 — composers", () => {
  it("are deterministic + grounded in the payload", () => {
    const a = composeEntry("uprising", { id: "m1", target_id: "voss", members: 5 });
    const b = composeEntry("uprising", { id: "m1", target_id: "voss", members: 5 });
    assert.deepEqual(a, b);
    assert.match(a.body, /voss/);
    assert.match(a.body, /5/);
  });

  it("scrub + canary block secret leakage", () => {
    const scrubbed = scrubSecrets({ target_id: "voss", secret_body: "the heir is illegitimate", narrative_context: { secret: "x" } });
    assert.ok(!("secret_body" in scrubbed));
    assert.ok(!("narrative_context" in scrubbed));
    // even if a secret string is jammed into a visible field, the body never echoes a "secret:" marker
    const e = composeEntry("decree", { id: "d1", kind: "tax", issued_by_id: "lord" });
    assert.ok(!/secret:/i.test(e.body));
  });

  it("covers all declared kinds", () => {
    for (const k of CHRONICLE_KINDS) assert.ok(composeEntry(k, { id: "x", target_id: "t" }).ok);
  });
});

describe("Phase 7 — weave ingestion", () => {
  it("ingests an uprising once (idempotent via cursor + dedupe)", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('n', ?)`).run(W);
    db.prepare(`INSERT INTO movement_uprisings (movement_id, world_id, target_kind, target_id, member_count, erupted_at) VALUES ('m1', ?, 'faction', 'voss', 4, 1000)`).run(W);
    const r1 = weaveWorld(db, W);
    assert.equal(r1.written, 1);
    const r2 = weaveWorld(db, W); // cursor advanced → no re-ingest
    assert.equal(r2.written, 0);
    assert.equal(listEntries(db, W).length, 1);
  });

  it("recordEntry is idempotent on dedupe_key", () => {
    const db = mkDb();
    assert.equal(recordEntry(db, W, "fields_untended", { id: "f1", count: 3 }).inserted, true);
    assert.equal(recordEntry(db, W, "fields_untended", { id: "f1", count: 3 }).inserted, false);
  });
});

describe("Phase 7 — realm health (symptoms, not a bar)", () => {
  it("derives fields-untended %, depleted nodes, movements, grievance", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('n', ?)`).run(W);
    // 2 crops, 1 untended (unwatered + unripe)
    db.prepare(`INSERT INTO claim_crops (claim_id, tile_x, tile_y, growth_stage, watered_at) VALUES ('c', 0, 0, 1, 0)`).run();
    db.prepare(`INSERT INTO claim_crops (claim_id, tile_x, tile_y, growth_stage, watered_at) VALUES ('c', 1, 0, 3, unixepoch())`).run();
    db.prepare(`INSERT INTO world_resource_nodes (id, world_id, is_depleted) VALUES ('o', ?, 1)`).run(W);
    db.prepare(`INSERT INTO movements (id, world_id, target_id, status) VALUES ('m', ?, 'voss', 'recruiting')`).run(W);
    db.prepare(`INSERT INTO npc_grudges (id, npc_id, target_kind, target_id, severity) VALUES ('g', 'n', 'faction', 'voss', 7)`).run();
    const h = realmHealth(db, W);
    assert.equal(h.fieldsUntendedPct, 50);
    assert.equal(h.depletedNodes, 1);
    assert.equal(h.activeMovements, 1);
    assert.equal(h.openGrievance, 7);
  });
});

describe("Phase 7 — saga mint", () => {
  it("mints a kind='chronicle' DTU from the beats", () => {
    const db = mkDb();
    recordEntry(db, W, "uprising", { id: "m1", target_id: "voss", members: 4 });
    const r = mintSaga(db, { worldId: W, userId: "u1", title: "My Saga" });
    assert.equal(r.ok, true);
    assert.equal(r.citedEntries, 1);
    const dtu = db.prepare(`SELECT type, creator_id FROM dtus WHERE id=?`).get(r.dtuId);
    assert.equal(dtu.type, "chronicle");
    assert.equal(dtu.creator_id, "u1");
  });
});
