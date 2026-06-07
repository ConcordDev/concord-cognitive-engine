// tests/depth/romance-behavior.test.js — REAL behavioral tests for the romance
// domain (register()/runMacro family, via macroRuntime). Drives the full demo
// loop court → propose → wed → conceive → birth → children, plus validation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { macroRuntime } from "./_harness.js";

describe("romance — courtship → marriage → lineage loop", () => {
  let runMacro, ctx;
  // Unique partner per run: the depth tests share a persistent concord.db, so a
  // fixed partner would already be married on the second run (already_married).
  const PK = "npc", PID = `npc-amara-${randomUUID().slice(0, 8)}`;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("romance")); });

  it("court: repeated positive interactions raise affinity past the marry threshold", async () => {
    let last;
    // affinity rises by COURT_AFFINITY_DELTA (~0.058) per positive interaction;
    // court until it clears the 0.85 marry gate (capped iterations, robust to the
    // exact delta).
    for (let i = 0; i < 30 && (!last || last.affinity < 0.9); i++) {
      last = await runMacro("romance", "court", { partnerKind: PK, partnerId: PID, sentiment: 1 }, ctx);
      assert.equal(last.ok, true);
    }
    assert.ok(last.affinity >= 0.85, `affinity should clear the marry gate, got ${last.affinity}`);
  });

  it("courtship: reads back the courtship we just built", async () => {
    const c = await runMacro("romance", "courtship", { partnerKind: PK, partnerId: PID }, ctx);
    assert.equal(c.ok, true);
    assert.equal(c.courtship.partner_id, PID);
    assert.ok(c.courtship.affinity >= 0.85);
  });

  it("propose → wed: engagement then marriage once affinity clears the gates", async () => {
    const eng = await runMacro("romance", "propose", { partnerKind: PK, partnerId: PID }, ctx);
    assert.equal(eng.ok, true);
    assert.equal(eng.status, "engaged");
    const married = await runMacro("romance", "wed", { partnerKind: PK, partnerId: PID }, ctx);
    assert.equal(married.ok, true);
    assert.equal(married.status, "married");
    assert.ok(married.marriageId);
  });

  it("marriages: the new marriage is listed", async () => {
    const m = await runMacro("romance", "marriages", {}, ctx);
    assert.equal(m.ok, true);
    assert.ok(m.marriages.length >= 1);
  });

  it("conceive → birth → children: a child is born and listed", async () => {
    const preg = await runMacro("romance", "conceive", { partnerKind: PK, partnerId: PID }, ctx);
    assert.equal(preg.ok, true);
    assert.ok(preg.pregnancyId);
    const born = await runMacro("romance", "birth", { pregnancyId: preg.pregnancyId, name: "Kael" }, ctx);
    assert.equal(born.ok, true);
    assert.equal(born.name, "Kael");
    const kids = await runMacro("romance", "children", {}, ctx);
    assert.ok(kids.children.some((k) => k.id === born.childId || k.name === "Kael"));
  });

  it("spouses: the wedded partner shows as a spouse", async () => {
    const s = await runMacro("romance", "spouses", {}, ctx);
    assert.equal(s.ok, true);
    assert.ok(Array.isArray(s.spouses));
  });
});

describe("romance — validation + catalog", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("romance-v")); });

  it("propose with no courtship is rejected", async () => {
    const r = await runMacro("romance", "propose", { partnerKind: "npc", partnerId: "stranger" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_courtship");
  });

  it("give_gift with missing inputs is rejected", async () => {
    const r = await runMacro("romance", "give_gift", { npcId: "n1" }, ctx); // no itemId
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("spouse_react with no event kind is rejected", async () => {
    const r = await runMacro("romance", "spouse_react", {}, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_kind");
  });

  it("constants: exposes the romance tuning constants", async () => {
    const r = await runMacro("romance", "constants", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.constants && typeof r.constants === "object");
  });
});
