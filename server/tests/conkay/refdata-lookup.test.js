/**
 * SX-XC-03 refdata.lookup tests.
 *
 * The catalogue reference case is the spine: a forged value at a real
 * locator is rejected. A value is served only when the SXE-41 store's
 * literal re-find locates it in the record's content, and it rides
 * with the record's provenance.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import { createRefdataStore } from "../../lib/conkay/refdata/store.js";
import { lookupRun } from "../../lib/conkay/physics/solvers/refdata-lookup.js";
import "../../lib/conkay/physics/solvers/refdata-lookup.js";

const EXCERPT = "Table 3.6.2.b — 6061-T6: Fty 40 ksi (276 MPa), Ftu 45 ksi (310 MPa) at RT.";

function seededStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refdata-lookup-"));
  const store = createRefdataStore({ dir });
  const { record: rec } = store.put({
    content: EXCERPT,
    sourceUrl: "https://example.mil/MIL-HDBK-5J/table-3.6.2.b",
    licence: "public domain",
    retrievedVia: "test",
  });
  return { store, rec };
}

const runWith = (store, inputs) => {
  const solver = getSolver("refdata.lookup");
  return envelope(solver, "value", lookupRun({ inputs }, "value", store), { runtimeMs: 1 });
};

test("registered at L1 with declared regime, units, tolerance", () => {
  const solver = getSolver("refdata.lookup");
  assert.ok(solver);
  assert.equal(solver.fidelity, 1);
  assert.ok(solver.regime && solver.units && solver.tolerance);
});

test("value re-found at its locator → PASS with the record's provenance", () => {
  const { store, rec } = seededStore();
  const r = runWith(store, { recordId: rec.id, literal: "276 MPa" });
  assert.equal(r.status, "PASS");
  assert.equal(r.outputs.found, true);
  assert.equal(r.outputs.occurrences, 1);
  assert.equal(r.outputs.sha256, rec.sha256);
  assert.equal(r.outputs.sourceUrl, rec.sourceUrl);
  assert.equal(r.outputs.licence, "public domain");
});

test("reference case: forged value at a real locator → NOT_COMPUTED, never served", () => {
  const { store, rec } = seededStore();
  const r = runWith(store, { recordId: rec.id, literal: "999 MPa" });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("refdata_value_not_found"));
  assert.deepEqual(r.outputs, {});
});

test("lookup by sourceUrl resolves the same record; absent record → refdata_not_found", () => {
  const { store, rec } = seededStore();
  const byUrl = runWith(store, { sourceUrl: rec.sourceUrl, literal: "310 MPa" });
  assert.equal(byUrl.status, "PASS");
  const absent = runWith(store, { recordId: "deadbeef".repeat(4), literal: "276 MPa" });
  assert.equal(absent.status, "NOT_COMPUTED");
  assert.ok(absent.reason.startsWith("refdata_not_found"));
});

test("missing inputs name the field (SC-03)", () => {
  const { store } = seededStore();
  assert.ok(runWith(store, { literal: "x" }).reason.startsWith("missing_input:recordId"));
  assert.ok(runWith(store, { recordId: "abc" }).reason.startsWith("missing_input:literal"));
});
