// Macro surface for the move-builder lens (server/domains/move-builder.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB whose `dtus` table carries the runtime
// type/creator_id/data columns (migrations 001 + 087). No { ok:true }-only
// assertions: compose asserts the EXACT motion descriptor the real
// move-descriptor lib derives + the ED budget math; mint round-trips through
// get/list against real DB rows; the budget-overspend gate and the
// ownership/auth guards are pinned to concrete rejections.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerMoveBuilderMacros from "../domains/move-builder.js";
import { deriveMotion } from "../lib/move-descriptor.js";

function collectMacros() {
  const map = new Map();
  registerMoveBuilderMacros((domain, name, handler) => {
    assert.equal(domain, "move-builder", `unexpected domain: ${domain}`);
    map.set(name, handler);
  });
  return map;
}

// Real runtime dtus shape: migration 001 base + migration 087's type/creator_id/data.
function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      title TEXT NOT NULL DEFAULT 'Untitled',
      body_json TEXT NOT NULL DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'private',
      tier TEXT NOT NULL DEFAULT 'regular',
      created_at INTEGER,
      type TEXT NOT NULL DEFAULT 'knowledge',
      creator_id TEXT,
      data TEXT
    );
  `);
  return db;
}

const ctxFor = (db, userId) => ({ db, actor: { userId } });

describe("move-builder domain macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("registers the full compose/mint/list/get/catalog surface", () => {
    for (const name of ["compose", "mint", "list", "get", "catalog"]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  it("catalog exposes the real skill-kind / element / aspect option lists", async () => {
    const r = await macros.get("catalog")(ctxFor(db, "u1"), {});
    assert.equal(r.ok, true);
    assert.ok(r.skillKinds.includes("fighting_style") && r.skillKinds.includes("spell"));
    assert.ok(r.elements.includes("fire") && r.elements.includes("lightning"));
    assert.deepEqual(r.aspects, ["power", "speed", "area", "efficiency", "control"]);
  });

  it("compose derives the EXACT motion descriptor the real lib returns", async () => {
    const r = await macros.get("compose")(ctxFor(db, "u1"), {
      skillKind: "spell", element: "fire",
      allocation: { power: 2, speed: 1, area: 1, efficiency: 1, control: 0 }, skillLevel: 1,
    });
    assert.equal(r.ok, true);
    // Source-of-truth comparison: the macro must NOT reimplement the table.
    const expected = deriveMotion("spell", "fire");
    assert.deepEqual(r.motion, expected);
    // fire's effect bias is 'projectile'; spell's family is 'magic'.
    assert.equal(r.motion.effectArchetype, "projectile");
    assert.equal(r.motion.motionFamily, "magic");
    assert.equal(r.element, "fire");
    assert.equal(r.tier, 1);
  });

  it("compose budget applies Enhancement-Diversification (stacking ≠ linear)", async () => {
    // 5 points all into power: ED schedule 1+1+0.9+0.7+0.15 = 3.75 effective.
    const stacked = await macros.get("compose")(ctxFor(db, "u1"), {
      skillKind: "spell", element: "fire", allocation: { power: 5 }, skillLevel: 1,
    });
    assert.equal(stacked.ok, true);
    assert.ok(Math.abs(stacked.budget.effective.power - 3.75) < 1e-9,
      `expected 3.75 effective, got ${stacked.budget.effective.power}`);
    // Single-aspect dump is NOT balanced (>60% of total effective value).
    assert.equal(stacked.budget.balanced, false);
    assert.equal(stacked.budget.dominantAspect, "power");

    // A spread build IS balanced.
    const spread = await macros.get("compose")(ctxFor(db, "u1"), {
      skillKind: "spell", element: "fire",
      allocation: { power: 2, speed: 2, area: 2 }, skillLevel: 1,
    });
    assert.equal(spread.budget.balanced, true);
  });

  it("compose rejects an overspent allocation (ok:false), not throws", async () => {
    // Tier 1 budget = 6; allocate 9.
    const r = await macros.get("compose")(ctxFor(db, "u1"), {
      skillKind: "spell", element: "fire", allocation: { power: 7, speed: 2 }, skillLevel: 1,
    });
    assert.equal(r.ok, false);
    assert.equal(r.budget.overspent, true);
    assert.equal(r.budget.spent, 9);
    assert.equal(r.budget.budget, 6);
  });

  it("budget grows with tier (a mastered move earns more points)", async () => {
    // skillLevel 100 → revision floor(99/10)=9 → rev>=5 → tier 2 → budget 6 + (2-1) = 7.
    const r = await macros.get("compose")(ctxFor(db, "u1"), {
      skillKind: "fighting_style", element: "physical", allocation: { power: 7 }, skillLevel: 100,
    });
    assert.equal(r.tier, 2);
    assert.equal(r.budget.budget, 7);
    assert.equal(r.budget.overspent, false);

    // skillLevel 160 → revision 15 → tier 3 → budget 6 + (3-1) = 8.
    const t3 = await macros.get("compose")(ctxFor(db, "u1"), {
      skillKind: "fighting_style", element: "physical", allocation: { power: 8 }, skillLevel: 160,
    });
    assert.equal(t3.tier, 3);
    assert.equal(t3.budget.budget, 8);
    assert.equal(t3.budget.overspent, false);
  });

  it("mint persists a move_recipe DTU that round-trips through get + list", async () => {
    const minted = await macros.get("mint")(ctxFor(db, "u1"), {
      name: "Cinder Lance", skillKind: "spell", element: "fire",
      allocation: { power: 2, speed: 2, area: 1 }, skillLevel: 1,
    });
    assert.equal(minted.ok, true);
    assert.ok(minted.moveId.startsWith("move:u1:"));
    assert.equal(minted.motion.effectArchetype, "projectile");

    // Real DB row exists with the right type + stamped motion in `data`.
    const row = db.prepare("SELECT type, creator_id, data FROM dtus WHERE id = ?").get(minted.moveId);
    assert.ok(row, "dtu row persisted");
    assert.equal(row.type, "move_recipe");
    assert.equal(row.creator_id, "u1");
    const meta = JSON.parse(row.data);
    assert.equal(meta.kind, "move_recipe");
    assert.equal(meta.skill_kind, "spell");
    assert.equal(meta.element, "fire");
    assert.deepEqual(meta.allocation, { power: 2, speed: 2, area: 1, efficiency: 0, control: 0 });
    assert.ok(meta.motion && meta.motion.motionFamily === "magic", "motion descriptor stamped");

    // get round-trips the same descriptor.
    const got = await macros.get("get")(ctxFor(db, "u1"), { moveId: minted.moveId });
    assert.equal(got.ok, true);
    assert.equal(got.move.name, "Cinder Lance");
    assert.equal(got.move.element, "fire");
    assert.deepEqual(got.move.motion, minted.motion);

    // list returns it for the owner.
    const listed = await macros.get("list")(ctxFor(db, "u1"), {});
    assert.equal(listed.ok, true);
    assert.equal(listed.moves.length, 1);
    assert.equal(listed.moves[0].id, minted.moveId);
    assert.equal(listed.moves[0].name, "Cinder Lance");
  });

  it("list/get are owner-scoped (no cross-user leakage)", async () => {
    const minted = await macros.get("mint")(ctxFor(db, "u1"), {
      name: "Secret Move", skillKind: "spell", element: "ice",
      allocation: { power: 1 }, skillLevel: 1,
    });
    assert.equal(minted.ok, true);

    const otherList = await macros.get("list")(ctxFor(db, "u2"), {});
    assert.equal(otherList.ok, true);
    assert.equal(otherList.moves.length, 0, "u2 must not see u1's move");

    const otherGet = await macros.get("get")(ctxFor(db, "u2"), { moveId: minted.moveId });
    assert.equal(otherGet.ok, false);
    assert.equal(otherGet.reason, "not_owner");
  });

  it("mint rejects an overspent budget without writing a row", async () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM dtus").get().n;
    const r = await macros.get("mint")(ctxFor(db, "u1"), {
      name: "Overcharged", skillKind: "spell", element: "fire",
      allocation: { power: 7, speed: 2 }, skillLevel: 1,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "budget_overspent");
    const after = db.prepare("SELECT COUNT(*) AS n FROM dtus").get().n;
    assert.equal(after, before, "no DTU should be written on a rejected mint");
  });

  it("an unknown skill kind falls back to the lib default (spell), never throws", async () => {
    const r = await macros.get("compose")(ctxFor(db, "u1"), {
      skillKind: "not_a_real_kind", element: "fire", allocation: { power: 1 }, skillLevel: 1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.skillKind, "spell");
    assert.equal(r.motion.motionFamily, "magic");
  });

  it("guards: no db / no user / missing name+moveId are rejected, not crashed", async () => {
    assert.equal((await macros.get("list")({}, {})).reason, "no_db");
    assert.equal((await macros.get("list")(ctxFor(db, null), {})).reason, "no_user");
    assert.equal((await macros.get("mint")(ctxFor(db, "u1"), {})).reason, "missing_name");
    assert.equal((await macros.get("get")(ctxFor(db, "u1"), {})).reason, "missing_moveId");
  });
});
