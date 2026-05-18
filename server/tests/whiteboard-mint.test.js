// server/tests/whiteboard-mint.test.js
//
// Tier-2 contract tests for Whiteboard Sprint A #7 — DTU export.
// Real migration 208 + real SVG render + real DTU mint.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerWhiteboardMintMacros, { renderSceneToSvg } from "../domains/whiteboard-mint.js";
import { upsertBoard } from "../lib/whiteboard/persistence.js";

let db; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE IF NOT EXISTS dtus (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
    creator_id TEXT, meta_json TEXT, skill_level INTEGER DEFAULT 1,
    total_experience INTEGER DEFAULT 0, created_at INTEGER
  )`);
  const mig = await import("../migrations/208_whiteboard_persistence.js");
  mig.up(db);
  registerWhiteboardMintMacros((_d, n, h) => macros.set(n, h));
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("whiteboard-mint: renderSceneToSvg", () => {
  it("empty scene renders a placeholder", () => {
    const svg = renderSceneToSvg({ elements: [] });
    assert.ok(svg.includes("Empty board"));
    assert.ok(svg.includes("<svg"));
  });

  it("rectangle + text are rendered as <rect> + <text>", () => {
    const svg = renderSceneToSvg({ elements: [
      { kind: "rectangle", x: 10, y: 20, w: 100, h: 50, text: "Hello" },
    ] });
    assert.ok(svg.includes('<rect'));
    assert.ok(svg.includes('Hello'));
  });

  it("ellipse renders as <ellipse> centered correctly", () => {
    const svg = renderSceneToSvg({ elements: [{ kind: "ellipse", x: 0, y: 0, w: 100, h: 80 }] });
    assert.ok(svg.includes('<ellipse cx="50" cy="40"'));
  });

  it("arrow includes a head polygon", () => {
    const svg = renderSceneToSvg({ elements: [{ kind: "arrow", x: 0, y: 0, x2: 100, y2: 50 }] });
    assert.ok(svg.includes("<line"));
    assert.ok(svg.includes("<polygon"));
  });

  it("freehand renders as <path>", () => {
    const svg = renderSceneToSvg({ elements: [{
      kind: "freehand", x: 0, y: 0, w: 0, h: 0,
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 5 }],
    }] });
    assert.ok(svg.includes("<path"));
  });

  it("escapes XML in text content", () => {
    const svg = renderSceneToSvg({ elements: [{ kind: "rectangle", x: 0, y: 0, w: 50, h: 50, text: "<script>x</script>" }] });
    assert.ok(!svg.includes("<script>"));
    assert.ok(svg.includes("&lt;script&gt;"));
  });
});

describe("whiteboard-mint: export_as_dtu", () => {
  let boardId;
  before(() => {
    const r = upsertBoard(db, { ownerId: "u_alice", title: "Mint me", scene: { elements: [{ kind: "rectangle", x: 0, y: 0, w: 100, h: 100, text: "hello" }] } });
    boardId = r.id;
  });

  it("rejects no-auth", async () => {
    const r = await macros.get("export_as_dtu")({ db }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });

  it("rejects missing boardId", async () => {
    const r = await macros.get("export_as_dtu")({ db, actor: { userId: "u_alice" } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "boardId_required");
  });

  it("rejects non-owner export", async () => {
    const r = await macros.get("export_as_dtu")({ db, actor: { userId: "u_bob" } }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("owner can export — mints kind='whiteboard_board' DTU with SVG preview", async () => {
    const r = await macros.get("export_as_dtu")({ db, actor: { userId: "u_alice" } }, {
      boardId, scope: "personal", license: "MIT",
    });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("whiteboard_board:"));
    const row = db.prepare("SELECT kind, meta_json FROM dtus WHERE id = ?").get(r.dtuId);
    assert.equal(row.kind, "whiteboard_board");
    const meta = JSON.parse(row.meta_json);
    assert.ok(meta.svg_preview.startsWith('<?xml'));
    assert.equal(meta.visibility, "personal");
  });

  it("public scope sets visibility=public + consent allowCitations=true", async () => {
    const r = await macros.get("export_as_dtu")({ db, actor: { userId: "u_alice" } }, {
      boardId, scope: "public", license: "CC-BY-SA",
    });
    assert.equal(r.ok, true);
    const meta = JSON.parse(db.prepare("SELECT meta_json FROM dtus WHERE id = ?").get(r.dtuId).meta_json);
    assert.equal(meta.visibility, "public");
    assert.equal(meta.consent.allowCitations, true);
    assert.equal(meta.license, "CC-BY-SA");
  });
});

describe("whiteboard-mint: export_as_svg", () => {
  let boardId;
  before(() => {
    const r = upsertBoard(db, { ownerId: "u_alice", title: "SVG only", scene: { elements: [{ kind: "rectangle", x: 0, y: 0, w: 50, h: 50 }] } });
    boardId = r.id;
  });

  it("owner can read SVG", async () => {
    const r = await macros.get("export_as_svg")({ db, actor: { userId: "u_alice" } }, { boardId });
    assert.equal(r.ok, true);
    assert.ok(r.svg.includes("<rect"));
  });

  it("non-participant cannot read SVG", async () => {
    const r = await macros.get("export_as_svg")({ db, actor: { userId: "u_bob" } }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
});
