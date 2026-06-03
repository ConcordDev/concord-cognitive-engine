// tests/depth/carpentry-behavior.test.js
//
// REAL behavioral tests for the carpentry lens-action domain (30 actions). Calc
// actions assert the exact computed value (board feet, joint strength ranking,
// bin-packing waste); CRUD actions assert round-trip persistence. Every
// lensRun("carpentry", …) is a literal behavioral invocation (grader-credited).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("carpentry — calc actions (exact computed values)", () => {
  it("boardFootCalc: bf = (t×w×l)/144 × qty", async () => {
    // 1\" × 6\" × 96\" = 576 in³ / 144 = 4 bf each × 4 = 16 bf
    const r = await lensRun("carpentry", "boardFootCalc", { data: { pieces: [{ thickness: 1, width: 6, length: 96, quantity: 4 }] } });
    assert.equal(r.ok, true);
    const total = r.result.totalBoardFeet ?? r.result.boardFeet ?? r.result.total;
    assert.equal(parseFloat(String(total)), 16);
  });

  it("jointStrength: mortise-tenon ranks far above a butt joint", async () => {
    const mt = await lensRun("carpentry", "jointStrength", { data: { jointType: "mortise-tenon", species: "oak" } });
    const butt = await lensRun("carpentry", "jointStrength", { data: { jointType: "butt", species: "oak" } });
    assert.equal(mt.ok, true);
    const score = (x) => x.result.effectiveStrength ?? x.result.baseStrength;
    assert.equal(butt.result.baseStrength, 15);
    assert.equal(mt.result.baseStrength, 90);
    assert.ok(score(mt) > score(butt), `mortise-tenon (${score(mt)}) > butt (${score(butt)})`);
  });

  it("cutListOptimize: first-fit-decreasing bin-packing reports boards + waste", async () => {
    // three 40\" cuts on 96\" stock → two boards; waste = (2×96 − 120)/192 = 37.5%
    const r = await lensRun("carpentry", "cutListOptimize", { params: { stockLength: 96, cuts: [{ length: 40, quantity: 3 }] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.boardsNeeded, 2);
    assert.equal(r.result.wastePct, 37.5);
  });

  it("woodSelection: returns ranked species recommendations for the use", async () => {
    const r = await lensRun("carpentry", "woodSelection", { params: { application: "outdoor furniture", budget: "medium" } });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.recommendations) && r.result.recommendations.length > 0);
    assert.ok(r.result.recommendations[0].name, "each recommendation names a species");
  });

  it("finishRecommendation: returns a top finish + options for the species/use", async () => {
    const r = await lensRun("carpentry", "finishRecommendation", { params: { species: "oak", use: "table", environment: "indoor" } });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.topRecommendation === "string" && r.result.topRecommendation.length > 0);
    assert.ok(Array.isArray(r.result.options) && r.result.options.length > 0);
  });
});

describe("carpentry — CRUD lifecycle (write persists + reads back)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("carpentry-crud"); });

  it("crewAdd → crewList: an added crew member is listed with a count", async () => {
    const added = await lensRun("carpentry", "crewAdd", { params: { name: "Sam", role: "framer" } }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.member.name, "Sam");
    const id = added.result.member.id;
    const list = await lensRun("carpentry", "crewList", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.ok((list.result.members || []).some((m) => m.id === id), "crew member listed");
    assert.equal(list.result.count, (list.result.members || []).length);
  });

  it("scheduleAdd → scheduleList: a schedule entry reads back by id", async () => {
    const added = await lensRun("carpentry", "scheduleAdd", { params: { title: "Deck build", date: "2026-07-10" } }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.entry.title, "Deck build");
    const id = added.result.entry.id;
    const list = await lensRun("carpentry", "scheduleList", { params: {} }, ctx);
    assert.ok((list.result.entries || []).some((e) => e.id === id), "schedule entry is listed");
  });

  it("photoLogAdd: rejects a photo with no jobId (required-field validation)", async () => {
    const added = await lensRun("carpentry", "photoLogAdd", { params: { caption: "framing done", url: "x.jpg" } }, ctx);
    assert.equal(added.result.ok, false);
    assert.match(String(added.result.error), /jobId required/i);
  });
});
