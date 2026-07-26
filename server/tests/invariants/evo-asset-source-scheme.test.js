// Invariant: the (source, sourceId) KEY-SPACE contract between the
// frontend's passive-interaction telemetry and the server's evo-asset
// registry must actually resolve — not just agree on field NAMES.
//
// Verified live 2026-07-25: recordAssetInteraction() calls to POST
// /api/evo-asset/interaction were 404ing 62/62 times on the world lens.
// Root cause is NOT an empty registry — every real frontend call site
// sends a (source, sourceId) pair under a scheme nothing server-side ever
// registers a row for:
//
//   - source: 'authored' + a building/npc DTU id
//       BuildingRenderer3D.tsx:772        ('authored', building.id)
//       app/lenses/world/page.tsx:4619    ('authored', building.dtuId)
//       NPCDialogue.tsx:392               ('authored', `npc:${npc.id}`)
//       app/lenses/world/page.tsx:3609    ('authored', `npc:${targetId}`)
//     'authored' IS a valid, already-registered source — but only under two
//     OTHER conventions: `seed:<file>` (source-loaders.js#bootstrapLocalSeed)
//     and `material:<kind>:<seed>:<channel>` (domains/art.js,
//     domains/whiteboard.js). A raw DTU/npc id was never one of them, so
//     every one of these four call sites was doomed by construction.
//
//   - source: 'combat_combo' + a vfxSeed (lib/combat/combo-vfx.ts:147)
//     'combat_combo' isn't even in the evo_assets.source CHECK constraint
//     (migration 373's list: kenney/polyhaven/ambientcg/os3a/sketchfab/
//     authored/evolved/concordia/github) — this call was doomed twice over,
//     and would 500 rather than 404 if it were ever auto-registered as-is.
//     Fixed at the call site to use the established internal 'concordia'
//     convention (matches gameplay-asset-bridge.js's virtual-blueprint
//     scheme) instead of inventing a new, never-allowed source value.
//
// Fix: server/lib/evo-asset/registry.js#resolveOrAutoRegisterForInteraction,
// wired into routes/evo-asset.js's POST /interaction, auto-registers a real
// placeholder evo_assets row on first interaction — but ONLY for the three
// internally-originated sources ('authored' / 'evolved' / 'concordia').
// External CC0-catalog sources (kenney/polyhaven/ambientcg/os3a/sketchfab)
// and 'github' are deliberately EXCLUDED: those sourceIds are only honest
// when they name a real upstream-catalog entry the bootstrap loaders in
// source-loaders.js actually fetched — auto-registering an arbitrary
// client-supplied id under one of them would fabricate a fake catalog row,
// not an honest placeholder for real gameplay presence. This mirrors the
// auto-register-on-first-use idiom already shipped in
// gameplay-asset-bridge.js#onSkillUsed.
//
// This test drives the REAL router (routes/evo-asset.js) over a REAL HTTP
// round trip against a REAL migrated db — it does not reimplement the
// contract — so a future change to the route, the registry helper, or the
// CHECK constraint that reopens the mismatch fails this test immediately.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";

import { runMigrations } from "../../migrate.js";
import createEvoAssetRouter from "../../routes/evo-asset.js";

let db, server, base;

before(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const result = await runMigrations(db);
  assert.strictEqual(result.error, undefined, `migrations failed: ${result.error}`);

  const app = express();
  app.use(express.json());
  app.use("/api/evo-asset", createEvoAssetRouter({
    requireAuth: (req, _res, next) => { req.user = { id: "test-user" }; next(); },
    db,
  }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  try { server?.close(); } catch { /* ignore */ }
  try { db?.close(); } catch { /* ignore */ }
});

// The real (source, sourceId) pairs every frontend recordAssetInteraction()
// call site actually sends, as of the 2026-07-25 audit (see header comment
// for exact file:line provenance of each). This is NOT a hardcoded copy of
// the server's registration logic — it's the client's half of the contract,
// fired at the real route.
const REAL_CLIENT_CALLS = [
  {
    label: "BuildingRenderer3D.tsx:772 — passive building render presence",
    source: "authored",
    sourceId: "dtu-building-abc123",
    action: "render",
    weight: 0.1,
  },
  {
    label: "app/lenses/world/page.tsx:4619 — building_inspect",
    source: "authored",
    sourceId: "dtu-building-def456",
    action: "building_inspect",
    weight: 1.0,
  },
  {
    label: "NPCDialogue.tsx:392 — dialogue engagement",
    source: "authored",
    sourceId: "npc:npc-xyz789",
    action: "dialogue",
    weight: 1.5,
  },
  {
    label: "app/lenses/world/page.tsx:3609 — combat hit/crit on targeted NPC",
    source: "authored",
    sourceId: "npc:npc-qrs321",
    action: "combat_hit",
    weight: 1.0,
  },
  {
    label: "lib/combat/combo-vfx.ts:147 — combo VFX trigger (fixed to use the 'concordia' convention instead of the never-valid 'combat_combo' source)",
    source: "concordia",
    sourceId: "combo:seed-t3-abcdef",
    action: "combo_trigger_t3",
    weight: 1.5,
  },
];

describe("evo-asset (source, sourceId) key-space contract", () => {
  for (const call of REAL_CLIENT_CALLS) {
    it(`resolves: ${call.label}`, async () => {
      const res = await fetch(`${base}/api/evo-asset/interaction`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: call.source,
          sourceId: call.sourceId,
          action: call.action,
          weight: call.weight,
        }),
      });
      const json = await res.json();
      assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
      assert.equal(json.ok, true, `expected ok:true, got ${JSON.stringify(json)}`);

      // Prove it's not just an HTTP 200 — a REAL row must now exist under
      // exactly this (source, sourceId) pair, and a real interaction row
      // must be recorded against it (this is the actual behavior the
      // scheduler/evolution_score math depends on).
      const row = db.prepare(
        `SELECT id FROM evo_assets WHERE source = ? AND source_id = ?`,
      ).get(call.source, call.sourceId);
      assert.ok(row, "a real evo_assets row must exist for this (source, sourceId)");
      const interactionRow = db.prepare(
        `SELECT COUNT(*) AS c FROM evo_asset_interactions WHERE asset_id = ?`,
      ).get(row.id);
      assert.ok(interactionRow.c >= 1, "a real interaction row must be recorded");
    });
  }

  it("does NOT auto-register under an external CC0-catalog source (would fabricate a catalog entry)", async () => {
    const res = await fetch(`${base}/api/evo-asset/interaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "polyhaven",
        sourceId: "never-bootstrapped-id",
        action: "render",
        weight: 0.1,
      }),
    });
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.error, "asset_not_found");
    const row = db.prepare(
      `SELECT id FROM evo_assets WHERE source = 'polyhaven' AND source_id = 'never-bootstrapped-id'`,
    ).get();
    assert.equal(row, undefined, "must NOT fabricate a row under an external catalog source");
  });

  it("still 404s honestly for a truly unregistered explicit assetId", async () => {
    const res = await fetch(`${base}/api/evo-asset/interaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: "does-not-exist", action: "render", weight: 0.1 }),
    });
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.error, "asset_not_found");
  });

  // The auto-register fix above has a side effect that would quietly break a
  // DIFFERENT honesty invariant if left unhandled, so it is pinned here.
  //
  // GET /api/evo-asset/stats calls itself "public transparency" and groups
  // every non-archived evo_assets row by source and quality. Interaction
  // placeholders are real rows but carry NO asset — no mesh, no texture,
  // local_path is the virtual `interaction://<source>/<sourceId>`. Since a
  // placeholder is minted for every rendered building and every NPC talked
  // to, counting them would swamp the real library and report a number of
  // "assets" that mostly do not exist. Excluded from the library counts and
  // surfaced as their own `interactionPlaceholders` figure instead — not
  // inflated, and not hidden either.
  it("does not let interaction placeholders inflate the public stats counts", async () => {
    const before = await (await fetch(`${base}/api/evo-asset/stats`)).json();
    const beforeBySource = Object.fromEntries((before.bySource || []).map((r) => [r.source, r.n]));
    const beforePlaceholders = before.interactionPlaceholders ?? 0;

    // Mint a placeholder through the REAL interaction route.
    const res = await fetch(`${base}/api/evo-asset/interaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "concordia",
        sourceId: `stats-probe:${Date.now()}`,
        action: "render",
        weight: 0.1,
      }),
    });
    assert.equal(res.status, 200, "interaction should be recorded");

    const after = await (await fetch(`${base}/api/evo-asset/stats`)).json();
    const afterBySource = Object.fromEntries((after.bySource || []).map((r) => [r.source, r.n]));

    assert.equal(
      afterBySource.concordia ?? 0,
      beforeBySource.concordia ?? 0,
      "a contentless interaction placeholder must NOT increment the public per-source asset count",
    );
    assert.equal(
      after.interactionPlaceholders,
      beforePlaceholders + 1,
      "it must still be reported honestly as a placeholder, not silently hidden",
    );
  });
});
