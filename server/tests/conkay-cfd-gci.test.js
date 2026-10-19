// tests/conkay-cfd-gci.test.js — Celik et al. (2008) GCI, the case kernel's mesh-density levels,
// and the three-run mesh study.
//
// Published acceptance: Table 1 of Celik, Ghia, Roache, Freitas (Coleman & Raad in the journal
// version), "Procedure for Estimation and Reporting of Uncertainty Due to Discretization in CFD
// Applications", J. Fluids Eng. 130(7):078001 (2008), as printed in the ASME JFE editorial-policy
// PDF (JFENumAccuracy.pdf, p. 7, "Table 1: Sample calculations of discretization error"; data from
// Celik & Karatekin, backward-facing step, 2-D, h from Eq. 2, i.e. h ~ N^(-1/2)).
//
// Passing these tests is not physical validation: they show the procedure is implemented as
// published and the study refuses what it cannot honestly compute. No OpenFOAM run is involved.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gci, representativeH } from "../lib/conkay/cfd/gci.js";
import { meshStudy, meshStudyFromStore } from "../lib/conkay/cfd/mesh-study.js";
import { writeCase } from "../lib/conkay/cfd/openfoam-case.js";
import { importRun, readRun } from "../lib/conkay/cfd/run-store.js";

const near = (got, want, tol, msg) => assert.ok(Math.abs(got - want) <= tol, `${msg}: got ${got}, want ${want} +/- ${tol}`);
const h2d = (Ns) => Ns.map((n) => representativeH(n, 1, 2)); // Eq. 2, unit area

// ---------- published Table 1 ----------

const TABLE_1 = [
  // [column, N1..N3, phi1..phi3, published p, phi_ext21, ea21 %, eext21 %, GCI21 %, oscillatory]
  { col: "reattachment length, monotonic", N: [18000, 8000, 4500], phi: [6.063, 5.972, 5.863], r21: 1.5, r32: 1.333, p: 1.53, ext: 6.1685, ea: 1.5, eext: 1.7, gci: 2.2 },
  { col: "axial velocity, p < 1", N: [18000, 4500, 980], phi: [10.7880, 10.7250, 10.6050], r21: 2.0, r32: 2.143, p: 0.75, ext: 10.8801, ea: 0.6, eext: 0.9, gci: 1.1 },
  { col: "axial velocity, oscillatory", N: [18000, 4500, 980], phi: [6.0042, 5.9624, 6.0909], r21: 2.0, r32: 2.143, p: 1.51, ext: 6.0269, ea: 0.7, eext: 0.4, gci: 0.5, osc: true },
];

for (const c of TABLE_1) {
  test(`GCI reproduces the published Table 1 column: ${c.col}`, () => {
    const g = gci({ phi: c.phi, h: h2d(c.N) }, { allowOscillatory: !!c.osc });
    assert.equal(g.status, "COMPUTED");
    near(g.r21, c.r21, 0.0005, "r21");
    near(g.r32, c.r32, 0.001, "r32");
    near(g.p, c.p, 0.005, "apparent order p (printed to 2 dp)");
    near(g.phiExt21, c.ext, 0.00005, "phi_ext21 (printed to 4-5 sig. figures)");
    near(g.ea21 * 100, c.ea, 0.05, "e_a21 % (printed to 1 dp)");
    // column 2 prints 0.9 where the unrounded computation gives 0.85 (the printed p of 0.75 is itself rounded): 0.1 allowed
    near(g.eext21 * 100, c.eext, 0.1, "e_ext21 %");
    near(g.gciFine21 * 100, c.gci, 0.05, "GCI_fine21 %");
    assert.equal(g.convergence, c.osc ? "oscillatory" : "monotonic");
  });
}

test("GCI: the oscillatory column is NOT a result unless explicitly allowed", () => {
  const c = TABLE_1[2];
  const g = gci({ phi: c.phi, h: h2d(c.N) });
  assert.equal(g.status, "NOT_COMPUTED");
  assert.equal(g.convergence, "oscillatory");
  assert.equal(g.gciFine21, null);
  assert.match(g.reason, /oscillatory/);
});

// ---------- derivation checks on constructed exact series ----------

test("GCI recovers p and phi0 from an exact series phi = phi0 + C h^p (non-constant r)", () => {
  for (const [p, phi0, C, h] of [[2, 0.3, 4, [0.01, 0.0155, 0.026]], [1.2, -5, 2, [0.5, 0.8, 1.1]], [0.6, 10, -3, [1, 1.7, 2.6]]]) {
    const g = gci({ phi: h.map((x) => phi0 + C * x ** p), h });
    assert.equal(g.status, "COMPUTED");
    near(g.p, p, 1e-9, `p (${p})`);
    near(g.phiExt21, phi0, 1e-9 * Math.abs(phi0) + 1e-9, "phi_ext21");
    near(g.phiExt32, phi0, 1e-8 * Math.abs(phi0) + 1e-8, "phi_ext32");
    // Eq. 7 by hand: Fs * |(phi1 - phi2) / phi1| / (r21^p - 1)
    const f = h.map((x) => phi0 + C * x ** p);
    near(g.gciFine21, (1.25 * Math.abs((f[0] - f[1]) / f[0])) / ((h[1] / h[0]) ** p - 1), 1e-12, "Eq. 7");
    // GCI32 uses errors relative to phi2, GCI21 relative to phi1, so the ratio is 1 only to the size of the relative error
    assert.ok(g.asymptoticRatio > 0.5 && g.asymptoticRatio < 2, `asymptotic ratio ${g.asymptoticRatio}`);
  }
});

test("GCI: divergent, zero-difference and bad inputs", () => {
  // error grows as the grid is refined: coarse pair differs less than the fine pair
  const d = gci({ phi: [1.0, 1.5, 1.6], h: [1, 2, 4] });
  assert.equal(d.status, "NOT_COMPUTED");
  assert.equal(d.convergence, "divergent");
  assert.equal(d.gciFine21, null);
  assert.match(d.reason, /divergent/);
  const z = gci({ phi: [1, 1, 1.2], h: [1, 2, 4] });
  assert.equal(z.status, "NOT_COMPUTED");
  assert.match(z.reason, /zero/);
  assert.throws(() => gci({ phi: [1, 2], h: [1, 2] }), /three/);
  assert.throws(() => gci({ phi: [1, 2, NaN], h: [1, 2, 3] }), /finite/);
  assert.throws(() => gci({ phi: [1, 2, 3], h: [1, 1, 3] }), /strictly increasing/);
  assert.throws(() => gci({ phi: [1, 2, 3], h: [3, 2, 1] }), /strictly increasing/);
  assert.throws(() => gci({ phi: [1, 2, 3], h: [0, 1, 2] }), /positive/);
  assert.throws(() => representativeH(0, 1), />/);
});

test("GCI notes a refinement ratio below the paper's 1.3", () => {
  const g = gci({ phi: [1 + 0.1 ** 2, 1 + 0.12 ** 2, 1 + 0.14 ** 2], h: [0.1, 0.12, 0.14] });
  assert.ok(g.notes.some((n) => /below 1.3/.test(n)));
});

// ---------- case kernel: mesh density ----------

test("case kernel: refinement levels scale every blockMesh axis by sqrt 2, medium is today's mesh", async () => {
  const med = await writeCase({ preset: "ahmed", nproc: 7, endTime: 2000 });
  const medExplicit = await writeCase({ preset: "ahmed", nproc: 7, endTime: 2000, refinement: "medium" });
  assert.equal(med.caseSha256, "75a5f0dced2b2e5eff78bf26aacc95047d53350cbfdd35a29c2407756b5b9e17");
  assert.equal(medExplicit.caseSha256, med.caseSha256);
  const coarse = await writeCase({ preset: "ahmed", nproc: 7, endTime: 2000, refinement: "coarse" });
  const fine = await writeCase({ preset: "ahmed", nproc: 7, endTime: 2000, refinement: "fine" });
  assert.deepEqual(med.blockCells, [80, 20, 14]);
  assert.deepEqual(coarse.blockCells, [57, 14, 10]);
  assert.deepEqual(fine.blockCells, [113, 28, 20]);
  const car = await writeCase({ preset: "car5m", nproc: 7, endTime: 4000, aref: 2.06, lref: 5.185, refinement: "fine" });
  assert.deepEqual(car.blockCells, [120, 42, 21]);
  // the realised ratios stay above Celik's 1.3 even after integer rounding (product of axes)
  const n = (c) => c[0] * c[1] * c[2];
  for (const [a, b] of [[med, coarse], [fine, med]]) assert.ok((n(a.blockCells) / n(b.blockCells)) ** (1 / 3) > 1.3);
  assert.equal(new Set([med.caseSha256, coarse.caseSha256, fine.caseSha256]).size, 3);
  // only the mesh dictionaries differ: the solver setup is byte-identical across levels
  const diff = (a, b) => Object.keys(a.files).filter((f) => a.files[f] !== b.files[f]).sort();
  assert.deepEqual(diff(fine, med), ["system/blockMeshDict", "system/snappyHexMeshDict"]);
  assert.deepEqual(diff(coarse, med), ["system/blockMeshDict"]);
  assert.equal(coarse.solverSetupSha256, med.solverSetupSha256);
  assert.equal(fine.solverSetupSha256, med.solverSetupSha256);
  assert.equal(med.domainVolumeM3, 8 * 2 * 1.4);
  assert.equal(car.domainVolumeM3, 34 * 12 * 6);
});

test("case kernel: unknown refinement is an error, never defaulted", async () => {
  for (const bad of ["Fine", "finest", "", 2, null, true]) {
    const r = await writeCase({ preset: "ahmed", nproc: 7, endTime: 2000, refinement: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error, /refinement must be one of/);
  }
});

// ---------- mesh study ----------

function fakeRun({ refinement, cells, cd, noise = 0, over = {}, caseOver = {} }) {
  const rows = Array.from({ length: 600 }, (_, i) => ({ Time: i + 1, Cd: cd + (i % 2 ? noise : -noise), Cl: 0 }));
  return {
    record: {
      cadRequestHash: "a".repeat(24), stepSha256: "s1", surface: { stlSha256: "t1" },
      case: { preset: "car5m", aref: 2, lref: 5, kernelSha256: "k", solverSetupSha256: "ss", domainVolumeM3: 2448, refinement, ...caseOver },
      ...over,
    },
    forces: { fc_total: { header: { magUInf: 40, lRef: 5, Aref: 2 }, columns: ["Time", "Cd", "Cl"], rows } },
    snappy: { cells },
  };
}
// exact power series in h = (V/N)^(1/3): Cd = 0.30 + C h^p
const cdOf = (N, p = 2, C = 0.05) => 0.30 + C * (2448 / N) ** (p / 3);
const set = (o = {}) => ({
  coarse: fakeRun({ refinement: "coarse", cells: 2.0e6, cd: cdOf(2.0e6) }),
  medium: fakeRun({ refinement: "medium", cells: 5.6e6, cd: cdOf(5.6e6) }),
  fine: fakeRun({ refinement: "fine", cells: 15.9e6, cd: cdOf(15.9e6) }),
  ...o,
});

test("mesh study: three settled runs give the GCI, recovering a constructed exact series", () => {
  const s = meshStudy(set());
  assert.equal(s.status, "COMPUTED", s.reason);
  near(s.gci.p, 2, 1e-9, "p");
  near(s.gci.phiExt21, 0.30, 1e-9, "extrapolated Cd");
  assert.ok(s.discretizationUncertainty.gciFine21 > 0);
  near(s.discretizationUncertainty.absolute, s.discretizationUncertainty.gciFine21 * cdOf(15.9e6), 1e-12, "absolute");
  assert.match(s.basis.h, /domain volume/);
});

test("mesh study: an unsettled level, a missing level, and mismatched cases are NOT_COMPUTED", () => {
  let s = meshStudy(set({ medium: fakeRun({ refinement: "medium", cells: 5.6e6, cd: 0.31, noise: 0.01 }) }));
  assert.equal(s.status, "NOT_COMPUTED");
  assert.match(s.reason, /medium run did not settle/);
  s = meshStudy({ ...set(), coarse: null });
  assert.match(s.reason, /no recorded run for the coarse level/);
  s = meshStudy(set({ fine: fakeRun({ refinement: "medium", cells: 15.9e6, cd: cdOf(15.9e6) }) }));
  assert.match(s.reason, /fine was made with refinement "medium"/);
  s = meshStudy(set({ fine: fakeRun({ refinement: "fine", cells: 15.9e6, cd: cdOf(15.9e6), caseOver: { aref: 2.1 } }) }));
  assert.match(s.reason, /differ in aref/);
  s = meshStudy(set({ fine: fakeRun({ refinement: "fine", cells: 15.9e6, cd: cdOf(15.9e6), over: { stepSha256: "other" } }) }));
  assert.match(s.reason, /different STEP/);
  s = meshStudy(set({ fine: fakeRun({ refinement: "fine", cells: 15.9e6, cd: cdOf(15.9e6), caseOver: { solverSetupSha256: undefined } }) }));
  assert.match(s.reason, /solverSetupSha256 is not recorded/);
  s = meshStudy(set({ fine: fakeRun({ refinement: "fine", cells: 4e6, cd: cdOf(4e6) }) }));
  assert.equal(s.status, "NOT_COMPUTED"); // cell counts not increasing toward fine
});

test("mesh study: an oscillatory or divergent series gives no uncertainty", () => {
  const s = meshStudy(set({ medium: fakeRun({ refinement: "medium", cells: 5.6e6, cd: 0.45 }) }));
  assert.equal(s.status, "NOT_COMPUTED");
  assert.equal(s.discretizationUncertainty, undefined);
  assert.match(s.reason, /oscillatory|divergent/);
});

// ---------- run store: grid-study levels ----------

test("run store keeps coarse/medium/fine runs of one body side by side", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conkay-gci-"));
  const key = "b".repeat(24);
  const pp = path.join(dir, "pp", "fc_total", "0");
  fs.mkdirSync(pp, { recursive: true });
  let dat = "# Force coefficients\n# magUInf : 40\n# lRef : 5\n# Aref : 2\n# Time Cm Cd Cl\n";
  for (let i = 1; i <= 600; i++) dat += `${i} 0 0.3 0\n`;
  fs.writeFileSync(path.join(pp, "forceCoeffs.dat"), dat);
  const store = path.join(dir, "store");
  for (const refinement of ["coarse", "medium", "fine"]) importRun(key, { postProcessingDir: path.join(dir, "pp") }, { stepSha256: "s", case: { refinement } }, { dir: store });
  assert.deepEqual(fs.readdirSync(store).sort(), [key, `${key}.coarse`, `${key}.fine`]);
  assert.equal(readRun(key, { dir: store, refinement: "fine" }).record.case.refinement, "fine");
  assert.equal(readRun(key, { dir: store }).record.case.refinement, "medium");
  assert.throws(() => readRun(key, { dir: store, refinement: "huge" }), /refinement must be one of/);
  assert.equal(meshStudyFromStore("c".repeat(24), { dir: store }), null);
  // the study refuses these (no snappy summary), rather than guessing a cell count
  const s = meshStudyFromStore(key, { dir: store });
  assert.equal(s.status, "NOT_COMPUTED");
  assert.match(s.reason, /cell count/);
  fs.rmSync(dir, { recursive: true, force: true });
});
