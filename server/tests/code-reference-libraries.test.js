// server/tests/code-reference-libraries.test.js
//
// Track D (CURATION, copyright-aware) — plumbing.codeReference and
// landscaping.permit-reference. Both read a small, hand-authored,
// paraphrased-and-cited reference library instead of a verbatim
// copyrighted-code-text library (the IPC/UPC are copyrighted model codes —
// see server/lib/plumbing-code-reference.js's header comment). Mirrors the
// clinical-protocol pattern (content/healthcare-protocols.json /
// server/domains/healthcare.js#protocolMatch): every entry must carry a
// real citation or be honestly flagged as a general, uncited pattern, and
// every entry must carry its own disclaimer.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerPlumbingActions from "../domains/plumbing.js";
import registerLandscapingActions from "../domains/landscaping.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  return fn({ actor: { userId: "t" }, userId: "t" }, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerPlumbingActions(register);
  registerLandscapingActions(register);
});

describe("plumbing.codeReference — paraphrased, cited quick-reference library", () => {
  it("reads content/plumbing-code-reference.json and returns entries + a library-wide disclaimer", () => {
    const r = call("plumbing", "codeReference", {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.entries) && r.result.entries.length >= 4,
      "expected at least 4 seeded plumbing code-reference entries");
    assert.equal(r.result.total, r.result.entries.length);
    assert.ok(typeof r.result.disclaimer === "string" && r.result.disclaimer.length > 20,
      "expected a non-trivial library-wide disclaimer field");
    assert.ok(Array.isArray(r.result.categories) && r.result.categories.length > 0);
  });

  it("every entry has a paraphrased summary, a per-entry disclaimer, and either a real citation or an honest general-pattern flag", () => {
    const r = call("plumbing", "codeReference", {});
    for (const e of r.result.entries) {
      assert.ok(e.id, "entry missing id");
      assert.ok(e.category, `entry ${e.id} missing category`);
      assert.ok(typeof e.summary === "string" && e.summary.length > 40,
        `entry ${e.id} missing a substantive paraphrased summary`);
      assert.ok(typeof e.disclaimer === "string" && e.disclaimer.length > 20,
        `entry ${e.id} missing its own disclaimer field`);
      // Honesty contract: either a real citation string, or an explicit
      // general-pattern flag with citation:null — never a citation that's
      // silently absent without being marked as such.
      if (e.citation === null) {
        assert.equal(e.citationConfidence, "general-pattern",
          `entry ${e.id} has citation:null but isn't flagged general-pattern`);
      } else {
        assert.ok(typeof e.citation === "string" && e.citation.length > 5,
          `entry ${e.id} has a non-null citation that isn't a real string`);
        assert.equal(e.citationConfidence, "table-cited",
          `entry ${e.id} has a citation but isn't flagged table-cited`);
      }
    }
  });

  it("filters by category", () => {
    const all = call("plumbing", "codeReference", {}).result;
    const category = all.categories[0];
    const filtered = call("plumbing", "codeReference", { category });
    assert.equal(filtered.ok, true);
    assert.ok(filtered.result.entries.length > 0);
    for (const e of filtered.result.entries) assert.equal(e.category, category);
  });

  it("never reproduces verbatim IPC/UPC table text — summaries paraphrase, they don't quote a table body", () => {
    const r = call("plumbing", "codeReference", {});
    for (const e of r.result.entries) {
      // A verbatim code excerpt would read as dense tabular/legal prose
      // ("shall", numbered subsection cross-references chained together);
      // our summaries are plain paraphrased sentences. This is a weak
      // structural check (the real guarantee is the authoring discipline
      // documented in the content file + lib header), but it does assert
      // every summary is original prose, not a pasted table fragment.
      assert.ok(!/§|subsection|shall be deemed/i.test(e.summary),
        `entry ${e.id} summary reads like quoted code-legal text, not a paraphrase`);
    }
  });
});

describe("landscaping.permit-reference — paraphrased, cited example-jurisdiction library", () => {
  it("reads content/landscaping-code-reference.json and returns entries + a library-wide disclaimer", () => {
    const r = call("landscaping", "permit-reference", {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.entries) && r.result.entries.length >= 4,
      "expected at least 4 seeded landscaping permit-reference entries");
    assert.equal(r.result.total, r.result.entries.length);
    assert.ok(typeof r.result.disclaimer === "string" && r.result.disclaimer.length > 20,
      "expected a non-trivial library-wide disclaimer field");
    assert.ok(Array.isArray(r.result.jurisdictions) && r.result.jurisdictions.length > 0);
    assert.ok(Array.isArray(r.result.categories) && r.result.categories.length > 0);
  });

  it("every entry has a paraphrased summary, a per-entry disclaimer, a named jurisdiction, and either a real citation or an honest general-pattern flag", () => {
    const r = call("landscaping", "permit-reference", {});
    for (const e of r.result.entries) {
      assert.ok(e.id, "entry missing id");
      assert.ok(typeof e.jurisdiction === "string" && e.jurisdiction.length > 2,
        `entry ${e.id} missing a named jurisdiction`);
      assert.ok(typeof e.summary === "string" && e.summary.length > 40,
        `entry ${e.id} missing a substantive paraphrased summary`);
      assert.ok(typeof e.disclaimer === "string" && e.disclaimer.length > 20,
        `entry ${e.id} missing its own disclaimer field`);
      const ALLOWED_CONFIDENCE = ["named-ordinance", "named-program", "general-pattern"];
      assert.ok(ALLOWED_CONFIDENCE.includes(e.citationConfidence),
        `entry ${e.id} has an unrecognized citationConfidence "${e.citationConfidence}"`);
      if (e.citation === null) {
        // No citation at all must be honestly flagged general-pattern —
        // never silently absent.
        assert.equal(e.citationConfidence, "general-pattern",
          `entry ${e.id} has citation:null but isn't flagged general-pattern`);
      } else {
        assert.ok(typeof e.citation === "string" && e.citation.length > 5,
          `entry ${e.id} has a non-null citation that isn't a real string`);
      }
    }
  });

  it("filters by jurisdiction and by category", () => {
    const all = call("landscaping", "permit-reference", {}).result;
    const jurisdiction = all.jurisdictions[0];
    const byJurisdiction = call("landscaping", "permit-reference", { jurisdiction });
    assert.equal(byJurisdiction.ok, true);
    assert.ok(byJurisdiction.result.entries.length > 0);
    for (const e of byJurisdiction.result.entries) assert.equal(e.jurisdiction, jurisdiction);

    const category = all.categories[0];
    const byCategory = call("landscaping", "permit-reference", { category });
    assert.equal(byCategory.ok, true);
    for (const e of byCategory.result.entries) assert.equal(e.category, category);
  });
});
