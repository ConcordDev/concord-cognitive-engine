// A8 (shared validation) — the census as a test.
//
// Quick Capture (shared chrome) posts lens.create(domain,
// { type: "capture", … }) into every lens's domain. Before this slice,
// only 4 of 122 ruled domains accepted the type; the other 118
// rejected valid captures with validation_failed (ML F11 the named
// instance). reconcileArtifactTypes now accepts the platform's own
// capture type for every ruled domain — this test is that census,
// pinned so the regression can never silently return.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN_RULES, validateArtifact } from "../lib/domain-logic.js";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";
import { reconcileArtifactTypes } from "../lib/lens-artifact-types.js";
import { respondMacroResult } from "../lib/lens-run-http.js";

// server.js's own merge semantics: base wins, extended fills gaps,
// then the reconcile runs over the merged registry.
for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}
reconcileArtifactTypes(DOMAIN_RULES);

const CAPTURE_DATA = {
  content: "a thought worth keeping",
  source: "user.capture",
  tags: ["ml"],
  capturedAt: "2026-11-06T00:00:00.000Z",
};

describe("A8 — the capture census", () => {
  it("every ruled domain accepts a Quick Capture create", () => {
    const failures = [];
    for (const domain of DOMAIN_RULES.keys()) {
      const v = validateArtifact(domain, "capture", CAPTURE_DATA, {});
      if (!v.ok) failures.push(`${domain}: ${v.errors.join("; ")}`);
    }
    assert.deepEqual(failures, [], `capture must validate on every ruled domain`);
    assert.ok(DOMAIN_RULES.size >= 100, "the census covers the ruled registry");
  });

  it("the named instance: ML validates a capture (F11)", () => {
    assert.equal(validateArtifact("ml", "capture", CAPTURE_DATA, {}).ok, true);
  });

  it("the gate keeps its teeth: a nonsense type still refuses, with a sentence", () => {
    const v = validateArtifact("ml", "definitely-not-a-type", {}, {});
    assert.equal(v.ok, false);
    assert.match(v.errors[0], /Invalid type "definitely-not-a-type" for domain "ml"/);
  });

  it("an unruled domain still passes with its warning (standing behaviour)", () => {
    const v = validateArtifact("no-such-domain", "capture", CAPTURE_DATA, {});
    assert.equal(v.ok, true);
    assert.equal(v.warnings.length, 1);
  });
});

describe("A8 — failure speech", () => {
  function fakeRes() {
    return {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
  }

  it("a validation failure body carries its first error sentence as message", () => {
    const res = fakeRes();
    respondMacroResult(res, {
      ok: false,
      error: "validation_failed",
      errors: ['Invalid type "x" for domain "ml". Valid types: model'],
    });
    assert.equal(res.statusCode, 422);
    assert.match(res.body.message, /Invalid type "x" for domain "ml"/);
    assert.equal(res.body.error, "validation_failed");
  });

  it("a failure with its own message keeps it; one without errors gains none", () => {
    const res = fakeRes();
    respondMacroResult(res, { ok: false, error: "not_found", message: "named already" });
    assert.equal(res.body.message, "named already");
    const res2 = fakeRes();
    respondMacroResult(res2, { ok: false, error: "not_found" });
    assert.equal("message" in res2.body, false);
  });
});
