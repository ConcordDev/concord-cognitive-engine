// Cohesive R-2 phase 1 pins — server/lib/macro-access.js.
//
// The validator: every malformed shape is named (a typo'd key is a
// violation, not a silent drop; a duplicate is a violation; an
// all-empty declaration is VALID — it declares a pure macro).
// The census: the partition reconciles — declared + invalid +
// undeclared === total, on every fixture, including the birth state
// (nothing declared) the live registry starts from.
//
// Pure module: no server boot.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateAccessDeclaration, censusAccess } from "../lib/macro-access.js";

describe("validateAccessDeclaration", () => {
  it("accepts a full declaration and normalises nothing away", () => {
    const v = validateAccessDeclaration({ reads: ["dtus"], writes: ["dtus", "lensArtifacts"], externalIO: [] });
    assert.equal(v.ok, true);
    assert.deepEqual(v.access, { reads: ["dtus"], writes: ["dtus", "lensArtifacts"], externalIO: [] });
  });
  it("accepts an all-empty declaration — a pure macro is a real statement", () => {
    const v = validateAccessDeclaration({});
    assert.equal(v.ok, true);
    assert.deepEqual(v.access, { reads: [], writes: [], externalIO: [] });
  });
  it("names an unknown key (a typo is a violation, not a silent drop)", () => {
    const v = validateAccessDeclaration({ read: ["dtus"] });
    assert.equal(v.ok, false);
    assert.deepEqual(v.violations.map(x => x.kind), ["unknown_access_key"]);
    assert.equal(v.access, null);
  });
  it("names a non-array list, a non-string entry, and a duplicate", () => {
    assert.deepEqual(
      validateAccessDeclaration({ reads: "dtus" }).violations.map(x => x.kind),
      ["access_list_not_array"],
    );
    assert.deepEqual(
      validateAccessDeclaration({ writes: [42] }).violations.map(x => x.kind),
      ["access_entry_not_named"],
    );
    assert.deepEqual(
      validateAccessDeclaration({ reads: ["dtus", "dtus"] }).violations.map(x => x.kind),
      ["access_entry_duplicate"],
    );
  });
  it("refuses a non-object declaration outright", () => {
    assert.equal(validateAccessDeclaration("dtus").ok, false);
    assert.equal(validateAccessDeclaration(null).ok, false);
    assert.equal(validateAccessDeclaration(["dtus"]).ok, false);
  });
});

const registry = (entries) => {
  const macros = new Map();
  for (const [domain, name, spec] of entries) {
    if (!macros.has(domain)) macros.set(domain, new Map());
    macros.get(domain).set(name, { fn: () => {}, ...(spec !== undefined ? { spec } : {}) });
  }
  return macros;
};

describe("censusAccess — the partition reconciles", () => {
  it("birth state: nothing declared, everything undeclared, reconciled", () => {
    const c = censusAccess(registry([
      ["dtu", "create", {}], ["dtu", "update", {}], ["code", "exec", undefined],
    ]));
    assert.deepEqual(
      { total: c.total, declared: c.declared, invalid: c.invalid, undeclared: c.undeclared },
      { total: 3, declared: 0, invalid: 0, undeclared: 3 },
    );
    assert.deepEqual(c.violations, []);
  });
  it("partitions declared / invalid / undeclared and locates the invalid", () => {
    const c = censusAccess(registry([
      ["dtu", "create", { access: { reads: ["dtus"], writes: ["dtus"] } }],
      ["dtu", "update", { access: { read: ["dtus"] } }],
      ["lens", "list", {}],
      ["lens", "create", { access: {} }],
    ]));
    assert.deepEqual(
      { total: c.total, declared: c.declared, invalid: c.invalid, undeclared: c.undeclared },
      { total: 4, declared: 2, invalid: 1, undeclared: 1 },
    );
    assert.equal(c.declared + c.invalid + c.undeclared, c.total);
    assert.equal(c.violations.length, 1);
    assert.equal(c.violations[0].domain, "dtu");
    assert.equal(c.violations[0].name, "update");
    assert.equal(c.violations[0].kind, "unknown_access_key");
  });
  it("rolls up per domain, reconciled per domain too", () => {
    const c = censusAccess(registry([
      ["dtu", "create", { access: { writes: ["dtus"] } }],
      ["dtu", "get", {}],
      ["code", "exec", { access: { externalIO: ["http:example"] } }],
    ]));
    assert.deepEqual(c.byDomain.get("dtu"), { total: 2, declared: 1, invalid: 0, undeclared: 1 });
    assert.deepEqual(c.byDomain.get("code"), { total: 1, declared: 1, invalid: 0, undeclared: 0 });
  });
  it("a missing registry reports no_registry and zero counts, never throws", () => {
    const c = censusAccess(null);
    assert.equal(c.total, 0);
    assert.equal(c.violations[0].kind, "no_registry");
  });
});
