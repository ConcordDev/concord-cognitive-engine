// Blend D co-polymer candidates (Dutch 2026-10-16: discarded plastics) — sourced properties and every Blend D
// check rerun for each. Values quoted from the cited documents (sources.js, locator + excerpt):
//  [MBA]  MBA Polymers PP 2143 TDS (post-consumer recycled PP copolymer) p.1: Density 0.94 g/cm3; Tensile Modulus
//         1100 MPa (ISO 527); Tensile Stress at Yield 20 MPa; Flexural Modulus 900 MPa (ISO 178). p.2: Melt
//         Temperature Range 190-220 °C, Recommended 200 °C.
//  [VRD]  VERDANT RRPI1520K (post-industrial recycled PP copolymer): Density 0.902; Flexural Modulus 965-1,165 MPa.
//  [VNP]  VINPOL RRPI50Y (post-industrial recycled PP copolymer): Density 0.91; Tensile Strength at Yield 19 MPa;
//         Flexural Modulus 966 MPa.
//  [T25]  Takayama et al., Polymers 2025, 17, 2107 (PMC12349465), Table 7, Block-PP (Novatec BC03AD), 0/1/3/5
//         extrusion cycles: E 1305/1241/1190/1046 MPa; υ 0.361/0.370/0.350/0.341. Table 9: Tm 165.2/165.8/165.0/165.0 °C.
//  [EV18] VINPOL EV0218 (18 wt % VA): Density 0.935; Melting Point 87 °C; Tensile Strength at Yield 5.2 MPa;
//         Flexural Modulus 60 MPa.  [EV27] VINPOL EV0627 (26.7 wt % VA): Density 0.953; Peak Melting 72 °C;
//         1% Secant Flexural Modulus 23 MPa.
//  [R26]  Rondon et al., Dent Traumatol 2026 (PMC13356495), Table 3: EVA sheets E 33.7 / 36.8 / 20.1 MPa;
//         Poisson 0.29 ± 0.05 (all three, as printed).
// Passing these tests is not a measurement of any Blend D batch.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COPOLYMER_CANDIDATES, CANDIDATE_IDS, withCopolymerCandidate } from "../lib/conkay/knowledge/copolymer-candidates.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText, validateMaterialIr } from "../lib/conkay/knowledge/material-ir.js";
import { runCandidateChecks, renderCandidateReport } from "../lib/conkay/demos/blend-d-candidates.js";
import { listSolvers } from "../lib/conkay/index.js";

const { text, meta } = loadFixture("usb-blend-d");
const base = materialIrFromText(text, meta);
const run = runCandidateChecks();
const MPA = 1e6;
const span = (c) => [c.range ? c.range.min : c.value, c.range ? c.range.max : c.value];

describe("sourced candidate properties", () => {
  it("every claim cites documents on record, and the spans are the quoted values", () => {
    for (const id of CANDIDATE_IDS) {
      for (const c of Object.values(COPOLYMER_CANDIDATES[id].properties)) {
        assert.ok(c.evidence.length, c.id);
        for (const e of c.evidence) assert.ok(DOCUMENTS[e.document], e.document);
      }
    }
    const pp = COPOLYMER_CANDIDATES["recycled-impact-pp"].properties;
    assert.ok(DOCUMENTS["mba-pp2143-tds"].excerpt.includes("Density 0.94 g/cm3"));
    assert.ok(DOCUMENTS["vinmar-verdant-rrpi1520k"].excerpt.includes("Density 0.902 g/cm3"));
    assert.ok(DOCUMENTS["vinmar-vinpol-rrpi50y"].excerpt.includes("Density 0.91 g/cm3"));
    assert.deepEqual(span(pp.density), [902, 940]);
    assert.ok(DOCUMENTS["mba-pp2143-tds"].excerpt.includes("Flexural Modulus (23°C) 900 MPa"));
    assert.ok(DOCUMENTS["takayama-2025-polymers-pp-reuse"].excerpt.includes("E 1305 (50) / 1241 (77) / 1190 (72) / 1046 (35) MPa"));
    assert.deepEqual(span(pp.youngsModulus), [900 * MPA, 1305 * MPA]);
    assert.ok(DOCUMENTS["takayama-2025-polymers-pp-reuse"].excerpt.includes("υ 0.361 (0.017) / 0.370 (0.018) / 0.350 (0.024) / 0.341 (0.018)"));
    assert.deepEqual(span(pp.poisson), [0.341, 0.370]);
    const eva = COPOLYMER_CANDIDATES.eva.properties;
    assert.ok(DOCUMENTS["vinmar-vinpol-ev0218"].excerpt.includes("Density 0.935 g/cm3"));
    assert.ok(DOCUMENTS["vinmar-vinpol-ev0627"].excerpt.includes("Density 0.953 g/cm3"));
    assert.deepEqual(span(eva.density), [935, 953]);
    assert.ok(DOCUMENTS["rondon-2026-edt-eva-mouthguard"].excerpt.includes("Poison ratio 0.29 ± 0.05 / 0.29 ± 0.05 / 0.29 ± 0.05"));
    assert.deepEqual(span(eva.poisson), [0.24, 0.34]);
    assert.ok(eva.poisson.flags.includes("identical-across-materials"));
    assert.deepEqual(span(eva.youngsModulus), [20.1 * MPA, 60 * MPA]);
  });
  it("each candidate states its batch variability and what is unknown", () => {
    for (const id of CANDIDATE_IDS) {
      assert.match(COPOLYMER_CANDIDATES[id].variability, /measure/);
      assert.match(COPOLYMER_CANDIDATES[id].unknown, /thermal conductivity/);
    }
    assert.equal(COPOLYMER_CANDIDATES["recycled-impact-pp"].rank, "primary");
    assert.equal(COPOLYMER_CANDIDATES.eva.rank, "fallback");
  });
});

describe("withCopolymerCandidate", () => {
  it("replaces only the unidentified co-polymer, keeps the source's name, and leaves unsourced properties null", () => {
    for (const id of CANDIDATE_IDS) {
      const ir = withCopolymerCandidate(base, id);
      assert.deepEqual(validateMaterialIr(ir), []);
      const i = base.constituents.findIndex((c) => c.classId === "hdpe_hc_copolymer");
      for (const [j, c] of ir.constituents.entries()) if (j !== i) assert.deepEqual(c, base.constituents[j]);
      const c = ir.constituents[i];
      assert.equal(c.name, base.constituents[i].name);
      assert.equal(c.candidate.id, id);
      assert.match(c.candidate.basis, /does not identify the co-polymer/);
      assert.equal(c.properties.conductivity, null);
      assert.equal(c.properties.cte, null);
      assert.ok(c.properties.density.lo > 0);
    }
  });
  it("rejects an unknown candidate and a formulation without the co-polymer", () => {
    assert.throws(() => withCopolymerCandidate(base, "pvc"), /unknown co-polymer candidate/);
    const once = withCopolymerCandidate(base, "eva");
    assert.throws(() => withCopolymerCandidate(once, "eva"), /no unidentified co-polymer/);
  });
});

describe("every Blend D check rerun", () => {
  const checks = listSolvers().map((s) => s.id).filter((id) => /^(material|process)\./.test(id) && id !== "material.crystal-aggregate").concat("vessel.h2-permeation");
  it("covers every registered material/process check and the material-level hydrogen check, for each run", () => {
    for (const r of ["unidentified", ...CANDIDATE_IDS]) for (const id of checks) assert.ok(run.runs[r].results[id], `${r}: ${id}`);
  });
  it("the co-polymer's density was the blocker: with a candidate the density and volume fractions are computed, mass basis stated", () => {
    assert.equal(run.basis, "unknown");
    assert.equal(run.runs.unidentified.results["material.density-rom"].status, "NOT_COMPUTED");
    for (const id of CANDIDATE_IDS) {
      const r = run.runs[id].results["material.density-rom"];
      assert.equal(r.status, "WARN");
      assert.ok(r.warnings.some((w) => /computed as mass fractions/.test(w)));
      // independent hand formula at nominal mass fractions and density midpoints: 1/ρ = Σ w/ρ
      const ir = run.runs[id].ir, w = Object.fromEntries(ir.nominal.fractions.map((f) => [f.id, f.pct / 100]));
      const rho = 1 / ir.constituents.reduce((a, c) => a + w[c.id] / ((c.properties.density.lo + c.properties.density.hi) / 2), 0);
      assert.ok(Math.abs(r.outputs.density.value.nominal / rho - 1) < 1e-12);
      assert.ok(r.outputs.density.value.low <= rho && rho <= r.outputs.density.value.high);
      assert.equal(run.runs[id].results["material.mass-to-volume"].status, "WARN");
    }
  });
  it("with a candidate the Voigt/Reuss bounds compute; missing values (the compound's relaxation data, multi-phase models) stay NOT_COMPUTED", () => {
    assert.equal(run.runs.unidentified.results["material.modulus-bounds"].status, "NOT_COMPUTED");
    for (const id of CANDIDATE_IDS) {
      assert.equal(run.runs[id].results["material.modulus-bounds"].status, "WARN");
      assert.equal(run.runs[id].results["material.viscoelastic-prony"].status, "NOT_COMPUTED");
      assert.equal(run.runs[id].results["material.tensile-bounds"].status, "NOT_COMPUTED");
      assert.ok(run.runs[id].results["material.chemical-compatibility"].status !== "PASS");
    }
  });
  it("candidate melting against 200 °C: both melt; the PP window is MBA's 190–220 °C; EVA's window and both candidates' degradation are not computed", () => {
    const pp = run.runs["recycled-impact-pp"].melt, eva = run.runs.eva.melt;
    assert.deepEqual(pp.meltC, [165, 165.8]);
    assert.equal(pp.melts, true);
    assert.equal(pp.window.inside, true);
    assert.deepEqual(eva.meltC, [72, 87]);
    assert.equal(eva.window.inside, null);
    for (const m of [pp, eva]) assert.match(m.degradation, /not computed/);
  });
  it("the committed report is the rendered one", () => {
    const file = readFileSync(fileURLToPath(new URL("../lib/conkay/knowledge/USB-BLEND-D-COPOLYMER-CANDIDATES.md", import.meta.url)), "utf8");
    assert.equal(file, renderCandidateReport(run));
    assert.match(file, /whether the percentages are by weight or by volume/);
  });
});
