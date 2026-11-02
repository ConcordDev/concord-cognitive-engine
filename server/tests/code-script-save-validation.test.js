// S8 (PR #1707, F8): the Scratch "Save script" validation contract.
//
// Root cause of F8: the Code lens saves Scratch scripts through
// useLensData('code', 'script') with meta.status 'active', but the
// native code rule in lib/domain-logic.js listed neither the "script"
// type nor the "active" status — validateArtifact rejected every save
// on two fields at once, and the four analysis buttons stayed gated
// behind "save a script first" forever. This suite replicates the
// boot merge exactly (extended rules apply only where no native rule
// exists — server.js semantics, per the trades vocabulary test) and
// pins the Scratch payload as valid, plus the field-naming property
// of the errors the UI now surfaces.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DOMAIN_RULES, validateArtifact } from "../lib/domain-logic.js";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";

for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}

describe("code — Scratch script save validation (S8)", () => {
  it("accepts the exact payload the Scratch save sends", () => {
    const r = validateArtifact(
      "code",
      "script",
      { content: "console.log('hi');", language: "javascript", scriptType: "script" },
      { tags: ["script", "script"], status: "active" },
    );
    assert.equal(r.ok, true, `expected ok, got errors: ${r.errors.join(" | ")}`);
    assert.deepEqual(r.errors, []);
  });

  it("still rejects an unknown type — and the error names the field", () => {
    const r = validateArtifact("code", "definitely-not-a-type", {}, { status: "active" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Invalid type "definitely-not-a-type" for domain "code"/.test(e)));
  });

  it("still rejects an unknown status — and the error names it", () => {
    const r = validateArtifact("code", "script", { content: "x" }, { status: "bogus-status" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Invalid status "bogus-status" for domain "code"/.test(e)));
  });
});
