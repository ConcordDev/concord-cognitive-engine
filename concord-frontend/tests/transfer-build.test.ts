// Source pins for the Transfer build. Behavioural proof lives server-side
// (transfer-build.test.js for dedup; the extraction harness for the
// server.js macros); these pins assert the FE shapes the slices require —
// rendered results instead of JSON, one ledger, the receipt, the claim
// completions, and the fleet-pattern closures.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, "..", rel), "utf8");

const page = read("app/lenses/transfer/page.tsx");
const etl = read("components/transfer/EtlWorkbench.tsx");
const analysis = read("components/transfer/TransferAnalysisPanel.tsx");
const saveBtn = read("components/dtu/SaveAsDtuButton.tsx");
const cdc = read("components/common/CrossDomainConnections.tsx");

describe("S-TR-1 — the door answers, rendered", () => {
  it("Results never renders the raw wire format", () => {
    assert.ok(!page.includes("JSON.stringify(results"));
    assert.ok(!page.includes("<pre"));
  });
  it("analogies render as mapping cards with their relations named", () => {
    assert.ok(page.includes("r.mapping"));
    assert.ok(page.includes("m.from"));
    assert.ok(page.includes("m.relation"));
    assert.ok(page.includes("Extracted pattern"));
    assert.ok(page.includes("From a DTU the platform holds"));
  });
  it("an honestly empty result says what was searched", () => {
    assert.ok(page.includes("Nothing the platform holds matches that pair yet"));
    assert.ok(page.includes("analogyData.scanned"));
  });
  it("classify renders its verdict with the keyword receipt", () => {
    assert.ok(page.includes("Classified as"));
    assert.ok(page.includes("Matched keywords"));
    assert.ok(page.includes("No domain keywords matched"));
  });
  it("the unwired transferKeep helper is wired onto the results", () => {
    assert.ok(page.includes("transferKeptRecord"));
    assert.ok(page.includes("KeepRecordActions"));
    assert.ok(page.includes("Keep these analogies"));
  });
});

describe("S-TR-3 — one ledger", () => {
  it("the Analogies surface reads the ETL run log as well as the pattern history", () => {
    assert.ok(page.includes("'run-log'"));
    assert.ok(page.includes("historyEntries"));
  });
  it("stats count both stores under scope-honest labels", () => {
    assert.ok(page.includes("Completed (syncs + pattern transfers)"));
    assert.ok(page.includes("Rows Moved (ETL syncs)"));
    assert.ok(page.includes("Domains (pattern transfers)"));
  });
  it("history lists syncs with their dedup counts", () => {
    assert.ok(page.includes("duplicates skipped"));
  });
});

describe("S-TR-2 + D1 — the receipt in the workbench", () => {
  it("the sync flash carries the full receipt", () => {
    assert.ok(etl.includes("already at destination (skipped)"));
    assert.ok(etl.includes("rows at destination"));
    assert.ok(etl.includes("run ${run.id}"));
  });
  it("run rows show skipped and destination counts", () => {
    assert.ok(etl.includes("rowsSkippedDuplicates"));
    assert.ok(etl.includes("at destination"));
  });
  it("E-TR-1: a fully-committing, zero-quarantine sample earns the Clean run line", () => {
    assert.ok(etl.includes("Clean run."));
    assert.ok(etl.includes("dryRun.wouldQuarantine === 0 && dryRun.wouldPass === dryRun.sampled"));
  });
});

describe("S-TR-4 — claim completion (Migration)", () => {
  it("timeliness and the per-field table render; the grade rule is stated", () => {
    assert.ok(analysis.includes('label="Timeliness"'));
    assert.ok(analysis.includes("fieldReports"));
    assert.ok(analysis.includes("Per field"));
    assert.ok(analysis.includes("Grades: A above 0.9"));
    assert.ok(analysis.includes("completeness ×0.3 + accuracy ×0.3 + consistency ×0.2 + timeliness ×0.2"));
  });
  it("required is a target-field toggle with its definition on the surface", () => {
    assert.ok(analysis.includes("showRequired"));
    assert.ok(analysis.includes("the flag reads yes only when every one of them is mapped"));
  });
  it("the plan renders its order and its steps", () => {
    assert.ok(analysis.includes("migrationOrder"));
    assert.ok(analysis.includes("The plan, step by step"));
    assert.ok(analysis.includes("Migration order — the topological sort"));
  });
  it("F6: results invalidate when their inputs change", () => {
    assert.ok(analysis.includes("setCsvText(e.target.value); setQualityResult(null)"));
    assert.ok(analysis.includes("setMappingResult(null); setSourceFields"));
    assert.ok(analysis.includes("setMigrationResult(null);"));
    assert.ok(etl.includes("d.pipelineId === p.id ? null : d"));
  });
});

describe("S-TR-5 — fleet-pattern closures", () => {
  it("F12: workbench deletes are two-step and name the item", () => {
    assert.ok(etl.includes("confirmDelete"));
    assert.ok(etl.includes("Delete “{c.name}”?"));
    assert.ok(etl.includes("Delete “{p.name}”?"));
  });
  it("F11: the shared Save button reflects the store, not the mount", () => {
    assert.ok(saveBtn.includes("mine: 'true'"));
    assert.ok(saveBtn.includes("d.tags.includes(apiSource)"));
    assert.ok(saveBtn.includes("setSavedId(hit.id)"));
  });
  it("F13: connection excerpts strip markdown at normalization", () => {
    assert.ok(cdc.includes("function plainText"));
    assert.ok(cdc.includes("excerpt: r.summary ? plainText(r.summary) : r.summary"));
  });
});
