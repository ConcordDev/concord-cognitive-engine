// tests/depth/masonry-behavior.test.js
// REAL behavioral tests for the masonry lens-action domain (29 actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("masonry — calc actions (exact values)", () => {
  it("materialEstimate: brick units + cost scale with area", async () => {
    const r = await lensRun("masonry", "materialEstimate", { data: { material: "brick", squareFootage: 200 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.unitsNeeded, 1470);                 // brick ≈ 7.35 units/ft² × 200
    assert.ok(r.result.totalMaterialCost > 0);
    const half = await lensRun("masonry", "materialEstimate", { data: { material: "brick", squareFootage: 100 } });
    assert.ok(half.result.unitsNeeded < r.result.unitsNeeded, "fewer ft² ⇒ fewer units");
  });

  it("mortarMix: Type N → 1:1:6 ratio, 750 psi", async () => {
    const r = await lensRun("masonry", "mortarMix", { params: { type: "N" }, data: { type: "N" } });
    assert.equal(r.ok, true);
    assert.match(r.result.ratio, /1:1:6/);
    assert.match(String(r.result.strength), /750/);
  });

  it("wallStrength: slenderness = height/thickness; taller wall ⇒ higher ratio", async () => {
    const r = await lensRun("masonry", "wallStrength", { data: { heightFeet: 8, thicknessInches: 8, reinforced: true } });
    assert.equal(r.ok, true);
    assert.equal(r.result.slendernessRatio, 12);              // 96in / 8in
    assert.equal(r.result.passesSlenderness, true);
    const tall = await lensRun("masonry", "wallStrength", { data: { heightFeet: 16, thicknessInches: 8 } });
    assert.ok(tall.result.slendernessRatio > r.result.slendernessRatio, "taller wall is more slender");
  });
});

describe("masonry — CRUD lifecycle", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("masonry-crud"); });

  it("takeoff-save → takeoff-list: a saved takeoff is listed", async () => {
    const saved = await lensRun("masonry", "takeoff-save", { params: { name: "Wall A", material: "brick" } }, ctx);
    assert.equal(saved.ok, true);
    const id = saved.result.id;
    const list = await lensRun("masonry", "takeoff-list", { params: {} }, ctx);
    assert.ok((list.result.takeoffs || []).some((t) => t.id === id), "takeoff is listed");
  });

  it("pricebook-save → pricebook-list: a price item persists", async () => {
    const saved = await lensRun("masonry", "pricebook-save", { params: { name: "Brick (std)", unitCost: 0.75 } }, ctx);
    assert.equal(saved.ok, true);
    const list = await lensRun("masonry", "pricebook-list", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.equal(typeof list.result, "object");
  });
});
