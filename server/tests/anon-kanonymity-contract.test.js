// anon-kanonymity-contract.test.js
//
// FIX-anon-002: the Privacy Lab's k-anonymity run (a) had no k control
// anywhere — the macro's params.k was silently defaulted and never
// validated; (b) generalized values by parseFloat coercion, so a ZIP
// code (a string) was bucketed as a quantity into ranges like
// "94100-94199" / "0-9999999999"; (c) read as contradictory next to the
// 100%-critical raw-data risk score. The lab now sends a chosen k, the
// macro refuses a meaningless k in words, and generalization follows
// the value's type: numbers widen into ranges, strings (codes) lose
// suffixes. These pins drive the real domain actions.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
const { default: registerAnonActions } = await import("../domains/anon.js");
const actions = new Map();
registerAnonActions((domain, action, fn) => actions.set(`${domain}.${action}`, fn));
const ctx = { userId: "u1", actor: { userId: "u1" } };

const EXAMPLE = [
  { age: 28, zipcode: "94110", condition: "Flu" },
  { age: 29, zipcode: "94110", condition: "Flu" },
  { age: 31, zipcode: "94112", condition: "Migraine" },
  { age: 34, zipcode: "94112", condition: "Asthma" },
  { age: 42, zipcode: "94115", condition: "Diabetes" },
  { age: 45, zipcode: "94115", condition: "Diabetes" },
  { age: 45, zipcode: "94117", condition: "Hypertension" },
  { age: 61, zipcode: "94117", condition: "Arthritis" },
  { age: 63, zipcode: "94118", condition: "Arthritis" },
  { age: 22, zipcode: "94103", condition: "Flu" },
];
const artifact = () => ({
  id: null,
  data: { records: EXAMPLE.map((r) => ({ ...r })), quasiIdentifiers: ["age", "zipcode"], sensitiveFields: ["condition"] },
  meta: {},
});
const anonymize = (params = {}) => actions.get("anon.anonymize")(ctx, artifact(), params);

test("zip codes generalize as prefixes, never as numeric ranges", () => {
  const r = anonymize();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.kAchieved, true);
  for (const row of r.result.anonymizedSample) {
    assert.match(String(row.zipcode), /^(\d+\*+|\*)$/, `zipcode generalized as a code: ${row.zipcode}`);
    assert.match(String(row.age), /^\d+-\d+$/, `age generalized as a quantity range: ${row.age}`);
    assert.equal(row.condition, "[REDACTED]");
  }
});

test("the chosen k is honored: k=2 needs no more generalization than k=3", () => {
  const r2 = anonymize({ k: 2 });
  const r3 = anonymize({ k: 3 });
  assert.equal(r2.result.k, 2);
  assert.equal(r2.result.kAchieved, true);
  assert.ok(r2.result.generalizationLevel <= r3.result.generalizationLevel);
});

test("a meaningless k is refused in words", () => {
  for (const bad of [1, 99, 2.5, "high"]) {
    const r = anonymize({ k: bad });
    assert.equal(r.ok, false, `k=${bad}`);
    assert.match(r.error, /k must be a whole number between 2 and 10/);
  }
});
