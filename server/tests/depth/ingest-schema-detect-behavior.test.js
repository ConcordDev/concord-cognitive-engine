// tests/depth/ingest-schema-detect-behavior.test.js
//
// Behavioral coverage for ingest.detectSchema — the Airbyte-parity gap
// closure (docs/lens-specs/ingest-capability-map.md "Genuinely missing
// (deferred)": "Schema auto-inference / column-type detection on preview").
// validateSchema's no-schema branch only lists field NAMES; detectSchema
// promotes that into real per-field column-TYPE inference (type, nullable
// %, uniqueness %, real sample values), sampled across every record so the
// inference reflects the actual distribution, not just the first row.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

test("infers a distinct, correct type per column from a consistent sample", async () => {
  const records = [
    { id: 1, name: "Alice", age: 30, active: true, joined: "2024-01-15", score: 3.5 },
    { id: 2, name: "Bob", age: 25, active: false, joined: "2024-02-20", score: 4.75 },
    { id: 3, name: "Carol", age: 41, active: true, joined: "2024-03-05", score: 2.1 },
    { id: 4, name: "Dave", age: 19, active: false, joined: "2024-04-11", score: 9.9 },
  ];
  const r = await lensRun("ingest", "detectSchema", { data: { records } });
  const res = r.result ?? r;
  assert.equal(res.recordCount, 4);
  const byField = Object.fromEntries(res.fields.map((f) => [f.field, f]));
  assert.equal(byField.id.type, "integer", "whole numbers infer as integer");
  assert.equal(byField.name.type, "string");
  assert.equal(byField.age.type, "integer");
  assert.equal(byField.active.type, "boolean");
  assert.equal(byField.joined.type, "date", "ISO-8601-shaped strings infer as date, not string");
  assert.equal(byField.score.type, "number", "decimal numbers infer as number, distinct from integer");
});

test("reports the correct nullable % for a column with missing/null values", async () => {
  const records = [
    { id: 1, email: "a@x.com" },
    { id: 2, email: null },
    { id: 3 }, // key entirely absent — also honestly counted as nullable
    { id: 4, email: "d@x.com" },
  ];
  const r = await lensRun("ingest", "detectSchema", { data: { records } });
  const res = r.result ?? r;
  const email = res.fields.find((f) => f.field === "email");
  assert.equal(email.nullCount, 2);
  assert.equal(email.nullablePct, 50);
  assert.equal(email.nonNullCount, 2);
});

test("flags a fully-unique, non-null column as a likely primary key at ~100% uniqueness", async () => {
  const records = [{ id: "u1" }, { id: "u2" }, { id: "u3" }, { id: "u4" }];
  const r = await lensRun("ingest", "detectSchema", { data: { records } });
  const res = r.result ?? r;
  const id = res.fields.find((f) => f.field === "id");
  assert.equal(id.uniqueCount, 4);
  assert.equal(id.uniquePct, 100);
  assert.equal(id.likelyPrimaryKey, true);
  assert.deepStrictEqual(res.primaryKeyCandidates, ["id"]);
});

test("does NOT flag a column with repeated values as a primary key candidate", async () => {
  const records = [{ status: "active" }, { status: "active" }, { status: "inactive" }];
  const r = await lensRun("ingest", "detectSchema", { data: { records } });
  const res = r.result ?? r;
  const status = res.fields.find((f) => f.field === "status");
  assert.equal(status.likelyPrimaryKey, false);
  assert.equal(status.uniquePct, 67); // 2 distinct / 3 non-null, rounded
});

test("honestly reports a genuinely inconsistent column as mixed, not a forced single type", async () => {
  const records = [{ val: 1 }, { val: "two" }, { val: true }];
  const r = await lensRun("ingest", "detectSchema", { data: { records } });
  const res = r.result ?? r;
  const val = res.fields.find((f) => f.field === "val");
  assert.equal(val.type, "mixed");
  assert.deepStrictEqual(val.typeBreakdown, { integer: 1, string: 1, boolean: 1 });
});

test("handles an empty records array honestly — no crash, no fabricated schema", async () => {
  const r = await lensRun("ingest", "detectSchema", { data: { records: [] } });
  const res = r.result ?? r;
  assert.equal(res.recordCount, 0);
  assert.deepStrictEqual(res.fields, []);
  assert.ok(res.message, "carries a clear explanatory message rather than silently returning nothing");
});

test("also accepts rows[] (same fallback shape as validateSchema)", async () => {
  const r = await lensRun("ingest", "detectSchema", { data: { rows: [{ a: 1 }, { a: 2 }] } });
  const res = r.result ?? r;
  assert.equal(res.recordCount, 2);
  assert.equal(res.fields.find((f) => f.field === "a").type, "integer");
});

test("sample values are real values pulled from the actual input, never fabricated", async () => {
  const records = [{ city: "NYC" }, { city: "LA" }, { city: "SF" }, { city: "NYC" }];
  const r = await lensRun("ingest", "detectSchema", { data: { records } });
  const res = r.result ?? r;
  const city = res.fields.find((f) => f.field === "city");
  assert.equal(city.sampleValues.length, 3, "distinct values only — NYC not double-counted");
  for (const v of city.sampleValues) {
    assert.ok(["NYC", "LA", "SF"].includes(v), `sample value "${v}" must come from real input data`);
  }
});

test("bounds the sample-value count at 5 even with hundreds of distinct values", async () => {
  const records = Array.from({ length: 1000 }, (_, i) => ({ code: `code_${i}` }));
  const r = await lensRun("ingest", "detectSchema", { data: { records } });
  const res = r.result ?? r;
  const code = res.fields.find((f) => f.field === "code");
  assert.equal(code.sampleValues.length, 5, "never returns more than 5 sample values");
  assert.equal(code.uniqueCount, 1000, "uniqueness is still computed over the full sample, not just the capped preview");
  for (const v of code.sampleValues) {
    assert.match(v, /^code_\d+$/, "every sample value is a real value from the generated input");
  }
});
