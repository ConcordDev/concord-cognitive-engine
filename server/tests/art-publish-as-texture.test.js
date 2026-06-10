// Contract test for the art → evo_assets content-engine bridge.
//
// The art.publish-as-texture macro is the wire that takes a player-
// authored canvas and registers it as a tier-1 evo_asset that the
// frontend pbr-loader resolves into a Concordia building material slot.

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import registerArtActions from "../domains/art.js";

// ── Test harness ───────────────────────────────────────────────────────
const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`art.${name}`);
  assert.ok(fn, `art.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

// 1×1 transparent PNG, base64-encoded — small valid PNG for fixture use.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let tmpDataDir;
let db;

before(() => {
  registerArtActions(register);
  // Use a tmp data dir so test files don't pollute the repo.
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-art-pub-"));
  process.env.DATA_DIR = tmpDataDir;
});

after(() => {
  try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* idempotent */ }
  delete process.env.DATA_DIR;
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  // Fresh in-memory db per test. Replicate the evo_assets schema from
  // migration 100 (only the columns the bridge touches).
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE evo_assets (
      id                  TEXT PRIMARY KEY,
      kind                TEXT NOT NULL CHECK (kind IN (
        'mesh','texture','material','hdri','sprite',
        'creature','item','skill','drop','craft','species'
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

// ── Tests ──────────────────────────────────────────────────────────────

describe("art.publish-as-texture", async () => {
  it("rejects anonymous publishers", async () => {
    const r = await call("publish-as-texture", { db, actor: { userId: "anon" }, userId: "anon" }, {
      materialKind: "wood", seed: 1, channel: "color", imageDataUrl: TINY_PNG_DATA_URL,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /auth/i);
  });

  it("rejects unknown materialKind", async () => {
    const r = await call("publish-as-texture", ctxAlice(), {
      materialKind: "lava",
      seed: 1, channel: "color", imageDataUrl: TINY_PNG_DATA_URL,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /materialKind/);
  });

  it("rejects unknown channel", async () => {
    const r = await call("publish-as-texture", ctxAlice(), {
      materialKind: "wood", seed: 1, channel: "specular", imageDataUrl: TINY_PNG_DATA_URL,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /channel/);
  });

  it("rejects a non-data-URL imageDataUrl", async () => {
    const r = await call("publish-as-texture", ctxAlice(), {
      materialKind: "wood", seed: 1, channel: "color", imageDataUrl: "https://example/x.png",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /base64 data/i);
  });

  it("rejects when db is unavailable", async () => {
    const r = await call("publish-as-texture", { actor: { userId: "user_alice" }, userId: "user_alice" }, {
      materialKind: "wood", seed: 1, channel: "color", imageDataUrl: TINY_PNG_DATA_URL,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /db/i);
  });

  it("writes the PNG to disk + registers an evo_assets row", async () => {
    const r = await call("publish-as-texture", ctxAlice(), {
      materialKind: "wood", seed: 42, channel: "color", imageDataUrl: TINY_PNG_DATA_URL,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.materialKind, "wood");
    assert.equal(r.result.seed, 42);
    assert.equal(r.result.channel, "color");
    assert.equal(r.result.sourceId, "material:wood:42:color");
    assert.ok(r.result.assetId);
    assert.equal(r.result.created, true);
    assert.match(r.result.resolveUrl, /\/api\/evo-asset\/resolve\?source=authored/);
    assert.match(r.result.resolveUrl, /sourceId=material%3Awood%3A42%3Acolor/);

    // Row inserted
    const row = db.prepare("SELECT * FROM evo_assets WHERE id = ?").get(r.result.assetId);
    assert.ok(row);
    assert.equal(row.kind, "texture");
    assert.equal(row.source, "authored");
    assert.equal(row.source_id, "material:wood:42:color");
    assert.ok(row.local_path && row.local_path.endsWith(".png"));

    // File written to disk
    assert.ok(fs.existsSync(row.local_path));
    const stat = fs.statSync(row.local_path);
    assert.ok(stat.size > 50, "PNG file should have content");
  });

  it("is idempotent on republish — same (source, sourceId) returns the existing assetId", async () => {
    const r1 = await call("publish-as-texture", ctxAlice(), {
      materialKind: "stone", seed: 7, channel: "normal", imageDataUrl: TINY_PNG_DATA_URL,
    });
    const r2 = await call("publish-as-texture", ctxAlice(), {
      materialKind: "stone", seed: 7, channel: "normal", imageDataUrl: TINY_PNG_DATA_URL,
    });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r1.result.assetId, r2.result.assetId);
    assert.equal(r1.result.created, true);
    assert.equal(r2.result.created, false);
  });

  it("each of the 8 procedural kinds publishes successfully", async () => {
    const kinds = ["stone", "wood", "brick", "cloth", "metal", "leather", "thatch", "dirt"];
    for (const k of kinds) {
      const r = await call("publish-as-texture", ctxAlice(), {
        materialKind: k, seed: 1, channel: "color", imageDataUrl: TINY_PNG_DATA_URL,
      });
      assert.equal(r.ok, true, `${k} should publish`);
    }
    const count = db.prepare("SELECT COUNT(*) AS n FROM evo_assets").get().n;
    assert.equal(count, kinds.length);
  });

  it("each of the 4 channels registers as its own row at the same (kind, seed)", async () => {
    const channels = ["color", "normal", "roughness", "ao"];
    for (const ch of channels) {
      const r = await call("publish-as-texture", ctxAlice(), {
        materialKind: "brick", seed: 99, channel: ch, imageDataUrl: TINY_PNG_DATA_URL,
      });
      assert.equal(r.ok, true);
    }
    const rows = db
      .prepare("SELECT source_id FROM evo_assets WHERE source = 'authored' ORDER BY source_id")
      .all();
    assert.deepEqual(rows.map((r) => r.source_id), [
      "material:brick:99:ao",
      "material:brick:99:color",
      "material:brick:99:normal",
      "material:brick:99:roughness",
    ]);
  });
});

describe("art.published-texture-coverage", async () => {
  it("returns null for every channel when nothing is published", async () => {
    const r = await call("published-texture-coverage", ctxAlice(), { materialKind: "wood", seed: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.channels.color, null);
    assert.equal(r.result.channels.normal, null);
    assert.equal(r.result.channels.roughness, null);
    assert.equal(r.result.channels.ao, null);
  });

  it("returns asset info for channels the player has published", async () => {
    await call("publish-as-texture", ctxAlice(), {
      materialKind: "wood", seed: 5, channel: "color", imageDataUrl: TINY_PNG_DATA_URL,
    });
    await call("publish-as-texture", ctxAlice(), {
      materialKind: "wood", seed: 5, channel: "ao", imageDataUrl: TINY_PNG_DATA_URL,
    });
    const r = await call("published-texture-coverage", ctxAlice(), { materialKind: "wood", seed: 5 });
    assert.equal(r.ok, true);
    assert.ok(r.result.channels.color?.assetId);
    assert.equal(r.result.channels.normal, null);
    assert.equal(r.result.channels.roughness, null);
    assert.ok(r.result.channels.ao?.assetId);
  });
});
