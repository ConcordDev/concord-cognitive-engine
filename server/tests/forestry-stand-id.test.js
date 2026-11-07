/**
 * Stand identity (forestry S3): one definition across the whole domain.
 *
 * A stand is identified by the ID assigned at stand-add; its name is a
 * display label. Every stand reference accepts the ID or the exact name
 * and resolves to the canonical ID before it is stored or matched.
 * Actions that require an existing stand refuse an unresolvable
 * reference with a single product-worded error (the replanting form
 * previously refused the stand's name with "stand not found not found",
 * while pest-report and cruise accepted the name unchecked — three
 * contracts for one field).
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import registerForestryActions from "../domains/forestry.js";

const actions = new Map();
registerForestryActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));

globalThis._concordSTATE = {};
const ctx = { actor: { userId: "u-stand-id-test" } };
const call = async (name, params = {}) => actions.get(`forestry.${name}`)(ctx, null, params);

let standId;
const STAND_NAME = "Probe Stand S3";

before(async () => {
  const r = await call("stand-add", { name: STAND_NAME, species: "oak", acres: 12, treesPerAcre: 90 });
  assert.equal(r.ok, true);
  standId = r.result.stand.id;
  assert.match(standId, /^std_/);
});

describe("stand references resolve by name or ID", () => {
  it("activity-log accepts the stand's name", async () => {
    const r = await call("activity-log", { standId: STAND_NAME, kind: "survey", notes: "by name" });
    assert.equal(r.ok, true);
    const byId = await call("activity-log", { standId, kind: "survey", notes: "by id" });
    assert.equal(byId.ok, true);
  });

  it("activity-log refuses an unknown reference with one clean error", async () => {
    const r = await call("activity-log", { standId: "no such stand" });
    assert.equal(r.ok, false);
    assert.match(r.error, /^no stand matches "no such stand"/);
    assert.ok(!/not found not found/.test(r.error), "the doubled error text must not return");
  });

  it("replant-project-create links a project by the stand's name and stores the ID", async () => {
    const r = await call("replant-project-create", {
      name: "S3 replant", species: "oak", acres: 2, seedlingsPerAcre: 435, standId: STAND_NAME,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.project.standId, standId);
  });

  it("replant-project-create refuses a name that matches no stand, once", async () => {
    const r = await call("replant-project-create", {
      name: "S3 orphan", species: "oak", acres: 1, standId: "ghost stand",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /^no stand matches "ghost stand"/);
  });

  it("cruise plots canonicalize the name and read back by either key", async () => {
    const add = await call("cruise-plot-add", {
      standId: STAND_NAME, method: "prism_baf", expansionFactor: 10,
      trees: [{ species: "oak", dbhInches: 12, heightFeet: 60 }],
    });
    assert.equal(add.ok, true);
    assert.equal(add.result.plot.standId, standId);
    const byName = await call("cruise-plot-list", { standId: STAND_NAME });
    assert.equal(byName.result.count, 1);
    const summary = await call("cruise-summary", { standId });
    assert.equal(summary.result.plots, 1);
  });

  it("cruise plots recorded against an unregistered reference stay readable by it", async () => {
    const add = await call("cruise-plot-add", {
      standId: "Unregistered Creek", method: "prism_baf", expansionFactor: 10,
      trees: [{ species: "mixed", dbhInches: 10, heightFeet: 50 }],
    });
    assert.equal(add.ok, true);
    assert.equal(add.result.plot.standId, "Unregistered Creek");
    const list = await call("cruise-plot-list", { standId: "Unregistered Creek" });
    assert.equal(list.result.count, 1);
  });

  it("pest-report stores the canonical ID for a name reference", async () => {
    const r = await call("pest-report", { agent: "bark beetle", standId: STAND_NAME });
    assert.equal(r.ok, true);
    const report = r.result.report || r.result;
    assert.equal(report.standId, standId);
  });

  it("stand-polygon-save stores the canonical ID for a name reference", async () => {
    const r = await call("stand-polygon-save", {
      name: "S3 poly", standId: STAND_NAME,
      vertices: [{ lat: 45, lon: -122 }, { lat: 45.01, lon: -122 }, { lat: 45.01, lon: -121.99 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.polygon.standId, standId);
  });

  it("carbon-credit-issue accepts the stand's name and refuses an unknown one", async () => {
    const okR = await call("carbon-credit-issue", {
      projectName: "S3 carbon", tonsCO2: 10, vintageYear: 2026, standId: STAND_NAME,
    });
    assert.equal(okR.ok, true);
    assert.equal(okR.result.credit.standId, standId);
    const bad = await call("carbon-credit-issue", {
      projectName: "S3 carbon bad", tonsCO2: 10, vintageYear: 2026, standId: "ghost stand",
    });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /^no stand matches "ghost stand"/);
  });
});

describe("feed error shape", () => {
  it("the feed never returns the bare upstream status as its error", async () => {
    const domain = await readFile(new URL("../domains/forestry.js", import.meta.url), "utf8");
    assert.ok(!domain.includes("error: `inciweb ${r.status}`"), "bare `inciweb <status>` error must not return");
    assert.ok(domain.includes("error: `inciweb unreachable: inciweb ${r.status}`"));
  });
});
