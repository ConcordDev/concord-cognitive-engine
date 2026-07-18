// tests/depth/reasoning-counter-argument-enhanced-behavior.test.js
//
// REAL behavioral tests for the counterArgumentGen broadening (closes the
// docs/WAVE4_INVENTORY.md row: "counterArgumentGen's critique quality is a
// fixed rule set, not a real argumentation-theory engine"). Two NEW attack
// angles were added, both sourced from real data that already existed
// elsewhere in server/domains/reasoning.js — nothing here is invented:
//
//   - "weak-link": reuses argumentMapCore's real weakestClaim/contested
//     computation (the same engine `strengthAssessment` runs) against a
//     real persisted argument map, flattened via persistedMapToClaims.
//   - "scheme-critical-question": reuses the real `criticalQuestions` array
//     from the SCHEMES library (the same array `scheme-instantiate`
//     returns), surfaced only when the map was built from a named scheme.
//
// Run isolated: DB_PATH=/tmp/reasoning-counter-argument-enhanced.db \
//   node --test server/tests/depth/reasoning-counter-argument-enhanced-behavior.test.js
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("reasoning — counterArgumentGen: weak-link + scheme-critical-question angles", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("reasoning-counter-argument-enhanced"); });

  it("weak-link angle appears for a real mapId with a genuinely contested claim, with the exact strength-assessment numbers", async () => {
    const create = await lensRun("reasoning", "map-create", {
      params: { title: "Robust debate", rootClaim: "We should adopt X" },
    }, ctx);
    assert.equal(create.ok, true);
    const mapId = create.result.map.id;
    const rootId = create.result.map.nodes[0].id;

    // Two PRO children of root — root itself ends up well-supported.
    const proA = await lensRun("reasoning", "node-add", {
      params: { mapId, parentId: rootId, text: "It's popular", stance: "pro", strength: 5 },
    }, ctx);
    assert.equal(proA.ok, true);
    const proAId = proA.result.node.id;
    await lensRun("reasoning", "node-add", {
      params: { mapId, parentId: rootId, text: "It's cheap", stance: "pro", strength: 5 },
    }, ctx);

    // Two CON children attached to proA specifically — proA is the one
    // genuinely weak/contested claim in this map (2 counters, 0 supports),
    // strictly weaker than every other node (root: 2 supports/0 counters
    // -> 80; leaf con children: no children of their own -> neutral 50).
    await lensRun("reasoning", "node-add", {
      params: { mapId, parentId: proAId, text: "Popularity is manufactured", stance: "con", strength: 4 },
    }, ctx);
    await lensRun("reasoning", "node-add", {
      params: { mapId, parentId: proAId, text: "Popularity ignores side effects", stance: "con", strength: 4 },
    }, ctx);

    const r = await lensRun("reasoning", "counterArgumentGen", {
      params: { premises: ["placeholder premise"], conclusion: "placeholder conclusion", mapId },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.map.mapId, mapId);
    assert.equal(r.result.map.title, "Robust debate");

    const weakLink = r.result.angles.find((a) => a.attack === "weak-link");
    assert.ok(weakLink, "expected a weak-link angle");
    assert.equal(weakLink.nodeId, proAId);
    assert.equal(weakLink.mapId, mapId);
    assert.equal(weakLink.source, "map-strength-assessment");
    assert.equal(
      weakLink.detail,
      'In "Robust debate", the claim "It\'s popular" is the weakest link (strength 20/100 — 2 counters vs 0 support) — attack there first.'
    );
  });

  it("weak-link angle is absent when no mapId is supplied (unchanged pre-existing call shape)", async () => {
    const r = await lensRun("reasoning", "counterArgumentGen", {
      params: {
        premises: ["birds fly", "birds not fly"],
        conclusion: "birds fly",
      },
    }, ctx);
    assert.equal(r.ok, true);
    assert.ok(!("map" in r.result), "no map metadata should be present without a mapId");
    assert.ok(!r.result.angles.some((a) => a.attack === "weak-link"));
    assert.ok(!r.result.angles.some((a) => a.attack === "scheme-critical-question"));
    // The pre-existing contradiction-scan behavior is unaffected.
    assert.ok(r.result.angles.some((a) => a.attack === "internal-contradiction"));
    assert.equal(r.result.validity, "invalid-contradictions");
  });

  it("weak-link angle is absent when the resolved map has no contested claims", async () => {
    const create = await lensRun("reasoning", "map-create", {
      params: { title: "Uncontested map", rootClaim: "Everyone agrees on Y" },
    }, ctx);
    const mapId = create.result.map.id;
    const rootId = create.result.map.nodes[0].id;
    // Pure-pro tree — nothing counters anything, so no claim is contested.
    await lensRun("reasoning", "node-add", {
      params: { mapId, parentId: rootId, text: "Reason one", stance: "pro", strength: 4 },
    }, ctx);
    await lensRun("reasoning", "node-add", {
      params: { mapId, parentId: rootId, text: "Reason two", stance: "pro", strength: 4 },
    }, ctx);

    const r = await lensRun("reasoning", "counterArgumentGen", { params: { mapId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.map.mapId, mapId);
    assert.ok(!r.result.angles.some((a) => a.attack === "weak-link"), "an uncontested map has no weak link to report");
  });

  it("weak-link angle is absent (no crash) for a nonexistent or unauthorized mapId", async () => {
    const r = await lensRun("reasoning", "counterArgumentGen", {
      params: { premises: ["a premise"], conclusion: "a conclusion", mapId: "map_does_not_exist" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.ok(!("map" in r.result));
    assert.ok(!r.result.angles.some((a) => a.attack === "weak-link"));
  });

  it("scheme-critical-question angles surface the REAL SCHEMES criticalQuestions text (not fabricated), only for a map built from a named scheme", async () => {
    // Fetch the live SCHEMES library the same way the frontend does, so
    // this test proves equality against the actual source of truth rather
    // than a hardcoded copy that could drift.
    const schemeList = await lensRun("reasoning", "scheme-list", {}, ctx);
    assert.equal(schemeList.ok, true);
    const authorityScheme = schemeList.result.schemes.find((s) => s.id === "authority");
    assert.ok(authorityScheme, "expected the built-in 'authority' scheme to exist");
    assert.ok(Array.isArray(authorityScheme.criticalQuestions) && authorityScheme.criticalQuestions.length > 0);

    const inst = await lensRun("reasoning", "scheme-instantiate", {
      params: {
        schemeId: "authority",
        title: "Expert opinion on drug safety",
        values: {
          Expert: "Dr. Smith",
          Domain: "pharmacology",
          "Asserted Claim": "the drug is safe",
          "Basis of Expertise": "20 years of published research",
        },
      },
    }, ctx);
    assert.equal(inst.ok, true);
    const mapId = inst.result.map.id;
    assert.equal(inst.result.map.scheme, "authority");

    const r = await lensRun("reasoning", "counterArgumentGen", { params: { mapId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.map.scheme, "authority");

    const schemeAngles = r.result.angles.filter((a) => a.attack === "scheme-critical-question");
    assert.equal(schemeAngles.length, authorityScheme.criticalQuestions.length);
    assert.deepEqual(schemeAngles.map((a) => a.detail), authorityScheme.criticalQuestions);
    for (const a of schemeAngles) {
      assert.equal(a.source, "scheme:authority");
      assert.equal(a.schemeName, authorityScheme.name);
      // Every surfaced question must literally be one of the scheme's real
      // questions — never a templated-but-fake-sounding string.
      assert.ok(authorityScheme.criticalQuestions.includes(a.detail));
    }
  });

  it("scheme-critical-question angles are absent for a free-form map (no scheme tag)", async () => {
    const create = await lensRun("reasoning", "map-create", {
      params: { title: "Free-form map", rootClaim: "An untagged claim", scheme: "free" },
    }, ctx);
    assert.equal(create.ok, true);
    const mapId = create.result.map.id;
    assert.equal(create.result.map.scheme, "free");

    const r = await lensRun("reasoning", "counterArgumentGen", { params: { mapId } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(!r.result.angles.some((a) => a.attack === "scheme-critical-question"));
  });

  it("backward-compatible: the original premises/conclusion/text call shape (no mapId) is byte-identical in structure to before this change", async () => {
    const r = await lensRun("reasoning", "counterArgumentGen", {
      params: {
        premises: ["Experts say it works", "everyone knows that already"],
        conclusion: "we should proceed immediately",
      },
    }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.result).sort(), ["angles", "recommendation", "validity"]);
    assert.ok(Array.isArray(r.result.angles) && r.result.angles.length > 0);
    for (const a of r.result.angles) {
      assert.ok(typeof a.attack === "string" && typeof a.detail === "string");
    }
  });

  it("empty call with no premises/text/mapId still returns the guidance message (unchanged)", async () => {
    const r = await lensRun("reasoning", "counterArgumentGen", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("Provide premises"));
  });
});
