// Blend D brief item 2: constituent property tables with sources.
//
// Every value is a claim whose endpoints appear in the excerpt of a cited,
// registered document (with its locator); PDFs carry the sha256 of the file
// as read. The mineral fillers' temperatures replay from recorded PubChem
// responses through the knowledge layer's connector. Graphene nanoplatelets'
// supplier in-plane values and the multilayer effective values stay distinct.
// The HDPE/HC co-polymer has no properties.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONSTITUENT_PROPERTIES, UNKNOWN_PROPERTIES, constituentProperty } from "../lib/conkay/knowledge/constituent-properties.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { validateEntity } from "../lib/conkay/knowledge/validate.js";
import { loadFixture, loadConnectorRecordings, replayGetter } from "../lib/conkay/knowledge/index.js";
import { experimental } from "../lib/conkay/knowledge/connectors/pubchem.js";
import { materialIrFromText, PROPERTY_KEYS, strictDensity } from "../lib/conkay/knowledge/material-ir.js";
import { voigtReussHill, trigonalStiffness, uniaxialConductivityBounds, uniaxialCteAverage, CALCITE_KORTH, CALCITE_THERMAL, QUARTZ_CRYSTRAN, QUARTZ_THERMAL } from "../lib/conkay/knowledge/crystal-elasticity.js";

const all = Object.entries(CONSTITUENT_PROPERTIES).flatMap(([cls, t]) => Object.entries(t).map(([k, c]) => ({ cls, k, c })));
const excerpts = (c) => c.evidence.filter((e) => e.document).map((e) => DOCUMENTS[e.document].excerpt).join(" ‖ ");

describe("constituent property claims", () => {
  it("are valid claims, each citing registered documents with a locator and an excerpt", () => {
    assert.ok(all.length >= 20);
    for (const { cls, k, c } of all) {
      assert.deepEqual(validateEntity.claim(c), [], `${cls}.${k}`);
      assert.ok(c.evidence.length >= 1, `${cls}.${k}`);
      for (const e of c.evidence) {
        if (e.kind === "calculation") { assert.match(e.receiptRef, /^receipt:crystal-aggregate:/, `${cls}.${k}`); continue; }
        const d = DOCUMENTS[e.document];
        assert.ok(d, `${cls}.${k}: unknown document ${e.document}`);
        assert.ok(d.locator && d.excerpt && d.retrieved, `${e.document} needs a locator, an excerpt and a retrieved date`);
      }
    }
  });

  it("PDFs read for this item carry the sha256 of the file as read", () => {
    assert.equal(DOCUMENTS["exxonmobil-hma016-molded"].sha256, "11e44e284e1ebdfeb85e7239f93537aaa2d2e42a895fad522c1cdb96886e250d");
    assert.equal(DOCUMENTS["ineos-rigid-packaging-2022"].sha256, "b767047685ea9d09f6a87acd5f908642f63c512576096289d779cd48633a728d");
  });

  it("every interval's endpoints appear in its cited excerpts (as printed, before unit conversion)", () => {
    const printed = {
      "hdpe.youngsModulus": ["970 MPa", "1200", "1410 MPa", "1080 MPa"],
      "hdpe.yieldStrength": ["23 MPa", "29.1 MPa"],
      "hdpe.poisson": ["0.41"],
      "hdpe.conductivity": ["0.37 W/mK", "0.431"],
      "hdpe.cte": ["~180 ppm/°C", "2.2"],
      "hdpe.meltTemperature": ["133 °C", "130", "134.73 °C"],
      "hdpe.glassTransition": ["− 130 °C and − 100 °C"],
      "hdpe.crystallizationTemperature": ["T_c 116.30 °C", "T_C 117.79 °C"],
      "basalt_fiber.youngsModulus": ["91–110 GPa", "85–110 GPa", "88 GPa"],
      "basalt_fiber.tensileStrength": ["3000–4800 MPa", "2950 MPa"],
      "basalt_fiber.diameter": ["7–15 μm", "16 μm", "17.4 μm", "9–23 µm", "6−21 µm"],
      "graphene.inPlaneModulus": ["tensile modulus 1000 GPa"],
      "graphene.effectiveModulus": ["25–40 GPa"],
      "graphene.inPlaneConductivity": ["in-plane 3000 W/mK", "3000 W/m K"],
      "graphene.throughPlaneConductivity": ["through plane 6"],
      "graphene.effectiveInPlaneConductivity": ["300–470 W/mK"],
      "graphene.thickness": ["6–8 nm"],
      "graphene.lateralSize": ["5 µm", "15 μm", "25 μm"],
      "caco3.decompositionTemperature": ["1517 to 2442 °F (Decomposes)"],
      "silica.meltTemperature": ["1710 °C", "1716 - 1736 °C"],
      "basalt_fiber.poisson": ["Poisson's ratio 0.20"],
      "basalt_fiber.cte": ["5.0–8.0", "7.0–12.0", "8 × 10−6"],
      "graphene.cteInPlane": ["Graphene | −73–127 | ~−12–(−2.5)"],
      "graphene.cteThroughPlane": ["Graphite (out-of-plane) | 0–300 | 20–30"],
      // derived claims: the inputs as printed (the outputs are computed: see the next test)
      "caco3.youngsModulus": ["C11 = 144 GPa", "C12 = 53.9 GPa", "C14 = 20.5 GPa", "C13 = 51.1 GPa", "C33 = 84 GPa", "C44 = 33.5 GPa"],
      "caco3.poisson": ["C11 = 144 GPa", "C44 = 33.5 GPa"],
      "caco3.conductivity": ["5.526 W/m·K for 273 K", "4.646 W/m·K for 273 K"],
      "caco3.cte": ["25 (para) -5.8 (perp) x 10-6 K-1"],
      "silica.youngsModulus": ["Youngs Modulus (E) 73.1 GPa", "C11=87 C12=7 C44=58 C13=13 C14=(-)18 C33=106"],
      "silica.poisson": ["Poisson Ratio 0.17", "C11=87 C12=7 C44=58 C13=13 C14=(-)18 C33=106"],
      "silica.conductivity": ["1.38 W m-1 K-1", "10.7 (para) 6.2 (perp)"],
      "silica.cte": ["0.55 x 10-6", "7.1 (para) 13.2 (perp)"],
    };
    for (const { cls, k, c } of all) {
      const want = printed[`${cls}.${k}`];
      assert.ok(want, `${cls}.${k} has no printed-value check`);
      const ex = excerpts(c);
      for (const w of want) assert.ok(ex.includes(w), `${cls}.${k}: "${w}" not in its excerpts`);
    }
  });

  it("the intervals are the span of the printed values, converted to SI (derived ones via the benchmarked crystal-aggregate routine)", () => {
    const cal = voigtReussHill(trigonalStiffness(CALCITE_KORTH)), qtz = voigtReussHill(trigonalStiffness(QUARTZ_CRYSTRAN));
    const calK = uniaxialConductivityBounds(CALCITE_THERMAL), qtzK = uniaxialConductivityBounds(QUARTZ_THERMAL);
    const calA = uniaxialCteAverage(CALCITE_THERMAL), qtzA = uniaxialCteAverage(QUARTZ_THERMAL);
    const span = (c) => [c.range ? c.range.min : c.value, c.range ? c.range.max : c.value];
    const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    const expect = {
      "hdpe.youngsModulus": [970e6, 1410e6], "hdpe.yieldStrength": [23e6, 29.1e6], "hdpe.poisson": [0.41, 0.41],
      "hdpe.conductivity": [0.37, 0.431], "hdpe.cte": [180e-6, 220e-6], "hdpe.meltTemperature": [403.15, 407.88],
      "hdpe.glassTransition": [143.15, 173.15], "hdpe.crystallizationTemperature": [389.45, 390.94], "basalt_fiber.youngsModulus": [85e9, 110e9], "basalt_fiber.tensileStrength": [2950e6, 4800e6],
      "basalt_fiber.diameter": [6e-6, 23e-6], "graphene.inPlaneModulus": [1000e9, 1000e9], "graphene.effectiveModulus": [25e9, 40e9],
      "graphene.inPlaneConductivity": [3000, 3000], "graphene.throughPlaneConductivity": [6, 6], "graphene.effectiveInPlaneConductivity": [300, 470],
      "graphene.thickness": [6e-9, 8e-9], "graphene.lateralSize": [5e-6, 25e-6],
      "caco3.decompositionTemperature": [(1517 - 32) * 5 / 9 + 273.15, (2442 - 32) * 5 / 9 + 273.15],
      "silica.meltTemperature": [1710 + 273.15, 1736 + 273.15],
      "basalt_fiber.poisson": [0.2, 0.2], "basalt_fiber.cte": [5e-6, 12e-6],
      "graphene.cteInPlane": [-12e-6, -2.5e-6], "graphene.cteThroughPlane": [20e-6, 30e-6],
      "caco3.youngsModulus": [cal.reuss.E * 1e9, cal.voigt.E * 1e9], "caco3.poisson": [cal.voigt.nu, cal.reuss.nu],
      "caco3.conductivity": [calK.lower, calK.upper], "caco3.cte": [calA, calA],
      "silica.youngsModulus": [73.1e9, qtz.voigt.E * 1e9], "silica.poisson": [qtz.voigt.nu, 0.17],
      "silica.conductivity": [1.38, qtzK.upper], "silica.cte": [0.55e-6, qtzA],
    };
    for (const { cls, k, c } of all) {
      const [lo, hi] = span(c), [elo, ehi] = expect[`${cls}.${k}`];
      assert.ok(near(lo, elo) && near(hi, ehi), `${cls}.${k}: [${lo}, ${hi}] vs [${elo}, ${ehi}]`);
    }
  });

  it("keeps graphene's supplier in-plane values apart from the multilayer effective ones", () => {
    const ip = constituentProperty("graphene", "inPlaneModulus"), ef = constituentProperty("graphene", "effectiveModulus");
    assert.notEqual(ip.id, ef.id);
    assert.ok(ip.flags.includes("in-plane") && ip.flags.includes("supplier-nominal"));
    assert.ok(ef.flags.includes("effective"));
    assert.ok(ip.value / ef.range.max >= 25, "the in-plane value is at least 25× the effective one");
    assert.ok(constituentProperty("graphene", "inPlaneConductivity").flags.includes("source-specific"));
  });

  it("flags HDPE's mixed tensile/flexural modulus and its disputed Tg, and marks CaCO3 as decomposing", () => {
    assert.ok(constituentProperty("hdpe", "youngsModulus").flags.includes("mixed-test-methods"));
    assert.ok(constituentProperty("hdpe", "glassTransition").flags.includes("disputed"));
    assert.ok(constituentProperty("caco3", "decompositionTemperature").flags.includes("decomposes"));
    assert.equal(constituentProperty("caco3", "meltTemperature"), null, "calcium carbonate has no melting temperature here");
  });

  it("the HDPE/HC co-polymer has no properties, and the unknowns say why", () => {
    assert.deepEqual(Object.keys(CONSTITUENT_PROPERTIES.hdpe_hc_copolymer), []);
    assert.match(UNKNOWN_PROPERTIES.hdpe_hc_copolymer, /not identified/);
    assert.match(UNKNOWN_PROPERTIES.basalt_fiber, /50\.2 W\/\(m·K\).*not used/);
  });
});

describe("mineral fillers replay from recorded PubChem responses", () => {
  it("calcium carbonate's decomposition and silica's melting range come back from the connector", async () => {
    const rec = await loadConnectorRecordings();
    const get = replayGetter(rec.recordings);
    const cc = await experimental(10112, "Melting Point", "substance:calcium-carbonate", get);
    const si = await experimental(24261, "Melting Point", "substance:silica", get);
    assert.equal(cc.ok, true);
    assert.equal(si.ok, true);
    const span = (cs) => [Math.min(...cs.map((c) => c.range ? c.range.min : c.value)), Math.max(...cs.map((c) => c.range ? c.range.max : c.value))];
    const c = constituentProperty("caco3", "decompositionTemperature"), s = constituentProperty("silica", "meltTemperature");
    assert.deepEqual(span(cc.claims), [c.range.min, c.range.max]);
    assert.deepEqual(span(si.claims), [s.range.min, s.range.max]);
    assert.ok(cc.claims.every((x) => /decompos/i.test(x.evidence[0].excerpt)));
    // density replays too, and is the interval constituents.js already cites
    const d = await experimental(10112, "Density", "substance:calcium-carbonate", get);
    assert.ok(d.claims.some((x) => /2\.93 @25 °C/.test(x.evidence[0].excerpt)));
  });
});

describe("the material IR carries the tables", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const ir = materialIrFromText(text, meta);
  it("every constituent has every property key, null where unknown, with the reason", () => {
    for (const c of ir.constituents) assert.deepEqual(Object.keys(c.properties).sort(), [...PROPERTY_KEYS].sort(), c.id);
    const hdpe = ir.constituents.find((c) => c.classId === "hdpe");
    assert.equal(hdpe.properties.youngsModulus.claimRef, "material:hdpe.youngs_modulus");
    assert.deepEqual(hdpe.properties.youngsModulus.flags, ["mixed-test-methods"]);
    const co = ir.constituents.find((c) => c.classId === "hdpe_hc_copolymer");
    assert.ok(Object.values(co.properties).every((v) => v === null));
    assert.match(co.unknown.other, /not identified/);
    assert.equal(ir.constituents.find((c) => c.classId === "caco3").properties.youngsModulus.claimRef, "substance:calcium-carbonate.youngs_modulus");
  });
  it("adding the tables does not move the density receipt", () => {
    assert.equal(strictDensity(ir).result.receipt.id, "receipt:rule-of-mixtures-density:b3c223e0a37e6126");
  });
});
