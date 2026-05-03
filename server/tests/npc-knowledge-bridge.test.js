// Tests for npc-knowledge-bridge.
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runNpcKnowledgeBridge, getKnowledgeForRole } from "../lib/npc-knowledge-bridge.js";

function makeFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      title TEXT,
      body_json TEXT,
      tags_json TEXT,
      visibility TEXT DEFAULT 'public',
      created_at TEXT
    );
    CREATE TABLE npc_knowledge (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      role TEXT NOT NULL,
      dtu_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      domain TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(world_id, role, dtu_id)
    );
  `);
  return db;
}

function insertDtu(db, { id, content, tags, visibility = "public", ts, worldId }) {
  db.prepare(`
    INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    "alice",
    content?.slice(0, 80) ?? "",
    JSON.stringify({ content, worldId }),
    JSON.stringify(tags),
    visibility,
    ts ?? new Date().toISOString(),
  );
}

describe("npc-knowledge-bridge", () => {
  let db, state;
  before(() => {
    db = makeFixture();
    state = {};
    insertDtu(db, { id: "d1", content: "New surgical technique", tags: ["medical", "surgery"], ts: "2026-01-01T00:00:00.000Z", worldId: "concordia-hub" });
    insertDtu(db, { id: "d2", content: "Bridge truss research", tags: ["engineering", "blueprint"], ts: "2026-01-02T00:00:00.000Z" });
    insertDtu(db, { id: "d3", content: "Private notes", tags: ["medical"], visibility: "private", ts: "2026-01-03T00:00:00.000Z" });
    insertDtu(db, { id: "d4", content: "Just a recipe", tags: ["timeline"], ts: "2026-01-04T00:00:00.000Z" });
    insertDtu(db, { id: "d5", content: "Cell biology", tags: ["research"], ts: "2026-01-05T00:00:00.000Z" });
  });

  test("mirrors medical DTUs into doctor knowledge", () => {
    const r = runNpcKnowledgeBridge({ state, db, tickCount: 10 });
    assert.equal(r.ok, true);
    const docs = getKnowledgeForRole(db, { worldId: "concordia-hub", role: "doctor" });
    assert.ok(docs.length > 0);
    assert.ok(docs.some((d) => d.dtu_id === "d1"));
  });

  test("mirrors engineering DTUs into engineer knowledge", () => {
    const eng = getKnowledgeForRole(db, { worldId: "concordia-hub", role: "engineer" });
    assert.ok(eng.some((d) => d.dtu_id === "d2"));
  });

  test("mirrors research DTUs into scholar knowledge", () => {
    const sch = getKnowledgeForRole(db, { worldId: "concordia-hub", role: "scholar" });
    assert.ok(sch.some((d) => d.dtu_id === "d5"));
  });

  test("excludes private DTUs", () => {
    const docs = getKnowledgeForRole(db, { worldId: "concordia-hub", role: "doctor" });
    assert.equal(docs.find((d) => d.dtu_id === "d3"), undefined);
  });

  test("ignores non-medical/engineering/research DTUs", () => {
    const docs = getKnowledgeForRole(db, { worldId: "concordia-hub", role: "doctor" });
    assert.equal(docs.find((d) => d.dtu_id === "d4"), undefined);
  });

  test("re-running is idempotent (UNIQUE constraint)", () => {
    const before = db.prepare("SELECT COUNT(*) AS c FROM npc_knowledge").get().c;
    state._npcKnowledgeBridgeCursor = "1970-01-01T00:00:00.000Z";
    const r = runNpcKnowledgeBridge({ state, db, tickCount: 20 });
    const after = db.prepare("SELECT COUNT(*) AS c FROM npc_knowledge").get().c;
    assert.equal(before, after);
    assert.equal(r.ok, true);
  });
});
