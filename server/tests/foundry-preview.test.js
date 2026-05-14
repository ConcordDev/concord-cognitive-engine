/**
 * Tier-2 contract tests for Foundry Phase 5 — live 3D preview.
 *
 * Pins:
 *   - foundry.preview: compiles the draft into a status='preview'
 *     worlds row, reuses an attached preview row instead of
 *     accumulating, blocks an empty worldspec, creator-scoped
 *   - foundry.preview_end: deletes the preview world, clears
 *     preview_world_id, idempotent, creator-scoped
 *   - runFoundryPreviewCleanup: sweeps stale preview rows past the TTL,
 *     leaves fresh ones, clears dangling preview_world_id pointers,
 *     never throws (heartbeat-safe)
 *
 * Run: node --test server/tests/foundry-preview.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate191 } from "../migrations/191_foundry_worlds.js";
import registerFoundryMacros from "../domains/foundry.js";
import {
  runFoundryPreviewCleanup,
  FOUNDRY_PREVIEW_CLEANUP_INTERNALS,
} from "../emergent/foundry-preview-cleanup.js";

function makeHarness() {
  const db = new Database(":memory:");
  migrate191(db);
  db.exec(`
    CREATE TABLE worlds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, universe_type TEXT NOT NULL,
      description TEXT, physics_modulators TEXT DEFAULT '{}', rule_modulators TEXT DEFAULT '{}',
      created_by TEXT, status TEXT NOT NULL DEFAULT 'active', total_visits INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  const macros = new Map();
  registerFoundryMacros((domain, name, handler) => macros.set(`${domain}.${name}`, handler));
  const call = (name, input, actor = { userId: "user-1" }) =>
    macros.get(name)({ db, actor }, input || {});
  return { db, call };
}

describe("foundry.preview", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  function draftWith(systems) {
    return h.call("foundry.create", { name: "Previewable", worldspec: { systems } }).world.id;
  }

  it("compiles the draft into a status='preview' worlds row", () => {
    const id = draftWith([{ id: "physics-modifiers", config: { gravity: 40 } }, { id: "combat-motor" }]);
    const pv = h.call("foundry.preview", { id });
    assert.equal(pv.ok, true);
    assert.ok(pv.previewWorldId.startsWith("preview-"));
    const w = h.db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(pv.previewWorldId);
    assert.ok(w);
    assert.equal(w.status, "preview");
    assert.equal(JSON.parse(w.physics_modulators).movement.gravity, 40);
    // foundry_worlds row now points at it
    const fw = h.db.prepare(`SELECT preview_world_id FROM foundry_worlds WHERE id = ?`).get(id);
    assert.equal(fw.preview_world_id, pv.previewWorldId);
  });

  it("reuses an attached preview row instead of accumulating", () => {
    const id = draftWith([{ id: "combat-motor" }]);
    const first = h.call("foundry.preview", { id });
    const second = h.call("foundry.preview", { id });
    assert.equal(first.previewWorldId, second.previewWorldId);
    const count = h.db.prepare(`SELECT COUNT(*) c FROM worlds WHERE status = 'preview'`).get().c;
    assert.equal(count, 1);
  });

  it("blocks previewing an empty worldspec", () => {
    const id = h.call("foundry.create", { name: "Empty" }).world.id;
    const pv = h.call("foundry.preview", { id });
    assert.equal(pv.ok, false);
    assert.equal(pv.reason, "no_systems");
  });

  it("is creator-scoped", () => {
    const id = draftWith([{ id: "combat-motor" }]);
    assert.equal(h.call("foundry.preview", { id }, { userId: "intruder" }).reason, "not_owner");
  });

  it("activates Phase 7 systems in the preview (no stubs skipped)", () => {
    const id = draftWith([{ id: "combat-motor" }, { id: "status-window" }]);
    const pv = h.call("foundry.preview", { id });
    assert.equal(pv.ok, true);
    assert.deepEqual(pv.skippedStubs, []);
    assert.ok(pv.activatedSystems.includes("status-window"));
  });
});

describe("foundry.preview_end", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("deletes the preview world and clears the pointer", () => {
    const id = h.call("foundry.create", { name: "X", worldspec: { systems: [{ id: "combat-motor" }] } }).world.id;
    const pv = h.call("foundry.preview", { id });
    const end = h.call("foundry.preview_end", { id });
    assert.equal(end.ok, true);
    assert.equal(h.db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(pv.previewWorldId), undefined);
    assert.equal(h.db.prepare(`SELECT preview_world_id FROM foundry_worlds WHERE id = ?`).get(id).preview_world_id, null);
  });

  it("is idempotent when there is no preview", () => {
    const id = h.call("foundry.create", { name: "X" }).world.id;
    const end = h.call("foundry.preview_end", { id });
    assert.equal(end.ok, true);
    assert.equal(end.alreadyClear, true);
  });

  it("is creator-scoped", () => {
    const id = h.call("foundry.create", { name: "X", worldspec: { systems: [{ id: "combat-motor" }] } }).world.id;
    h.call("foundry.preview", { id });
    assert.equal(h.call("foundry.preview_end", { id }, { userId: "intruder" }).reason, "not_owner");
  });
});

describe("runFoundryPreviewCleanup", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("sweeps preview worlds past the TTL, leaves fresh ones", () => {
    const ttl = FOUNDRY_PREVIEW_CLEANUP_INTERNALS.PREVIEW_TTL_SECONDS;
    const nowSec = Math.floor(Date.now() / 1000);
    h.db.prepare(`INSERT INTO worlds (id, name, universe_type, status, created_at) VALUES (?, ?, ?, 'preview', ?)`)
      .run("preview-stale", "stale", "fantasy", nowSec - ttl - 100);
    h.db.prepare(`INSERT INTO worlds (id, name, universe_type, status, created_at) VALUES (?, ?, ?, 'preview', ?)`)
      .run("preview-fresh", "fresh", "fantasy", nowSec - 60);
    h.db.prepare(`INSERT INTO worlds (id, name, universe_type, status, created_at) VALUES (?, ?, ?, 'active', ?)`)
      .run("world-real", "real", "fantasy", nowSec - ttl - 999); // active — must NOT be swept

    const r = runFoundryPreviewCleanup({ db: h.db });
    assert.equal(r.ok, true);
    assert.equal(r.swept, 1);
    assert.equal(h.db.prepare(`SELECT * FROM worlds WHERE id = 'preview-stale'`).get(), undefined);
    assert.ok(h.db.prepare(`SELECT * FROM worlds WHERE id = 'preview-fresh'`).get());
    assert.ok(h.db.prepare(`SELECT * FROM worlds WHERE id = 'world-real'`).get());
  });

  it("clears dangling preview_world_id pointers", () => {
    const id = h.call("foundry.create", { name: "X", worldspec: { systems: [{ id: "combat-motor" }] } }).world.id;
    const pv = h.call("foundry.preview", { id });
    // Simulate the preview world vanishing out from under the pointer.
    h.db.prepare(`DELETE FROM worlds WHERE id = ?`).run(pv.previewWorldId);
    const r = runFoundryPreviewCleanup({ db: h.db });
    assert.equal(r.ok, true);
    assert.equal(r.danglingCleared, 1);
    assert.equal(h.db.prepare(`SELECT preview_world_id FROM foundry_worlds WHERE id = ?`).get(id).preview_world_id, null);
  });

  it("never throws — returns ok even with no db", () => {
    assert.equal(runFoundryPreviewCleanup({}).ok, true);
    assert.equal(runFoundryPreviewCleanup().ok, true);
  });
});
