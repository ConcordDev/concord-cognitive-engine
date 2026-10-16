// Blend D brief item 9: chamber checks — wall stress, burst margin, crash/seal screen.
//
//  [R134] UN Regulation No. 134, 02 series, Amendment 3 (E/ECE/324/Rev.2/Add.133/Rev.1/Amend.3, 27 Sept 2024),
//         §5.1.1: "burst pressure within ±10 per cent of BPO and greater than or equal to a minimum BPmin of 200 per
//         cent NWP. Containers having glass-fibre composite as a primary constituent shall have a minimum burst
//         pressure greater than 350 per cent NWP." (documents.un.org g2417889.pdf, sha256 f4ac7afc…5b9c)
//  [EXX]  ExxonMobil HDPE HMA 016 datasheet p.1: "Tensile Stress at Yield 23 MPa (ISO 527-2/1A/50)".
//  [LYB]  LyondellBasell Alathon H6011: "Tensile Stress at Yield (23 °C) 29.1 MPa".
//  Stress formulas: Lamé's thick-cylinder solution and the thin-wall limit, checked here by their exact identities
//  (σr(a) = −p, σr(b) = 0, σθ(a) = p(a² + b²)/(b² − a²), σθ + σr constant, thin-wall limit) — Roark and ASME VIII
//  were not read (not open access), so no handbook number is quoted.
//  Passing these tests is not physical validation: burst and crash/seal are vessel tests.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { thinWall, lame, wallStress, burstPressure, requiredBurstRatio, thicknessForBurst, crashStrain, R134_BURST, withPressureVessel, THIN_WALL_LIMIT } from "../lib/conkay/knowledge/pressure-vessel.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { buildSentinelM1IR } from "../lib/conkay/demos/sentinel-m1.js";

const MPA = 1e6;
const close = (a, b, rel = 1e-12) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${a} vs ${b}`);
const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const HDPE_YIELD = { lo: 23 * MPA, hi: 29.1 * MPA, source: "HDPE tensile stress at yield: ExxonMobil HMA 016 23 MPa; LyondellBasell Alathon H6011 29.1 MPa" };

describe("Lamé identities and the thin-wall limit", () => {
  const p = 70 * MPA, a = 0.15, b = 0.19;
  it("boundary conditions and the bore hoop stress", () => {
    close(lame({ p, a, b }, a).radial, -p);
    assert.ok(Math.abs(lame({ p, a, b }, b).radial) < 1e-6 * p);
    close(lame({ p, a, b }, a).hoop, (p * (a * a + b * b)) / (b * b - a * a));
  });
  it("σθ + σr is the same at every radius (= 2σz, closed ends)", () => {
    for (const r of [a, 0.16, 0.17, 0.18, b]) { const s = lame({ p, a, b }, r); close(s.hoop + s.radial, 2 * s.axial, 1e-12); }
  });
  it("the hoop force balances the pressure: ∫σθ dr = p·a", () => {
    let sum = 0; const n = 20000, h = (b - a) / n;
    for (let i = 0; i < n; i++) sum += lame({ p, a, b }, a + (i + 0.5) * h).hoop * h;
    close(sum, p * a, 1e-6);
  });
  it("thin wall: Lamé tends to p·r/t as t/r → 0, and the switch is at t/r = 0.1", () => {
    const t = 1e-4, l = lame({ p, a, b: a + t }, a).hoop, th = thinWall({ p, r: a + t / 2, t }).hoop;
    close(l, th, 1e-3);
    assert.equal(THIN_WALL_LIMIT, 0.1);
    assert.match(wallStress({ p, innerRadius: 0.15, thickness: 0.015 }).method, /thin wall/);
    assert.match(wallStress({ p, innerRadius: 0.15, thickness: 0.0151 }).method, /Lamé/);
  });
  it("invalid inputs throw", () => {
    assert.throws(() => lame({ p, a: 0.2, b: 0.1 }));
    assert.throws(() => thinWall({ p: -1, r: 1, t: 1 }));
    assert.throws(() => burstPressure({ strength: 0, innerRadius: 1, thickness: 1 }));
    assert.throws(() => crashStrain({ energyJ: NaN, modulusPa: 1, wallVolumeM3: 1 }));
  });
});

describe("[R134] burst requirement", () => {
  it("is the quoted text", () => {
    const d = DOCUMENTS["un-r134-02-amend3-burst"];
    assert.ok(d.excerpt.includes("greater than or equal to a minimum BPmin of 200 per cent NWP"));
    assert.ok(d.excerpt.includes("glass-fibre composite as a primary constituent shall have a minimum burst pressure greater than 350 per cent NWP"));
    assert.equal(d.locator, "§5.1.1 (baseline initial burst pressure)");
    assert.equal(requiredBurstRatio(), R134_BURST.minRatio);
    assert.equal(requiredBurstRatio({ glassFibrePrimary: true }), R134_BURST.glassFibreRatio);
    assert.deepEqual([R134_BURST.minRatio, R134_BURST.glassFibreRatio], [2.0, 3.5]);
  });
  it("the closed-form wall reaches exactly ratio × NWP", () => {
    const t = thicknessForBurst({ strength: 29.1 * MPA, innerRadius: 0.15, nwp: 5 * MPA, ratio: 2 });
    close(burstPressure({ strength: 29.1 * MPA, innerRadius: 0.15, thickness: t }), 10 * MPA, 1e-12);
  });
  it("[EXX][LYB] a monolithic HDPE wall can never reach 200 % of 35 or 70 MPa: the burst is below the yield stress at any thickness → Type IV", () => {
    for (const nwp of [35 * MPA, 70 * MPA]) {
      for (const S of [HDPE_YIELD.lo, HDPE_YIELD.hi]) {
        assert.equal(thicknessForBurst({ strength: S, innerRadius: 0.15, nwp, ratio: 2 }), Infinity);
        assert.ok(burstPressure({ strength: S, innerRadius: 0.15, thickness: 10 }) < S);
      }
    }
  });
});

describe("solvers on a chamber attached to real design IRs", () => {
  it("are registered with their declarations", () => {
    for (const id of ["vessel.hoop-stress", "vessel.burst-margin", "vessel.crash-seal-screen"]) {
      const s = listSolvers().find((x) => x.id === id);
      assert.ok(s, id);
      for (const k of ["version", "domain", "method", "reference", "regime", "units", "tolerance"]) assert.ok(s[k], `${id}.${k}`);
      assert.equal(s.screening, true);
    }
  });

  const chamber = { innerRadiusM: 0.15, wallThicknessM: 0.02, lengthM: 0.8, nwpPa: 70 * MPA };

  it("vehicle IR, Blend D wall: strength and modulus unknown → burst and crash NOT_COMPUTED with the material's reason; seal never computed", () => {
    const ir = withPressureVessel(buildCarFromLibrary(BRIEF, { cadBody: false }).ir, { material: "usb-blend-d", ...chamber, crash: { energyJ: 500 } });
    const o = openDesign(ir); assert.ok(o.ok, JSON.stringify(o.errors));
    const hoop = o.session.result("vessel.hoop-stress@H2_CHAMBER");
    assert.equal(hoop.status, "WARN");
    assert.match(hoop.warnings.join(" "), /USB Blend D.*not computed: needs tests/);
    const burst = o.session.result("vessel.burst-margin@H2_CHAMBER");
    assert.equal(burst.status, "NOT_COMPUTED");
    assert.match(burst.reason, /no wall strength — USB Blend D/);
    const crash = o.session.result("vessel.crash-seal-screen@H2_CHAMBER");
    assert.equal(crash.status, "NOT_COMPUTED");
    assert.match(crash.reason, /no wall modulus/);
    assert.match(crash.reason, /seal integrity after a crash is not computed/);
    assert.equal(crash.outputs.seal.value, "not computed — needs a vessel test");
  });

  it("Sentinel IR, HDPE wall at 70 MPa NWP with the cited yield: burst FAILS UN R134 and no thickness fixes it", () => {
    const ir = withPressureVessel(buildSentinelM1IR(), { ...chamber, wallStrengthPa: HDPE_YIELD, modulusPa: { lo: 970 * MPA, hi: 1410 * MPA, source: "HDPE flexural modulus, ExxonMobil HMA 016 / Alathon H6011" }, crash: { energyJ: 500 } });
    const o = openDesign(ir); assert.ok(o.ok, JSON.stringify(o.errors));
    const burst = o.session.result("vessel.burst-margin@H2_CHAMBER");
    assert.equal(burst.status, "FAIL");
    const a = 0.15, b = 0.17;
    close(burst.outputs.burstPressure.value, (23 * MPA * (b * b - a * a)) / (b * b + a * a), 1e-12);
    assert.equal(burst.outputs.wallForRequirement.value, null);
    assert.match(burst.warnings.join(" "), /Type IV liner inside a carbon-fibre overwrap/);
    const hoop = o.session.result("vessel.hoop-stress@H2_CHAMBER");
    assert.equal(hoop.status, "FAIL", "the hoop stress at NWP alone exceeds the HDPE yield");
    const crash = o.session.result("vessel.crash-seal-screen@H2_CHAMBER");
    assert.equal(crash.status, "WARN");
    assert.ok(crash.outputs.meanStrain.value > 0);
    assert.equal(crash.outputs.seal.value, "not computed — needs a vessel test");
  });

  it("a low-pressure chamber with a sourced strength can pass, and missing geometry is NOT_COMPUTED", () => {
    const ir = withPressureVessel(buildSentinelM1IR(), { innerRadiusM: 0.1, wallThicknessM: 0.01, lengthM: 0.3, nwpPa: 0.5 * MPA, wallStrengthPa: HDPE_YIELD });
    const o = openDesign(ir);
    assert.equal(o.session.result("vessel.burst-margin@H2_CHAMBER").status, "WARN", "passes the margin; the warnings say burst is a test");
    assert.equal(o.session.result("vessel.crash-seal-screen@H2_CHAMBER").status, "NOT_COMPUTED");
    const bad = withPressureVessel(buildSentinelM1IR(), { innerRadiusM: 0.1, wallThicknessM: 0.01, lengthM: 0.3, wallStrengthPa: HDPE_YIELD });
    assert.match(openDesign(bad).session.result("vessel.hoop-stress@H2_CHAMBER").reason, /nwpPa/);
  });
});
