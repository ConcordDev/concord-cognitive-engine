/**
 * Migration 373 (admits 'github' as an evo_assets source) rebuilt evo_assets
 * via RENAME->CREATE->DROP and its new CREATE TABLE omitted BOTH
 * `train_consented` AND `cdn_url`. Migration 375 restored `train_consented`
 * but never restored `cdn_url`, leaving `GET /api/evo-asset/file/:id`'s
 * SELECT (`a.cdn_url`) referencing a column that no longer exists on any DB
 * migrated past 373 -- every call 500s. Migration 376 repairs it.
 *
 * This test boots the REAL migration set (not a hand-picked subset) into an
 * in-memory DB via server/migrate.js#runMigrations, exactly like
 * scripts/verify-schema-drift.mjs does for its ground-truth schema, so the
 * assertion reflects what an actual fresh/upgraded install ends up with.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import crypto from "node:crypto";

import { runMigrations } from "../migrate.js";
import createEvoAssetRouter from "../routes/evo-asset.js";

let db, server, base;

before(async () => {
  db = new Database(":memory:");
  // Silence migration boot logging so test output stays clean.
  const orig = { log: console.log, warn: console.warn, info: console.info };
  console.log = console.warn = console.info = () => {};
  try {
    await runMigrations(db);
  } finally {
    Object.assign(console, orig);
  }

  const app = express();
  app.use("/api/evo-asset", createEvoAssetRouter({ requireAuth: (_r, _s, n) => n(), db }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  try { server?.close(); } catch { /* ignore */ }
  try { db?.close(); } catch { /* ignore */ }
});

describe("evo_assets.cdn_url survives the real migration set", () => {
  it("PRAGMA table_info(evo_assets) includes cdn_url", () => {
    const cols = db.pragma("table_info(evo_assets)").map((c) => c.name);
    assert.ok(cols.includes("cdn_url"), `evo_assets columns: ${cols.join(", ")}`);
    assert.ok(cols.includes("train_consented"), "train_consented (375) should also still be present");
  });

  it("GET /api/evo-asset/file/:id no longer 500s (queries cdn_url without throwing)", async () => {
    const assetId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO evo_assets (id, kind, source, source_id, local_path, cdn_url)
      VALUES (?, 'mesh', 'kenney', 'test-bench', '/nonexistent/local.glb', 'https://cdn.example/test-bench.glb')
    `).run(assetId);

    const res = await fetch(`${base}/api/evo-asset/file/${assetId}`);
    // No CONCORD_CDN_BASE_URL configured in test env, so it falls through to
    // the local-file path, which 404s honestly (file_missing) -- the point
    // is that it's a clean 404, not a 500 from a missing-column SQL error.
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.equal(json.error, "file_missing");
  });

  it("GET /api/evo-asset/file/:id 404s cleanly for an unknown id (also exercises the cdn_url SELECT)", async () => {
    const res = await fetch(`${base}/api/evo-asset/file/${crypto.randomUUID()}`);
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.equal(json.error, "not_found");
  });
});
