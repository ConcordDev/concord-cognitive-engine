// integrations-compat-versions.test.js
// FIX-integrations-008 (GB-1521 slice B6) — compatibilityCheck coerced
// blank/malformed versions to 0.0.0 on both sides, so an untouched
// form (placeholders 1.0.0 → 2.0.0, values empty) reported
// "(same) · compatible · trivial · 0h". Invalid versions are now
// reported per-entry, in words, and counted as neither compatible
// nor breaking; the apis list is also read from params (the panel's
// call shape), not only from artifact data.
//
// Run: node --test server/domains/integrations-compat-versions.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerIntegrationsActions from "./integrations.js";

const actions = new Map();
registerIntegrationsActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const ctx = { actor: { userId: "test" }, userId: "test" };

beforeEach(() => { globalThis._concordSTATE = {}; });

const check = (apis) => actions.get("integrations:compatibilityCheck")(ctx, null, { apis });

describe("integrations-008 — compatibility versions must be real", () => {
  it("blank versions are reported as unusable, not analysed as (same)", () => {
    const r = check([{ name: "billing", currentVersion: "", targetVersion: "" }]);
    assert.equal(r.ok, true);
    const row = r.result.apis[0];
    assert.equal(row.versionsValid, false);
    assert.match(row.problem, /not a semantic version/);
    assert.equal(r.result.summary.compatible, 0);
    assert.equal(r.result.summary.invalidVersions, 1);
  });

  it("a real 1.0.0 → 2.0.0 major jump with no changes is still inferred breaking", () => {
    const r = check([{ name: "billing", currentVersion: "1.0.0", targetVersion: "2.0.0", changes: [] }]);
    const row = r.result.apis[0];
    assert.equal(row.versionJump, "major");
    assert.equal(row.backwardCompatible, false);
  });

  it("a patch bump stays compatible", () => {
    const r = check([{ name: "billing", currentVersion: "1.0.0", targetVersion: "1.0.1", changes: [] }]);
    assert.equal(r.result.apis[0].backwardCompatible, true);
    assert.equal(r.result.summary.compatible, 1);
  });
});
