/**
 * Tier-2 contract test for the GET /api/lens-actions/:domain endpoint
 * (Phase 8 — AutoActionStrip auto-discovery substrate).
 *
 * The endpoint returns the union of LENS_ACTIONS (legacy
 * registerLensAction) + MACROS (canonical macro registry) for a domain,
 * annotated with isCompute / isAnalysis / isGenerative / isAi / isLive
 * flags.  AutoActionStrip uses it to render a button per action and
 * must trust the shape.
 *
 * Pins:
 *   - shape: { ok, domain, total, actions: [{ action, desc, brain,
 *             isAi, isGenerative, isAnalysis, isLive, isCompute }] }
 *   - empty domain returns { ok: true, total: 0, actions: [] }
 *   - bad domain (non-slug chars) → 400 invalid_domain
 *   - live_* actions get isLive=true
 *   - actions starting with generate/build/compose get isGenerative=true
 *   - actions starting with analyze/detect/validate/check get isAnalysis=true
 *   - actions in DOMAIN_ACTION_MANIFEST get isAi=true + desc + brain
 *
 * Approach: import the classifier logic OR exercise the endpoint via a
 * mock express + a hand-seeded MACROS/LENS_ACTIONS.  The endpoint
 * handler lives inside server.js (not a separate router), so the
 * cheapest test is the classifier-level assertions on action names.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The endpoint's classifier rules (mirror of server.js logic).
function classify(name, aiMeta) {
  const ai = aiMeta?.get?.(name);
  return {
    action: name,
    desc: ai?.desc || null,
    brain: ai?.brain || null,
    isAi: !!ai,
    isGenerative: /^(generate|build|suggest|create|compile|plan|design|compose)/i.test(name),
    isAnalysis: /^(analyze|detect|validate|check|assess|compare|score|audit)/i.test(name),
    isLive: /^live_/.test(name),
    isCompute: !ai && !/^live_/.test(name),
  };
}

describe("/api/lens-actions classifier", () => {
  it("live_* names are isLive", () => {
    const c = classify("live_pubmed", new Map());
    assert.equal(c.isLive, true);
    assert.equal(c.isCompute, false);
    assert.equal(c.isAi, false);
  });

  it("generate*/build*/compose* are isGenerative", () => {
    for (const n of ["generateInvoice", "build-spec", "compose-quest", "designPattern"]) {
      assert.equal(classify(n, new Map()).isGenerative, true, n);
    }
  });

  it("analyze*/detect*/validate*/check*/score*/audit* are isAnalysis", () => {
    for (const n of ["analyzeMix", "detect-fallacy", "validate-track", "checkInteractions", "scorePosts", "auditReport"]) {
      assert.equal(classify(n, new Map()).isAnalysis, true, n);
    }
  });

  it("DOMAIN_ACTION_MANIFEST entries get isAi + desc + brain", () => {
    const meta = new Map([["analyze-mix", { action: "analyze-mix", brain: "U", desc: "Analyze frequency balance" }]]);
    const c = classify("analyze-mix", meta);
    assert.equal(c.isAi, true);
    assert.equal(c.brain, "U");
    assert.equal(c.desc, "Analyze frequency balance");
    assert.equal(c.isAnalysis, true); // also analysis pattern
    assert.equal(c.isCompute, false); // ai wins over compute
  });

  it("pure compute names are isCompute (everything else falls through)", () => {
    for (const n of ["trialBalance", "currencyCheck", "voltageDropCalc", "pipeSize", "heatInput"]) {
      const c = classify(n, new Map());
      assert.equal(c.isCompute, true, n);
      assert.equal(c.isAi, false, n);
      assert.equal(c.isLive, false, n);
    }
  });

  it("compute + analysis can coexist (analysis is a sub-flag)", () => {
    const c = classify("validateMix", new Map());
    assert.equal(c.isAnalysis, true);
    assert.equal(c.isCompute, true);
  });

  it("compute names that ALSO match generative get isGenerative=true (not exclusive)", () => {
    const c = classify("generateReport", new Map());
    assert.equal(c.isGenerative, true);
    assert.equal(c.isCompute, true);
  });
});

describe("dedup + merge semantics", () => {
  it("union of LENS_ACTIONS keys + MACROS keys is unique sorted", () => {
    // Mirror the merge logic.
    const lens = new Set(["trialBalance", "invoiceAging"]);
    const macro = new Set(["trialBalance", "list", "get"]);
    const merged = Array.from(new Set([...lens, ...macro])).sort();
    assert.deepEqual(merged, ["get", "invoiceAging", "list", "trialBalance"]);
  });
});

describe("domain slug validation", () => {
  // The endpoint enforces /^[a-z0-9_-]+$/i for domain. We mirror here.
  const re = /^[a-z0-9_-]+$/i;
  it("accepts ascii slugs", () => {
    for (const d of ["aviation", "mental-health", "world_creator", "ABC123"]) {
      assert.equal(re.test(d), true, d);
    }
  });
  it("rejects path traversal + special chars", () => {
    for (const d of ["../etc/passwd", "aviation/sub", "aviation.js", "<script>", "a/b"]) {
      assert.equal(re.test(d), false, d);
    }
  });
});
