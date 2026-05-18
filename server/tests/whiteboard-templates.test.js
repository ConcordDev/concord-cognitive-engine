// server/tests/whiteboard-templates.test.js
//
// Tier-2 contract test for Whiteboard Sprint C Item #14 — template
// marketplace. Real migration 208 + DTU mint + royalty cascade.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerWhiteboardTemplateMacros from "../domains/whiteboard-templates.js";
import { upsertBoard, inviteParticipant } from "../lib/whiteboard/persistence.js";

let db; let templateAuthorBoardId; const macros = new Map();

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
  registerWhiteboardTemplateMacros((_d, n, h) => macros.set(n, h));
  const r = upsertBoard(db, {
    ownerId: "u_author", title: "Brainstorm starter",
    scene: { elements: [
      { id: "f1", kind: "frame", x: 0, y: 0, w: 400, h: 600, text: "Ideas" },
      { id: "f2", kind: "frame", x: 400, y: 0, w: 400, h: 600, text: "Themes" },
    ] },
  });
  templateAuthorBoardId = r.id;
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("whiteboard-templates: mint", () => {
  it("rejects no-auth", async () => {
    const r = await macros.get("mint_template")({ db }, { boardId: templateAuthorBoardId, title: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });

  it("rejects non-owner mint", async () => {
    const r = await macros.get("mint_template")({ db, actor: { userId: "u_outsider" } }, {
      boardId: templateAuthorBoardId, title: "x",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("owner mints a kind='whiteboard_template' DTU", async () => {
    const r = await macros.get("mint_template")({ db, actor: { userId: "u_author" } }, {
      boardId: templateAuthorBoardId, title: "Brainstorm starter",
      description: "Two frames for ideas + themes.",
      tags: ["brainstorm", "intro"], priceCents: 100, license: "CC-BY-SA",
    });
    assert.equal(r.ok, true);
    assert.ok(r.templateDtuId.startsWith("whiteboard_template:"));
    const row = db.prepare("SELECT kind, meta_json FROM dtus WHERE id = ?").get(r.templateDtuId);
    assert.equal(row.kind, "whiteboard_template");
    const meta = JSON.parse(row.meta_json);
    assert.equal(meta.visibility, "public");
    assert.equal(meta.consent.allowCitations, true);
    assert.ok(meta.svg_preview.startsWith('<?xml'));
  });
});

describe("whiteboard-templates: list_marketplace", () => {
  it("lists minted templates", async () => {
    const r = await macros.get("list_marketplace")({ db }, {});
    assert.equal(r.ok, true);
    assert.ok(r.templates.length >= 1);
    assert.equal(r.templates[0].svg_preview.startsWith('<?xml'), true);
  });

  it("filters by title query", async () => {
    const r = await macros.get("list_marketplace")({ db }, { q: "brainstorm" });
    assert.equal(r.ok, true);
    assert.ok(r.templates.length >= 1);
  });

  it("returns no matches for a no-hit query", async () => {
    const r = await macros.get("list_marketplace")({ db }, { q: "no-such-thing-xyz" });
    assert.equal(r.templates.length, 0);
  });
});

describe("whiteboard-templates: use_template + cite_template", () => {
  let templateDtuId;
  before(async () => {
    const list = await macros.get("list_marketplace")({ db }, {});
    templateDtuId = list.templates[0].id;
  });

  it("use_template clones into a new board for the caller + cites the template", async () => {
    const r = await macros.get("use_template")({ db, actor: { userId: "u_user" } }, {
      templateDtuId, newTitle: "My copy",
    });
    assert.equal(r.ok, true);
    assert.ok(r.newBoardId);
    assert.equal(r.citedTemplateDtuId, templateDtuId);
    // Lineage row should now exist (parent template author = u_author).
    const lin = db.prepare(`SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?`).get(r.newBoardId, templateDtuId);
    assert.ok(lin, "royalty_lineage row should exist after use_template");
  });

  it("cite_template fails when the board hasn't been published as a DTU yet", async () => {
    const newBoard = upsertBoard(db, { ownerId: "u_user", title: "Unpublished" });
    inviteParticipant(db, { boardId: newBoard.id, userId: "u_user", role: "owner" });
    const r = await macros.get("cite_template")({ db, actor: { userId: "u_user" } }, {
      boardId: newBoard.id, templateDtuId,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "board_not_published_yet");
  });
});
