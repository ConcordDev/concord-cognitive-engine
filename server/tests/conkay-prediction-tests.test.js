// Blend D brief item 10: every registered material/process/vessel prediction maps to a laboratory test row,
// with a pass-criterion source or "criterion not set". Designations are checked against standards.js, whose
// new titles (D790, D4065, D5026, E1530, D5470, E831, G155, D7791) were read on the ASTM store pages 2026-10-16.
// ASTM D7791 scope §1.1 (store.astm.org/d7791.html): "This test method covers the determination of dynamic fatigue
// properties of plastics in uniaxial loading" — no gas environment is named, so it is not hydrogen cycling.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PREDICTION_TESTS, MEASUREMENT_ONLY, CRITERION_NOT_SET, predictionTestMatrix, STANDARDS, buildFormulationReport, loadFixture, renderLabPlan } from "../lib/conkay/knowledge/index.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { listSolvers } from "../lib/conkay/index.js";

const PREDICTING = /^(material|process|vessel)\./;
const registered = listSolvers().map((s) => s.id).filter((id) => PREDICTING.test(id));

describe("prediction → test mapping", () => {
  it("every registered material/process/vessel solver has a row, and every row is a registered solver", () => {
    assert.ok(registered.length >= 21, `${registered.length}`);
    const { rows, unmapped } = predictionTestMatrix(registered);
    assert.deepEqual(unmapped, []);
    assert.equal(rows.length, registered.length);
    assert.deepEqual(Object.keys(PREDICTION_TESTS).filter((id) => !registered.includes(id)), []);
  });

  it("every row has a test with a verified standard, and a criterion that is sourced or explicitly not set", () => {
    for (const [id, m] of Object.entries(PREDICTION_TESTS)) {
      assert.ok(m.predicts && m.tests.length, id);
      for (const t of m.tests) for (const d of t.designations) assert.ok(STANDARDS[d], `${id}: ${d}`);
      if (m.criterion.state === CRITERION_NOT_SET) assert.ok(m.criterion.reason, id);
      else assert.ok(m.criterion.text && m.criterion.source, id);
    }
    for (const r of MEASUREMENT_ONLY) for (const d of r.designations) assert.ok(STANDARDS[d], d);
  });

  it("sourced criteria point at documents on record", () => {
    const sourced = Object.entries(PREDICTION_TESTS).filter(([, m]) => m.criterion.state === "sourced");
    assert.deepEqual(sourced.map(([id]) => id).sort(), ["process.window", "vessel.burst-margin", "vessel.crash-seal-screen", "vessel.h2-permeation"]);
    for (const [, m] of sourced) {
      const ids = [...m.criterion.source.matchAll(/sources\.js ([a-z0-9-]+)/g)].map((x) => x[1]);
      assert.ok(ids.length, m.criterion.source);
      for (const d of ids) assert.ok(DOCUMENTS[d], d);
    }
    assert.ok(DOCUMENTS["un-r134-02-amend3-burst"].excerpt.includes("200 per cent NWP"));
  });

  it("covers every method the brief names", () => {
    const named = ["ASTM D792", "ASTM D638", "ASTM D790", "ASTM D256", "ISO 179-1", "ASTM D2990", "ASTM D4065", "ASTM D5026", "ASTM E1530", "ASTM D5470", "ASTM E831", "ASTM D3418", "ASTM D1238", "ASTM D5630", "ASTM E1131", "ASTM D1434", "ISO 15105-1", "CSA/ANSI CHMC 2", "ISO 11114-2", "ASTM G154", "ASTM G155", "ISO 19881", "SAE J2579", "ASTM D7791"];
    const used = new Set([...Object.values(PREDICTION_TESTS).flatMap((m) => m.tests.flatMap((t) => t.designations)), ...MEASUREMENT_ONLY.flatMap((r) => r.designations)]);
    assert.deepEqual(named.filter((d) => !used.has(d)), []);
    assert.match(STANDARDS["ASTM D7791"].note, /not hydrogen pressure cycling/);
  });

  it("the rendered lab plan carries the table and the measurement-only rows", () => {
    const { text, meta } = loadFixture("usb-blend-d");
    const md = renderLabPlan(buildFormulationReport(text, meta));
    assert.match(md, /## Predictions and the tests that replace them/);
    for (const id of registered) assert.ok(md.includes(`\`${id}\``), id);
    assert.match(md, /UN Regulation No\. 134/);
    assert.match(md, /ASTM D7791 is coupon fatigue in air/);
  });
});
