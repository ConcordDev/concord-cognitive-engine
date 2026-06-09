// Contract test for the whiteboard → evo_assets content-engine bridge.

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import registerWhiteboardActions from "../domains/whiteboard.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`whiteboard.${name}`);
  assert.ok(fn, `whiteboard.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const TINY_SVG_DATA_URL =
  "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString("base64");

let tmpDataDir;
let db;

before(() => {
  registerWhiteboardActions(register);
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-wb-pub-"));
  process.env.DATA_DIR = tmpDataDir;
});

after(() => {
  try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* idempotent */ }
  delete process.env.DATA_DIR;
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  db = new Database(":memory:");
  // Replicate evo_assets schema with the 'blueprint' kind extension
  db.exec(`
    CREATE TABLE evo_assets (
      id                  TEXT PRIMARY KEY,
      kind                TEXT NOT NULL CHECK (kind IN (
        'mesh','texture','material','hdri','sprite',
        'creature','item','skill','drop','craft','species','blueprint'
      )),
      source              TEXT NOT NULL CHECK (source IN (
        'kenney','polyhaven','ambientcg','os3a','sketchfab','authored','evolved','concordia'
      )),
      source_id           TEXT,
      local_path          TEXT,
      category            TEXT,
      tags_json           TEXT NOT NULL DEFAULT '[]',
      quality_level       INTEGER NOT NULL DEFAULT 0,
      evolution_score     REAL NOT NULL DEFAULT 0,
      interaction_points  INTEGER NOT NULL DEFAULT 0,
      archived_at         INTEGER,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
});

const ctxAlice = (overrides = {}) => ({
  actor: { userId: "user_alice" },
  userId: "user_alice",
  db,
  ...overrides,
});

function seedBoard(ctx, boardId, elements = []) {
  return call("board-save", ctx, {
    id: boardId,
    title: `Board ${boardId}`,
    scene: { elements, appState: {} },
  });
}

describe("whiteboard.publish-as-blueprint", async () => {
  it("rejects anonymous publishers", async () => {
    seedBoard({ actor: { userId: "anon" }, userId: "anon" }, "b1", []);
    const r = await call("publish-as-blueprint", { db, actor: { userId: "anon" }, userId: "anon" }, {
      archetype: "tavern", boardId: "b1",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /auth/i);
  });

  it("rejects unknown archetype", async () => {
    seedBoard(ctxAlice(), "b2", []);
    const r = await call("publish-as-blueprint", ctxAlice(), {
      archetype: "spaceship", boardId: "b2",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /archetype/);
  });

  it("rejects missing boardId", async () => {
    const r = await call("publish-as-blueprint", ctxAlice(), { archetype: "tavern" });
    assert.equal(r.ok, false);
    assert.match(r.error, /boardId/);
  });

  it("rejects non-existent board", async () => {
    const r = await call("publish-as-blueprint", ctxAlice(), {
      archetype: "tavern", boardId: "nonexistent_id",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /board not found/i);
  });

  it("rejects when db is unavailable", async () => {
    seedBoard(ctxAlice(), "b3", []);
    const r = await call("publish-as-blueprint", { actor: { userId: "user_alice" }, userId: "user_alice" }, {
      archetype: "tavern", boardId: "b3",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /db/i);
  });

  it("writes the blueprint JSON to disk + inserts an evo_assets row", async () => {
    seedBoard(ctxAlice(), "b4", [
      { kind: "sticky", x: 10, y: 20, width: 50, height: 50, fillColor: "#fef3c7", text: "fireplace" },
      { kind: "rect",   x: 100, y: 200, w: 60, h: 40, fillColor: "#9ca3af" },
    ]);
    const r = await call("publish-as-blueprint", ctxAlice(), {
      archetype: "tavern", boardId: "b4",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.archetype, "tavern");
    assert.equal(r.result.boardId, "b4");
    assert.equal(r.result.elementCount, 2);
    assert.equal(r.result.previewIncluded, false);
    assert.equal(r.result.sourceId, "blueprint:tavern:user_alice:b4");
    assert.match(r.result.resolveUrl, /\/api\/evo-asset\/resolve\?source=authored/);

    const row = db.prepare("SELECT * FROM evo_assets WHERE id = ?").get(r.result.assetId);
    assert.ok(row);
    assert.equal(row.kind, "blueprint");
    assert.equal(row.category, "interior:tavern");
    assert.ok(row.local_path?.endsWith(".blueprint.json"));
    assert.ok(fs.existsSync(row.local_path));
    const blueprint = JSON.parse(fs.readFileSync(row.local_path, "utf8"));
    assert.equal(blueprint.elementCount, 2);
    assert.equal(blueprint.decor[0].kind, "sticky");
    assert.equal(blueprint.decor[0].label, "fireplace");
    assert.equal(blueprint.decor[1].kind, "rect");
  });

  it("optionally accepts an SVG raster preview alongside JSON", async () => {
    seedBoard(ctxAlice(), "b5", []);
    const r = await call("publish-as-blueprint", ctxAlice(), {
      archetype: "archive",
      boardId: "b5",
      snapshotFormat: "svg-raster",
      svgDataUrl: TINY_SVG_DATA_URL,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.previewIncluded, true);
  });

  it("is idempotent on republish — same sourceId returns existing assetId", async () => {
    seedBoard(ctxAlice(), "b6", []);
    const r1 = await call("publish-as-blueprint", ctxAlice(), { archetype: "forge", boardId: "b6" });
    const r2 = await call("publish-as-blueprint", ctxAlice(), { archetype: "forge", boardId: "b6" });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r1.result.assetId, r2.result.assetId);
    assert.equal(r1.result.created, true);
    assert.equal(r2.result.created, false);
  });

  it("each of the 5 archetypes publishes successfully", async () => {
    const types = ["tavern", "archive", "forge", "market", "tower"];
    for (const t of types) {
      seedBoard(ctxAlice(), `b_${t}`, []);
      const r = await call("publish-as-blueprint", ctxAlice(), { archetype: t, boardId: `b_${t}` });
      assert.equal(r.ok, true, `${t} should publish`);
    }
    const count = db.prepare("SELECT COUNT(*) AS n FROM evo_assets WHERE kind = 'blueprint'").get().n;
    assert.equal(count, types.length);
  });
});

describe("whiteboard.published-blueprint-coverage", async () => {
  it("returns null for every archetype when nothing is published", async () => {
    const r = await call("published-blueprint-coverage", ctxAlice(), {});
    assert.equal(r.ok, true);
    for (const a of ["tavern", "archive", "forge", "market", "tower"]) {
      assert.equal(r.result.archetypes[a], null);
    }
  });

  it("returns asset info for archetypes the player has published", async () => {
    seedBoard(ctxAlice(), "b7", []);
    seedBoard(ctxAlice(), "b8", []);
    await call("publish-as-blueprint", ctxAlice(), { archetype: "tavern", boardId: "b7" });
    await call("publish-as-blueprint", ctxAlice(), { archetype: "forge", boardId: "b8" });
    const r = await call("published-blueprint-coverage", ctxAlice(), {});
    assert.equal(r.ok, true);
    assert.ok(r.result.archetypes.tavern?.assetId);
    assert.equal(r.result.archetypes.archive, null);
    assert.ok(r.result.archetypes.forge?.assetId);
  });

  it("rejects anonymous", async () => {
    const r = await call("published-blueprint-coverage", { db, actor: { userId: "anon" }, userId: "anon" }, {});
    assert.equal(r.ok, false);
  });
});
