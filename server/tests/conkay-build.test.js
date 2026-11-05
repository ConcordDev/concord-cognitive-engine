// build(conkay) — the study-lifecycle fixes around the (untouched) solver:
//  - F12a: kept-state attaches to the STUDY, not the solve. beamStudy used
//    to write the study record fresh with dtuId:null on every solve, so an
//    identical re-solve disowned the kept DTU. The solver is deterministic:
//    a re-solve with identical inputs IS the solve the DTU records, so the
//    id carries over; any input change starts unkept.
//  - S-CK-6: dtuSearchHaystack matches a DTU by its own id (the Vault's
//    search could never find a kept DTU by the id the strip displays).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};

const { default: registerEngineeringActions } = await import("../domains/engineering.js");
const { dtuSearchHaystack, dtuMatchesQuery } = await import("../lib/dtu-list-source.js");

const handlers = new Map();
registerEngineeringActions((domain, action, fn) => handlers.set(`${domain}.${action}`, fn));
const run = (action, params, userId = "ck-user") =>
  handlers.get(`engineering.${action}`)({ actor: { userId } }, { data: {} }, params);

const DIMS = { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 };
const BASE = { dims: DIMS, material: "steel-a992", support: "simply-supported", loadN: 200000, name: "Kept beam" };

describe("beamStudy kept-state (F12a)", () => {
  let jobId;
  before(() => {
    const r = run("beamStudy", BASE);
    assert.equal(r.ok, true);
    assert.equal(r.result.dtuId, null);
    jobId = r.result.jobId;
  });

  it("keep attaches the DTU to the current study", () => {
    const k = run("beamStudy-keep", { jobId, dtuId: "dtu_ck_test_1" });
    assert.equal(k.ok, true);
    const got = run("beamStudy-get", {});
    assert.equal(got.result.study.dtuId, "dtu_ck_test_1");
  });

  it("an identical re-solve keeps the DTU (same study, deterministic solve)", () => {
    const r = run("beamStudy", BASE);
    assert.equal(r.ok, true);
    assert.notEqual(r.result.jobId, jobId);
    assert.equal(r.result.dtuId, "dtu_ck_test_1");
    const got = run("beamStudy-get", {});
    assert.equal(got.result.study.dtuId, "dtu_ck_test_1");
  });

  it("a changed input starts unkept", () => {
    const r = run("beamStudy", { ...BASE, dims: { ...DIMS, webThickness: 10 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.dtuId, null);
    const got = run("beamStudy-get", {});
    assert.equal(got.result.study.dtuId, null);
  });
});

describe("DTU search matches by id (S-CK-6)", () => {
  const dtu = { id: "dtu_6e443d7bbb6b98342082", title: "I-beam study — kept solve", tags: ["conkay"] };
  it("the haystack carries the id", () => {
    assert.ok(dtuSearchHaystack(dtu).includes("dtu_6e443d7bbb6b98342082"));
  });
  it("a query for the id matches; an unrelated query does not", () => {
    assert.equal(dtuMatchesQuery(dtu, "dtu_6e443d7"), true);
    assert.equal(dtuMatchesQuery(dtu, "unrelated-term"), false);
  });
});
