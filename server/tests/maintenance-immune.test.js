// Maintenance B + D — the immune-loop wiring.
//
// B: the maintenance-gates detector maps a gate's exit code to a blocking
//    critical finding, is registered, and tagged for the repair-cortex consumer
//    (so it auto-joins the Prophet detector pass that turns findings into issues).
// D: the schema_drift ERROR_PATTERN matches "no such column" and is proposeOnly
//    (the Surgeon proposes a rename/migration, never auto-applies).
//
// Run: node --test tests/maintenance-immune.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gateFinding } from "../lib/detectors/maintenance-gates-detector.js";
import { listDetectors, getDetector } from "../lib/detectors/index.js";
import { ERROR_PATTERNS } from "../emergent/repair-cortex.js";

describe("B — maintenance-gates detector", () => {
  const gate = { name: "schema-drift", script: "scripts/verify-schema-drift.mjs", severity: "critical", hint: "schema_drift", message: "drift" };

  it("clean gate (exit 0) → no finding", () => {
    assert.equal(gateFinding(gate, 0), null);
  });

  it("failed gate (exit 1) → a blocking critical finding with the fix hint", () => {
    const f = gateFinding(gate, 1);
    assert.equal(f.severity, "critical");
    assert.equal(f.fixHint, "schema_drift");
    assert.equal(f.kind, "runtime");
  });

  it("finding uses the canonical { id, message, location } shape (no undefined render)", () => {
    // Regression: the finding used { title, detail, file }, so the run-detectors
    // renderer (reads f.id / f.message / f.location) printed `undefined — undefined`,
    // hiding which gate failed behind a malformed critical.
    const f = gateFinding(gate, 1);
    assert.equal(typeof f.id, "string");
    assert.ok(f.id.length > 0, "finding must carry a real id");
    assert.equal(typeof f.message, "string");
    assert.ok(f.message.includes("schema-drift"), "message names the failing gate");
    assert.equal(f.location, "scripts/verify-schema-drift.mjs");
    assert.equal(f.title, undefined, "legacy title field is gone");
    assert.equal(f.detail, undefined, "legacy detail field is gone");
  });

  it("is registered + tagged for the repair-cortex consumer", () => {
    const d = getDetector("maintenance-gates");
    assert.ok(d, "maintenance-gates is registered");
    assert.ok(d.consumers.includes("repair-cortex"), "feeds the cortex immune loop");
    assert.ok(listDetectors().some((x) => x.id === "maintenance-gates"));
  });
});

describe("D — schema_drift repair pattern (propose-only)", () => {
  it("matches a 'no such column' error and captures the column", () => {
    const p = ERROR_PATTERNS.schema_drift;
    assert.ok(p, "schema_drift pattern exists");
    const m = "SqliteError: no such column: dtus.kind".match(p.regex);
    assert.ok(m, "matches the runtime error");
    assert.equal(m[1], "dtus.kind");
  });

  it("is proposeOnly — every fix is propose-only (never auto-applies a schema change)", () => {
    const p = ERROR_PATTERNS.schema_drift;
    assert.equal(p.proposeOnly, true);
    assert.equal(p.category, "database");
    assert.ok(p.fixes.length >= 2);
    assert.ok(p.fixes.every((f) => f.proposeOnly === true));
  });
});
