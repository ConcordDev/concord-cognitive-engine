// server/tests/audit-browser-detail-gate.test.js
//
// Real unit tests for scripts/audit-browser-detail.mjs's pure logic — the
// parts of the "re-scan lenses that failed a11y for per-node detail" audit
// that don't require a real Chromium (unavailable in this sandbox) or a
// prior scripts/audit-browser.mjs run.
//
// scripts/audit-browser-detail.mjs was refactored to extract
// pickFailingLenses and summarizeAxeViolations as exported pure functions,
// guarded by an isMainModule check (same pattern as
// scripts/extract-macro-input-hints.mjs) — importing the module no longer
// launches a browser or reads audit/browser-audit.json as a side effect.
// These tests import the REAL script directly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pickFailingLenses, summarizeAxeViolations } from "../../scripts/audit-browser-detail.mjs";

describe("audit-browser-detail.mjs — pickFailingLenses", () => {
  it("selects only lenses with a non-empty violations array, preserving order", () => {
    const aggregate = {
      results: [
        { lens: "clean", violations: [] },
        { lens: "dirty-1", violations: [{ id: "color-contrast" }] },
        { lens: "also-clean" }, // no violations field at all
        { lens: "dirty-2", violations: [{ id: "label" }, { id: "aria-hidden-focus" }] },
      ],
    };
    assert.deepEqual(pickFailingLenses(aggregate), ["dirty-1", "dirty-2"]);
  });

  it("returns an empty array when every lens is clean", () => {
    const aggregate = { results: [{ lens: "a", violations: [] }, { lens: "b", violations: [] }] };
    assert.deepEqual(pickFailingLenses(aggregate), []);
  });

  it("does not throw on a malformed aggregate with no results array", () => {
    assert.deepEqual(pickFailingLenses({}), []);
  });

  it("treats a null violations field as non-failing (not a crash)", () => {
    const aggregate = { results: [{ lens: "a", violations: null }, { lens: "b", violations: [{ id: "x" }] }] };
    assert.deepEqual(pickFailingLenses(aggregate), ["b"]);
  });
});

describe("audit-browser-detail.mjs — summarizeAxeViolations", () => {
  it("shapes a real axe-core violations array into id/impact + per-node target/html/failureSummary", () => {
    const axeViolations = [
      {
        id: "color-contrast",
        impact: "serious",
        help: "Elements must meet minimum color contrast ratio",
        nodes: [
          { target: [".btn-primary"], html: "<button class=\"btn-primary\">Go</button>", failureSummary: "Fix: contrast 2.1, needs 4.5" },
          { target: [".btn-secondary"], html: "<button class=\"btn-secondary\">Cancel</button>", failureSummary: "Fix: contrast 1.8, needs 4.5" },
        ],
      },
      {
        id: "label",
        impact: "critical",
        nodes: [{ target: ["input#email"], html: "<input id=\"email\">", failureSummary: "Form element does not have an implicit or explicit label" }],
      },
    ];
    const out = summarizeAxeViolations(axeViolations);
    assert.equal(out.length, 2);
    assert.equal(out[0].id, "color-contrast");
    assert.equal(out[0].impact, "serious");
    assert.equal(out[0].nodes.length, 2);
    assert.deepEqual(out[0].nodes[0], {
      target: [".btn-primary"],
      html: "<button class=\"btn-primary\">Go</button>",
      failureSummary: "Fix: contrast 2.1, needs 4.5",
    });
    assert.equal(out[1].id, "label");
    assert.equal(out[1].nodes[0].target[0], "input#email");
  });

  it("returns an empty array for an empty/undefined/null violations input (never throws)", () => {
    assert.deepEqual(summarizeAxeViolations([]), []);
    assert.deepEqual(summarizeAxeViolations(undefined), []);
    assert.deepEqual(summarizeAxeViolations(null), []);
  });

  it("handles a violation with an empty nodes array", () => {
    const out = summarizeAxeViolations([{ id: "x", impact: "minor", nodes: [] }]);
    assert.deepEqual(out, [{ id: "x", impact: "minor", nodes: [] }]);
  });
});
