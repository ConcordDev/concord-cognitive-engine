// server/tests/whiteboard-cite-dtu.test.js
//
// Tier-2 contract test for Whiteboard Sprint C Item #19 — cross-lens
// DTU embed on canvas + cascade citation.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerWhiteboardCiteDtuMacros from "../domains/whiteboard-cite-dtu.js";
import { upsertBoard, inviteParticipant, getBoard } from "../lib/whiteboard/persistence.js";

let db; let boardId; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
      creator_id TEXT, meta_json TEXT, skill_level INTEGER DEFAULT 1,
      total_experience INTEGER DEFAULT 0, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS royalty_lineage (
      id TEXT PRIMARY KEY, child_id TEXT NOT NULL, parent_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1, creator_id TEXT,
      parent_creator TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS user_consent (
      user_id TEXT NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER, PRIMARY KEY (user_id, key)
    );
  `);
  const mig = await import("../migrations/208_whiteboard_persistence.js");
  mig.up(db);
  registerWhiteboardCiteDtuMacros((_d, n, h) => macros.set(n, h));
  // Seed a citable DTU (chord progression from studio)
  db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at) VALUES (?, 'chord_progression', ?, ?, ?, unixepoch())`)
    .run("dtu:cp:test", "C-G-Am-F", "u_studio_author", JSON.stringify({ visibility: "public", consent: { allowCitations: true } }));
  const r = upsertBoard(db, { ownerId: "u_alice", title: "Board" });
  boardId = r.id;
  inviteParticipant(db, { boardId, userId: "u_view", role: "viewer" });
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("whiteboard-cite-dtu: embed_dtu", () => {
  it("rejects no auth", async () => {
    const r = await macros.get("embed_dtu")({ db }, { boardId, dtuId: "dtu:cp:test" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });

  it("rejects unknown DTU", async () => {
    const r = await macros.get("embed_dtu")({ db, actor: { userId: "u_alice" } }, { boardId, dtuId: "dtu:nope" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "dtu_not_found");
  });

  it("rejects viewer (editor+ required)", async () => {
    const r = await macros.get("embed_dtu")({ db, actor: { userId: "u_view" } }, { boardId, dtuId: "dtu:cp:test" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("owner embeds the DTU as a dtu_embed element + stashes pending citation", async () => {
    const r = await macros.get("embed_dtu")({ db, actor: { userId: "u_alice" } }, { boardId, dtuId: "dtu:cp:test", x: 100, y: 200 });
    assert.equal(r.ok, true);
    assert.equal(r.element.kind, "dtu_embed");
    assert.equal(r.element.dtuKind, "chord_progression");
    assert.equal(r.cascadeRegistered, false, "no published DTU yet → pending");
    assert.equal(r.pending, true);
    const board = getBoard(db, boardId);
    assert.ok(board.scene.elements.some((e) => e.kind === "dtu_embed"));
    assert.ok(Array.isArray(board.meta.pendingCitations));
    assert.equal(board.meta.pendingCitations[0].citedDtuId, "dtu:cp:test");
  });

  it("when the board is already published, cascade fires immediately", async () => {
    // Mark the board as published by minting a stub DTU and stamping meta.
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at) VALUES (?, 'whiteboard_board', ?, ?, ?, unixepoch())`)
      .run("whiteboard_board:pub1", "Pub", "u_alice", JSON.stringify({ visibility: "public" }));
    db.prepare(`UPDATE whiteboard_boards SET meta_json = ? WHERE id = ?`)
      .run(JSON.stringify({ publishedDtuId: "whiteboard_board:pub1" }), boardId);
    const r = await macros.get("embed_dtu")({ db, actor: { userId: "u_alice" } }, { boardId, dtuId: "dtu:cp:test" });
    assert.equal(r.ok, true);
    assert.equal(r.cascadeRegistered, true);
    const lin = db.prepare(`SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?`).get("whiteboard_board:pub1", "dtu:cp:test");
    assert.ok(lin, "lineage row should exist after immediate cascade");
  });
});

describe("whiteboard-cite-dtu: list_embedded_dtus", () => {
  it("lists embedded DTUs on the board", async () => {
    const r = await macros.get("list_embedded_dtus")({ db, actor: { userId: "u_view" } }, { boardId });
    assert.equal(r.ok, true);
    assert.ok(r.count >= 1);
    assert.equal(r.embedded[0].kind, "dtu_embed");
  });

  it("non-participant is forbidden", async () => {
    const r = await macros.get("list_embedded_dtus")({ db, actor: { userId: "u_outsider" } }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
});
