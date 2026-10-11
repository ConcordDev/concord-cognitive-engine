// USB Blend D laboratory test plan (brief 4 item 6). The document is rendered
// from the formulation report. It is not a measured result.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildFormulationReport, loadFixture, renderLabPlan, LAB_PLAN_VERSION, SPECIMEN_MINIMUM, STANDARDS,
} from "../lib/conkay/knowledge/index.js";

const { text, meta } = loadFixture("usb-blend-d");
const report = buildFormulationReport(text, meta);
const md = renderLabPlan(report);

describe("USB Blend D laboratory plan", () => {
  it("matches the committed document and names the version", () => {
    const file = readFileSync(fileURLToPath(new URL("../lib/conkay/knowledge/USB-BLEND-D-LAB-PLAN.md", import.meta.url)), "utf8");
    assert.equal(file, md);
    assert.match(md, new RegExp(`Document version ${LAB_PLAN_VERSION}`));
    assert.match(md, new RegExp(report.sourceSha256));
    assert.match(md, /69\.1177 %/);
    assert.match(md, /473\.15 K/);
    assert.match(md, /not a cure/);
  });

  it("covers every planned property and only cites verified standards", () => {
    for (const item of report.testPlan.items) {
      assert.match(md, new RegExp(`### ${item.property}`));
      for (const t of item.tests) for (const s of t.standards) {
        assert.ok(STANDARDS[s.designation], s.designation);
        assert.match(md, new RegExp(s.designation.replace(/[/.]/g, "\\$&")));
      }
    }
    for (const property of ["impact_resistance", "viscoelastic_recovery", "hydrogen_permeability", "hydrogen_compatibility", "vessel_containment", "composition_verification", "processing_temperature"]) {
      assert.match(md, new RegExp(`### ${property}`));
    }
  });

  it("sets specimen count and conditioning as plan choices, and does not invent an impact-energy limit", () => {
    assert.equal(SPECIMEN_MINIMUM.state, "plan choice");
    assert.match(md, /at least 5 of the compound and 5 of the unfilled HDPE control/);
    assert.match(md, /the source states none/);
    assert.match(md, /Impact energy has no limit in the source/);
    assert.doesNotMatch(md, /must exceed \d/);
    assert.match(md, /complete break/);
  });

  it("keeps the vessel rates at vessel level and computes the inorganic reference", () => {
    assert.match(md, /under 6 NmL\/\(h·L\) at nominal working pressure and 15 °C/);
    assert.match(md, /under 46 NmL\/\(h·L\) at 1\.15 times nominal working pressure and 55 °C/);
    assert.match(md, /do not pass 'Hydrogen stays contained'/);
    assert.match(md, /Nominal working pressure is unknown/);
    const inorganic = report.proposedVersion.fractions
      .filter((f) => /basalt|caco3|silica/i.test(f.id))
      .reduce((a, f) => a + f.units, 0) / 10000;
    assert.match(md, new RegExp(inorganic.toFixed(4)));
    assert.match(md, /graphene is not included/);
    assert.match(md, /states no tolerance/);
    assert.match(md, /marine blend cannot pass here/);
  });

  it("ties the open sentences to a criterion and leaves 'no degradation' absolute", () => {
    assert.match(md, /Hydrogen stays contained through the crash/);
    assert.match(md, /No degradation from fuel contact/);
    assert.match(md, /returns to shape/);
    assert.match(md, /without adding brittleness/);
    assert.match(md, /blistering or collapse/);
    assert.match(md, /The source allows no change and states no percentage/);
    assert.match(md, /A coupon result does not by itself pass the chamber claim/);
  });
});
