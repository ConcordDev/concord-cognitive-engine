// FIX-healthcare-011 — patient list order must be deterministic.
//
// patients-list sorted by lastName ONLY: patients sharing a last name
// (families, same-name charts) kept insertion order, so the list read
// as unordered — the walk's "order not by MRN or name". The sort now
// falls through lastName → firstName → MRN. (The panel also gained a
// Name/MRN sort control; the badge's filtered-of-total count was
// fixed separately in be65ac94ae.)
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("healthcare patients-list order (FIX-healthcare-011)", () => {
  let ctx;
  before(async () => {
    ctx = await depthCtx("healthcare-patients-order");
    await lensRun("healthcare", "patients-create", { params: { firstName: "Zoe", lastName: "Smith" } }, ctx);
    await lensRun("healthcare", "patients-create", { params: { firstName: "Ann", lastName: "Smith" } }, ctx);
    await lensRun("healthcare", "patients-create", { params: { firstName: "Bob", lastName: "Adams" } }, ctx);
  });

  it("orders by lastName, then firstName, regardless of insertion order", async () => {
    const r = await lensRun("healthcare", "patients-list", { params: {} }, ctx);
    assert.equal(r.ok, true);
    const names = r.result.patients.map((p) => `${p.lastName},${p.firstName}`);
    assert.deepEqual(names, ["Adams,Bob", "Smith,Ann", "Smith,Zoe"]);
  });

  it("search still filters by name/MRN substring", async () => {
    const r = await lensRun("healthcare", "patients-list", { params: { q: "smith" } }, ctx);
    assert.equal(r.result.patients.length, 2);
  });
});
