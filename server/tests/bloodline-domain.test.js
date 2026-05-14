/**
 * Tier-2 contract tests for Concordia Phase 2 — bloodline domain macros.
 *
 * Pins:
 *   - bloodline.list_known returns all 10 entries
 *   - bloodline.get_ancestry returns null when not set
 *   - bloodline.choose sets ancestry; subsequent get_ancestry reflects it
 *   - bloodline.choose rejects unknown bloodline
 *   - bloodline.preview_skill returns expected multipliers per matrix
 *
 * Run: node --test tests/bloodline-domain.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerBloodlineMacros from "../domains/bloodline.js";
import { up as up173 } from "../migrations/173_bloodline_ancestry.js";

function setupDb() {
  const db = new Database(":memory:");
  up173(db);
  return db;
}

function buildMacros() {
  const map = new Map();
  registerBloodlineMacros((domain, name, handler) => {
    map.set(`${domain}.${name}`, handler);
  });
  return map;
}

function ctxFor(db, userId) {
  return { db, actor: { userId }, io: null };
}

describe("Phase 2 / bloodline domain — list_known", () => {
  it("returns 10 bloodline entries with elements + description", async () => {
    const macros = buildMacros();
    const r = await macros.get("bloodline.list_known")();
    assert.equal(r.ok, true);
    assert.equal(r.bloodlines.length, 10);
    for (const b of r.bloodlines) {
      assert.ok(typeof b.id === "string");
      assert.ok(Array.isArray(b.elements) && b.elements.length >= 1);
      assert.ok(typeof b.description === "string");
    }
  });
});

describe("Phase 2 / bloodline domain — get_ancestry", () => {
  it("returns null before choose", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("bloodline.get_ancestry")(ctxFor(db, "user_1"));
    assert.equal(r.ok, true);
    assert.equal(r.ancestry, null);
  });

  it("requires actor", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("bloodline.get_ancestry")({ db });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });
});

describe("Phase 2 / bloodline domain — choose", () => {
  it("sets ancestry; get reflects it", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("bloodline.choose")(ctxFor(db, "user_1"), { bloodline: "sanguire", dilution: 0.1 });
    assert.equal(r.action, "set");
    const g = await macros.get("bloodline.get_ancestry")(ctxFor(db, "user_1"));
    assert.equal(g.ancestry.primary_bloodline, "sanguire");
    assert.equal(g.ancestry.dilution, 0.1);
  });

  it("rejects unknown bloodline", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("bloodline.choose")(ctxFor(db, "user_1"), { bloodline: "imaginary" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_bloodline");
  });

  it("missing inputs rejected", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("bloodline.choose")(ctxFor(db, "user_1"), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});

describe("Phase 2 / bloodline domain — preview_skill", () => {
  it("returns neutral when no ancestry", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("bloodline.preview_skill")(ctxFor(db, "user_1"), { skillElement: "fire" });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "no_ancestry");
    assert.equal(r.multiplier, 1.0);
  });

  it("returns pure_match for sanguire fire at low dilution", async () => {
    const db = setupDb();
    const macros = buildMacros();
    await macros.get("bloodline.choose")(ctxFor(db, "user_1"), { bloodline: "sanguire", dilution: 0.1 });
    const r = await macros.get("bloodline.preview_skill")(ctxFor(db, "user_1"), { skillElement: "fire" });
    assert.equal(r.kind, "pure_match");
    assert.equal(r.multiplier, 1.20);
  });

  it("flags refused on faded ancestry casting matched element", async () => {
    const db = setupDb();
    const macros = buildMacros();
    await macros.get("bloodline.choose")(ctxFor(db, "user_1"), { bloodline: "sanguire", dilution: 0.95 });
    const r = await macros.get("bloodline.preview_skill")(ctxFor(db, "user_1"), { skillElement: "fire" });
    assert.equal(r.refused, true);
  });

  it("missing inputs rejected", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("bloodline.preview_skill")(ctxFor(db, "user_1"), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});
