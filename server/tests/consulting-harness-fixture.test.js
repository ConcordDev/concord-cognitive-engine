// FIX-consulting-012 — the Staffing consultant list showed a leaked
// QA-harness row ("tzl02619412rx name harness value") that an earlier
// harness run had created in the shared QA account. The fleet already
// has the remedy for this exact genus (lib/harness-fixture.js, applied
// by art.js and mentorship.js): refuse fixture names at the write
// door, and keep stored fixture rows out of user-facing lists
// (read-side only — live data is never rewritten from code). These
// pins hold consulting to the same pattern: consultant-create refuses
// a harness name, staffing-plan's rows omit a pre-existing leaked row
// while real consultants remain, and the stored row itself is left
// untouched (still deletable by its owner).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/consulting.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`consulting.${name}`);
  if (!fn) throw new Error(`consulting.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "qa-1" }, userId: "qa-1" };
const HARNESS_NAME = "tzl02619412rx name harness value";

function seedLeakedRow() {
  // A real consultant first (initialises the caller's collection)…
  call("consultant-create", ctx, { name: "Real Person", role: "Strategist" });
  // …then the leaked fixture row, written straight into the caller's
  // stored collection the way the earlier harness run left it.
  const coll = globalThis._concordSTATE.consultingLens.consultants.get("qa-1");
  coll.push({ id: "con_leaked", name: HARNESS_NAME, role: "Consultant", weeklyCapacity: 40, costRate: 0, createdAt: "2026-11-01T00:00:00.000Z" });
}

describe("FIX-consulting-012 harness fixture hygiene", () => {
  it("consultant-create refuses a harness-fixture name", () => {
    const r = call("consultant-create", ctx, { name: HARNESS_NAME });
    assert.equal(r.ok, false);
    assert.match(r.error, /test-harness value/);
  });

  it("staffing-plan omits the leaked fixture row but keeps real consultants", () => {
    seedLeakedRow();
    const r = call("staffing-plan", ctx, {});
    assert.equal(r.ok, true);
    const names = r.result.rows.map((x) => x.name);
    assert.deepEqual(names, ["Real Person"]);
    assert.equal(r.result.consultants, 1);
  });

  it("the stored fixture row is NOT rewritten or deleted by the read filter", () => {
    seedLeakedRow();
    call("staffing-plan", ctx, {});
    const stored = globalThis._concordSTATE.consultingLens.consultants.get("qa-1");
    assert.equal(stored.length, 2);
    assert.equal(stored[1].name, HARNESS_NAME);
    // …and its owner can still remove it deliberately.
    const del = call("consultant-delete", ctx, { id: "con_leaked" });
    assert.equal(del.ok, true);
  });

  it("ordinary names that merely resemble the fingerprint shape are unaffected", () => {
    const r = call("consultant-create", ctx, { name: "Tzvi Adler" });
    assert.equal(r.ok, true);
    const plan = call("staffing-plan", ctx, {});
    assert.deepEqual(plan.result.rows.map((x) => x.name), ["Tzvi Adler"]);
  });
});
