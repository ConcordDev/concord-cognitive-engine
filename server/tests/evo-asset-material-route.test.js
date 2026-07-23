/**
 * Pins the material_upgrade consumer wiring:
 *   (a) resolveCurrentBest / the /file/:id geometry channel must NOT serve a
 *       promoted material_upgrade JSON as the canonical mesh (it's metadata).
 *   (b) GET /api/evo-asset/material returns that promoted PBR spec instead.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { up as up073 } from "../migrations/073_evo_assets.js";
import { up as up100 } from "../migrations/100_evo_assets_gameplay_kinds.js";
import { resolveCurrentBest } from "../lib/evo-asset/registry.js";
import createEvoAssetRouter from "../routes/evo-asset.js";

let db, tmpDir, server, base, geomPath, matPath;

function insertVersion(assetId, { versionNumber, passKind, localPath, promoted }) {
  db.prepare(`
    INSERT INTO evo_asset_versions (id, asset_id, version_number, pass_kind, local_path, promoted, promoted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), assetId, versionNumber, passKind, localPath, promoted ? 1 : 0,
    promoted ? Math.floor(Date.now() / 1000) : null);
}

before(async () => {
  db = new Database(":memory:");
  up073(db);
  up100(db); // extends the source CHECK enum to include 'concordia'
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evo-mat-"));

  const assetId = crypto.randomUUID();
  geomPath = path.join(tmpDir, "geom.glb");
  matPath = path.join(tmpDir, "material.json");
  fs.writeFileSync(geomPath, "GEOMETRY_GLB_BYTES");
  fs.writeFileSync(matPath, JSON.stringify({
    shadingModel: "physical", roughness: 0.4, metalness: 0.2,
    clearcoat: 0.1, clearcoatRoughness: 0.4, sheen: 0.0,
  }));

  db.prepare(`
    INSERT INTO evo_assets (id, kind, source, source_id, local_path, quality_level)
    VALUES (?, 'mesh', 'concordia', 'tavern', ?, 3)
  `).run(assetId, path.join(tmpDir, "base.glb"));

  // A promoted geometry version (higher version number) AND a promoted
  // material_upgrade. The geometry channel must pick the geometry version.
  insertVersion(assetId, { versionNumber: 1, passKind: "subdivision", localPath: geomPath, promoted: true });
  insertVersion(assetId, { versionNumber: 2, passKind: "material_upgrade", localPath: matPath, promoted: true });

  const app = express();
  app.use("/api/evo-asset", createEvoAssetRouter({ requireAuth: (_r, _s, n) => n(), db }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  try { server?.close(); } catch { /* ignore */ }
  try { db?.close(); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("material_upgrade does not corrupt the geometry channel", () => {
  it("resolveCurrentBest skips material_upgrade, returns the geometry version", () => {
    const r = resolveCurrentBest(db, { source: "concordia", sourceId: "tavern" });
    assert.ok(r);
    assert.equal(r.pass, "subdivision");
    assert.equal(r.canonicalPath, geomPath);
  });

  it("GET /material returns the promoted PBR spec", async () => {
    const res = await fetch(`${base}/api/evo-asset/material?source=concordia&sourceId=tavern`);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.material.shadingModel, "physical");
    assert.ok(Math.abs(json.material.roughness - 0.4) < 1e-9);
    assert.ok(Math.abs(json.material.clearcoat - 0.1) < 1e-9);
  });

  it("GET /material is honest when no upgrade exists", async () => {
    const res = await fetch(`${base}/api/evo-asset/material?source=concordia&sourceId=nonexistent`);
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.equal(json.error, "not_registered");
  });
});
