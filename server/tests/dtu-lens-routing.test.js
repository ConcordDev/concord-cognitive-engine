// DTU→lens routing contract — the resolver + the idempotent backfill.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { resolveLensId, lensOwnedKinds, backfillLensIds, KIND_LENS_MAP } from "../lib/dtu-lens-routing.js";
import { registerManifest } from "../lib/lens-manifest.js";

function withRouting(on, fn) {
  const prev = process.env.CONCORD_DTU_ROUTING;
  process.env.CONCORD_DTU_ROUTING = on ? "1" : "0";
  try { return fn(); } finally { if (prev === undefined) delete process.env.CONCORD_DTU_ROUTING; else process.env.CONCORD_DTU_ROUTING = prev; }
}
function db0() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, data TEXT, lens_id TEXT DEFAULT 'unknown', created_at INTEGER);`);
  return db;
}

test("kind/type map routes the live corpus types", () => {
  assert.equal(resolveLensId({ type: "material" }), "crafting");
  assert.equal(resolveLensId({ type: "fighting_style_recipe" }), "combat");
  assert.equal(resolveLensId({ type: "trivia_answer" }), "trivia");
  assert.equal(resolveLensId({ type: "spell_recipe" }), "glyph-spells");
  // formal-science reasoning seeds → the formal lenses
  assert.equal(resolveLensId({ type: "control_theory" }), "robotics");
  assert.equal(resolveLensId({ kind: "manifold" }), "math");
});

test("explicit meta.lens / meta.domain wins over the kind map", () => {
  assert.equal(resolveLensId({ type: "material", meta: { lens: "studio" } }), "studio");
  assert.equal(resolveLensId({ type: "material", meta: { domain: "music" } }), "music");
});

test("internal/excluded kinds are never routed (null)", () => {
  assert.equal(resolveLensId({ type: "shadow" }), null);
  assert.equal(resolveLensId({ kind: "repair_record" }), null);
  assert.equal(resolveLensId({ kind: "client_error" }), null);
});

test("tag match via the lens-manifest index resolves an unmapped kind", () => {
  registerManifest({ lensId: "accounting", domain: "accounting", actions: [], domainTags: ["payroll", "ledger", "tax"] });
  assert.equal(resolveLensId({ type: "note", tags: ["payroll", "q4"] }), "accounting");
  // a kind with no map + no tag hit → unroutable
  assert.equal(resolveLensId({ type: "mystery_kind", tags: ["zzz_no_lens_owns_this"] }), null);
});

test("lensOwnedKinds is the inverse of the kind map", () => {
  const crafting = lensOwnedKinds("crafting");
  assert.ok(crafting.includes("material"));
  assert.ok(crafting.includes("blueprint"));
  assert.equal(lensOwnedKinds("nonexistent").length, 0);
});

test("backfill stamps unknown rows, idempotently, and reports byLens", () => {
  withRouting(true, () => {
    const db = db0();
    db.prepare(`INSERT INTO dtus (id, type, lens_id) VALUES ('a','material','unknown'),('b','trivia_answer',NULL),('c','shadow','unknown'),('d','material','crafting')`).run();
    const r = backfillLensIds(db);
    assert.equal(r.ok, true);
    assert.equal(r.stamped, 2, "a + b stamped; c excluded, d already routed");
    assert.equal(r.byLens.crafting, 1);
    assert.equal(r.byLens.trivia, 1);
    assert.equal(db.prepare(`SELECT lens_id FROM dtus WHERE id='a'`).get().lens_id, "crafting");
    assert.equal(db.prepare(`SELECT lens_id FROM dtus WHERE id='c'`).get().lens_id, "unknown", "excluded kind stays unknown");
    // idempotent: a second run stamps nothing new
    assert.equal(backfillLensIds(db).stamped, 0);
  });
});

test("backfill resolves from meta.tags in the data JSON", () => {
  withRouting(true, () => {
    registerManifest({ lensId: "code", domain: "code", actions: [], domainTags: ["programming", "api", "refactor"] });
    const db = db0();
    db.prepare(`INSERT INTO dtus (id, type, data, lens_id) VALUES ('x','note',?, 'unknown')`).run(JSON.stringify({ tags: ["refactor"] }));
    backfillLensIds(db);
    assert.equal(db.prepare(`SELECT lens_id FROM dtus WHERE id='x'`).get().lens_id, "code");
  });
});

test("kill-switch off → backfill is a no-op", () => {
  withRouting(false, () => {
    const db = db0();
    db.prepare(`INSERT INTO dtus (id, type, lens_id) VALUES ('a','material','unknown')`).run();
    const r = backfillLensIds(db);
    assert.equal(r.disabled, true);
    assert.equal(db.prepare(`SELECT lens_id FROM dtus WHERE id='a'`).get().lens_id, "unknown");
  });
});

test("no_db is graceful", () => {
  withRouting(true, () => { assert.equal(backfillLensIds(null).ok, false); });
});
