// server/tests/audit-browser-gate.test.js
//
// Real unit tests for scripts/audit-browser.mjs's pure logic — the parts of
// the axe-core/console/network/responsive browser audit that don't require
// a real Chromium (unavailable in this sandbox: no /opt/pw-browsers
// binary) or a running frontend dev server.
//
// scripts/audit-browser.mjs was refactored to extract listLenses,
// selectLensesToScan, buildAggregate, and buildMarkdownReport as exported
// pure functions, guarded by an isMainModule check (the same pattern
// scripts/extract-macro-input-hints.mjs already uses) — importing the
// module no longer launches a browser as a side effect. These tests import
// the REAL script directly and exercise its actual aggregation + report
// logic against synthetic (but shaped like the real Playwright output)
// per-lens results, plus a real filesystem fixture for listLenses.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  listLenses,
  selectLensesToScan,
  buildAggregate,
  buildMarkdownReport,
  VIEWPORTS,
} from "../../scripts/audit-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function makeLensResult(lens, overrides = {}) {
  return {
    lens,
    ok: true,
    violations: [],
    consoleErrors: [],
    networkErrors: [],
    viewports: { mobile: { horizontalOverflow: false, overflowPx: 0 } },
    ...overrides,
  };
}

describe("audit-browser.mjs — VIEWPORTS", () => {
  it("declares the three canonical breakpoints in mobile/tablet/desktop order", () => {
    assert.deepEqual(
      VIEWPORTS.map((v) => v.name),
      ["mobile", "tablet", "desktop"]
    );
    assert.equal(VIEWPORTS[0].width, 375);
    assert.equal(VIEWPORTS[2].width, 1440);
  });
});

describe("audit-browser.mjs — listLenses", () => {
  it("returns real lens directories sorted, excluding Next.js dynamic-route dirs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-browser-lenses-"));
    try {
      fs.mkdirSync(path.join(root, "zebra"));
      fs.mkdirSync(path.join(root, "alpha"));
      fs.mkdirSync(path.join(root, "[dynamicSlug]"));
      fs.writeFileSync(path.join(root, "not-a-dir.txt"), "x");
      const lenses = listLenses(root);
      assert.deepEqual(lenses, ["alpha", "zebra"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("against the real repo tree, returns a large sorted lens list with no bracketed dirs", () => {
    const lenses = listLenses(path.join(REPO_ROOT, "concord-frontend", "app", "lenses"));
    assert.ok(lenses.length > 100, `expected >100 real lenses, got ${lenses.length}`);
    assert.ok(lenses.every((l) => !l.startsWith("[")));
    const sorted = [...lenses].sort();
    assert.deepEqual(lenses, sorted);
  });
});

describe("audit-browser.mjs — selectLensesToScan", () => {
  const lenses = ["a", "b", "c", "d", "e"];

  it("with no --max= flag, returns every lens", () => {
    assert.deepEqual(selectLensesToScan(lenses, []), lenses);
  });

  it("with --max=2, returns only the first 2", () => {
    assert.deepEqual(selectLensesToScan(lenses, ["--max=2"]), ["a", "b"]);
  });

  it("with --max=0, returns an empty scan list", () => {
    assert.deepEqual(selectLensesToScan(lenses, ["--max=0"]), []);
  });

  it("with an unparseable --max= value, falls back to scanning everything", () => {
    assert.deepEqual(selectLensesToScan(lenses, ["--max=notanumber"]), lenses);
  });

  it("with --max= larger than the list, returns the whole list (no out-of-range crash)", () => {
    assert.deepEqual(selectLensesToScan(lenses, ["--max=999"]), lenses);
  });
});

describe("audit-browser.mjs — buildAggregate", () => {
  it("counts clean lenses correctly: 0 violations/errors across the board", () => {
    const results = [makeLensResult("clean-a"), makeLensResult("clean-b")];
    const agg = buildAggregate(results);
    assert.equal(agg.lensesScanned, 2);
    assert.equal(agg.lensesWithA11yViolations, 0);
    assert.equal(agg.lensesWithConsoleErrors, 0);
    assert.equal(agg.lensesWithNetworkErrors, 0);
    assert.equal(agg.lensesWithMobileOverflow, 0);
    assert.equal(agg.totalA11yViolations, 0);
    assert.deepEqual(agg.topViolationIds, {});
  });

  it("tallies a11y violations, console errors, network errors, and mobile overflow per lens", () => {
    const results = [
      makeLensResult("dirty-a", {
        violations: [{ id: "color-contrast", impact: "serious", help: "Contrast too low", nodes: 3 }],
        consoleErrors: ["TypeError: x is not a function"],
        networkErrors: [{ url: "/api/foo", error: "net::ERR_ABORTED" }],
        viewports: { mobile: { horizontalOverflow: true, overflowPx: 42 } },
      }),
      makeLensResult("dirty-b", {
        violations: [
          { id: "color-contrast", impact: "serious", help: "Contrast too low", nodes: 2 },
          { id: "label", impact: "critical", help: "Form field has no label", nodes: 1 },
        ],
      }),
      makeLensResult("clean-c"),
    ];
    const agg = buildAggregate(results);
    assert.equal(agg.lensesScanned, 3);
    assert.equal(agg.lensesWithA11yViolations, 2);
    assert.equal(agg.lensesWithConsoleErrors, 1);
    assert.equal(agg.lensesWithNetworkErrors, 1);
    assert.equal(agg.lensesWithMobileOverflow, 1);
    assert.equal(agg.totalA11yViolations, 3); // 1 violation object on dirty-a + 2 on dirty-b
    assert.equal(agg.totalA11yNodes, 3 + 2 + 1);
    assert.equal(agg.totalConsoleErrors, 1);
    // topViolationIds aggregates across lenses by rule id
    assert.equal(agg.topViolationIds["color-contrast"].lensCount, 2);
    assert.equal(agg.topViolationIds["color-contrast"].totalNodes, 3 + 2);
    assert.equal(agg.topViolationIds["label"].lensCount, 1);
    assert.equal(agg.topViolationIds["label"].totalNodes, 1);
  });

  it("stamps a real ISO generatedAt timestamp and preserves the raw results array", () => {
    const results = [makeLensResult("only")];
    const agg = buildAggregate(results);
    assert.ok(!Number.isNaN(Date.parse(agg.generatedAt)));
    assert.equal(agg.results, results);
  });
});

describe("audit-browser.mjs — buildMarkdownReport", () => {
  it("renders the summary counts and a top-violations table row for each rule", () => {
    const results = [
      makeLensResult("dirty-a", {
        violations: [{ id: "color-contrast", impact: "serious", help: "Contrast too low", nodes: 3 }],
        consoleErrors: ["boom"],
      }),
      makeLensResult("clean-b"),
    ];
    const agg = buildAggregate(results);
    const md = buildMarkdownReport(agg);
    assert.match(md, /Lenses with a11y violations: \*\*1\*\*/);
    assert.match(md, /Lenses with console errors: \*\*1\*\*/);
    assert.match(md, /`color-contrast`/);
    assert.match(md, /`dirty-a`/);
  });

  it("ranks lenses by total issue count (worst lens first)", () => {
    const results = [
      makeLensResult("mild", { violations: [{ id: "x", impact: "minor", help: "h", nodes: 1 }] }),
      makeLensResult(
        "severe",
        {
          violations: [
            { id: "x", impact: "minor", help: "h", nodes: 1 },
            { id: "y", impact: "critical", help: "h2", nodes: 1 },
          ],
          consoleErrors: ["a", "b"],
        }
      ),
    ];
    const agg = buildAggregate(results);
    const md = buildMarkdownReport(agg);
    const severeIdx = md.indexOf("`severe`");
    const mildIdx = md.indexOf("`mild`");
    assert.ok(severeIdx > -1 && mildIdx > -1);
    assert.ok(severeIdx < mildIdx, "the lens with more total issues should be ranked first");
  });

  it("shows a mobile-overflow px value only when overflow was detected", () => {
    const results = [
      makeLensResult("overflowing", { viewports: { mobile: { horizontalOverflow: true, overflowPx: 88 } } }),
    ];
    const md = buildMarkdownReport(buildAggregate(results));
    assert.match(md, /88px/);
  });
});
