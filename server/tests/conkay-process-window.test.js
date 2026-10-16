// Blend D brief item 8: processing window.
// Sources (excerpts in sources.js): MOL TIPELIN HDPE catalogue 2023 p.9 (melt windows: extrusion 170–220 °C, blow
// moulding 180–220 °C, film 200–220 °C) and p.7 (OIT at 200 °C, EN 728: 7 to >120 min by grade); Evgin et al.
// 2020 Table 3 (neat HDPE T5% 440.77 °C in nitrogen); HDPE melting 130–134.73 °C (constituent table).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processWindow, HDPE_MELT_WINDOWS, HDPE_OIT_200C_MIN, HDPE_T5_N2_C } from "../lib/conkay/knowledge/process-window.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText } from "../lib/conkay/knowledge/material-ir.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

describe("sourced ranges", () => {
  it("the melt windows, OIT range and inert onset are the ones printed in the cited documents", () => {
    const mol = DOCUMENTS["mol-hdpe-catalogue-2023-processing"].excerpt;
    assert.ok(mol.includes("Recommended melt temperatures are 180–220°C"));
    assert.ok(mol.includes("melt temperatures of 200–220°C are recommended"));
    assert.ok(mol.includes("Recommended processing temperatures are 170–220°C for extrusion"));
    assert.deepEqual(HDPE_MELT_WINDOWS.map((w) => [w.lowC, w.highC]), [[170, 220], [180, 220], [200, 220]]);
    assert.ok(mol.includes("8, 40, 90, 8, 7, 30, 90, 30, 105, 50, >100, 120, >120"));
    assert.deepEqual([HDPE_OIT_200C_MIN.low, HDPE_OIT_200C_MIN.high], [7, 120]);
    assert.ok(DOCUMENTS["evgin-2020-bjnano-tga"].excerpt.includes("T5% 440.77 °C"));
    assert.ok(DOCUMENTS["evgin-2020-bjnano-tga"].excerpt.includes("under a nitrogen atmosphere"));
    assert.equal(HDPE_T5_N2_C, 440.77);
  });
});

describe("processWindow", () => {
  it("200 °C: molten, inside every window; 'cure' is flagged; dispersion, attrition and residence time are not computed", () => {
    const r = processWindow({ temperatureC: 200, statedAs: "Cure temperature: 200°C —" });
    assert.ok(r.checks.every((c) => c.pass));
    assert.ok(r.warnings.some((w) => /'cure' is a thermoset term/.test(w)));
    assert.ok(r.warnings.some((w) => /MFI is a test \(ASTM D1238\), no number is predicted/.test(w)));
    assert.equal(r.notComputed.length, 3);
  });
  it("out of window is a warning, never a pass; below the melting range fails the melt check", () => {
    const hot = processWindow({ temperatureC: 240 });
    assert.equal(hot.checks.find((c) => c.id === "in-melt-window").pass, false);
    assert.ok(hot.warnings.some((w) => /out of the sourced HDPE melt window/.test(w)));
    const film = processWindow({ temperatureC: 190, process: "film" });
    assert.equal(film.checks.find((c) => c.id === "in-melt-window").pass, false);
    const cold = processWindow({ temperatureC: 125 });
    assert.equal(cold.checks.find((c) => c.id === "above-melting").pass, false);
  });
  it("a stated residence time at ≥ 200 °C is set against the OIT range; a missing temperature is refused", () => {
    const r = processWindow({ temperatureC: 210, residenceTimeMin: 15 });
    assert.ok(r.warnings.some((w) => /residence 15 min at 210 °C vs HDPE oxidation induction times of 7–120\+ min/.test(w)));
    assert.equal(r.notComputed.length, 2);
    assert.throws(() => processWindow({}), /temperature/);
  });
});

describe("process.window", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const ir = materialIrFromText(text, meta);
  const run = (props = {}) => openDesign({ nodes: [{ id: "B", kind: "Material", props: { formulation: ir, ...props } }] }).session.result("process.window@B");
  it("is registered with its declared regime, units, tolerance and screening", () => {
    const s = listSolvers().find((x) => x.id === "process.window");
    for (const k of ["regime", "units", "tolerance"]) assert.ok(s?.[k], k);
  });
  it("Blend D: reads the stated 200 °C 'cure' from the formulation (line 9); WARN with the flags and the missing process record", () => {
    assert.equal(ir.process.steps[0].temperatureC, 200);
    const r = run();
    assert.equal(r.status, "WARN");
    assert.match(r.inputs.temperatureC.source, /line 9/);
    assert.ok(r.warnings.some((w) => /thermoset term/.test(w)));
    assert.ok(r.outputs.missingProcessRecord.value.some((m) => /residence time/.test(m)));
  });
  it("a stated temperature below melting FAILs; above the windows WARNs", () => {
    assert.equal(run({ process: { temperatureC: 120 } }).status, "FAIL");
    const hot = run({ process: { temperatureC: 250 } });
    assert.equal(hot.status, "WARN");
    assert.ok(hot.warnings.some((w) => /out of the sourced HDPE melt window/.test(w)));
  });
});
