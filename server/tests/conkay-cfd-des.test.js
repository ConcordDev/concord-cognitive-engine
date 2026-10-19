// server/tests/conkay-cfd-des.test.js
//
// The transient DDES variant of the OpenFOAM aero path: the case kernel's DES overlay, the
// time-window statistics, and the per-turbulence-model Ahmed gate in aero.cfd.
//
// Passing these tests is NOT physical validation. The DES template has never been run: they pin
// that the dictionaries carry the keywords OpenFOAM 12's sources define, that the statistics do
// what they claim on synthetic series with a known answer, and that no RANS result or validation
// can unlock a DES result (or the reverse).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeCase } from "../lib/conkay/cfd/openfoam-case.js";
import { parseForceCoeffs, timeWindowStatistics, timeWindowVerdict, TRANSIENT_LIMITS } from "../lib/conkay/cfd/force-coeffs.js";
import { importRun, sha256File } from "../lib/conkay/cfd/run-store.js";
import { validationAccepted, validationFor, AHMED_CFD_VALIDATION, AHMED_DES_VALIDATION } from "../lib/conkay/cfd/validation.js";
import { getSolver } from "../lib/conkay/physics/registry.js";
import "../lib/conkay/physics/solvers/aero-cfd.js";

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `conkay-des-${p}-`));
const read = (f) => fs.readFileSync(f, "utf8");

// ---------- deterministic noise ----------

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
const rowsOf = (xs, dt) => xs.map((Cd, i) => ({ Time: +(i * dt).toFixed(9), Cd, Cl: 0.1 }));

// ---------- case kernel ----------

test("DES case: carries the OpenFOAM 12 keywords, each from a source read", async () => {
  const out = tmp("case");
  const r = await writeCase({ preset: "ahmed", outDir: out, nproc: 7, endTime: 4000, turbulence: "ddes" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.turbulence, "ddes");
  const mt = read(path.join(out, "des/constant/momentumTransport"));
  // LES/kOmegaSSTDES/kOmegaSSTDES.C: model kOmegaSSTDES, CDES (default 0.61), FSST (2 = Lt*(1-F2)/(CDES*delta))
  assert.match(mt, /simulationType LES;/);
  assert.match(mt, /model kOmegaSSTDES;/);
  assert.match(mt, /kOmegaSSTDESCoeffs \{ CDES 0\.61; FSST 2; \}/);
  // LES/LESdeltas/maxDeltaxyz: deltaCoeff 2 makes a regular hex's delta its full edge
  assert.match(mt, /delta maxDeltaxyz;/);
  assert.match(mt, /maxDeltaxyzCoeffs \{ deltaCoeff 2; \}/);
  assert.match(mt, /turbulence on;/);
  const sch = read(path.join(out, "des/system/fvSchemes"));
  assert.match(sch, /ddtSchemes \{ default backward; \}/);
  assert.match(sch, /div\(phi,U\) Gauss LUST unlimitedGrad\(U\);/);
  assert.match(sch, /div\(phi,k\) Gauss limitedLinear 1;/);
  assert.match(sch, /div\(phi,omega\) Gauss limitedLinear 1;/);
  assert.match(sch, /wallDist \{ method meshWave; \}/);
  assert.doesNotMatch(sch, /steadyState|bounded/);
  const sol = read(path.join(out, "des/system/fvSolution"));
  assert.match(sol, /PIMPLE \{ nCorrectors 3; nNonOrthogonalCorrectors 0; \}/);
  assert.match(sol, /pFinal \{ \$p; relTol 0; \}/);
  assert.match(sol, /"\(U\|k\|omega\)\.\*"/);
  const cd = read(path.join(out, "des/system/controlDict"));
  assert.match(cd, /startFrom startTime; startTime 0;/);
  assert.doesNotMatch(cd, /^\s*adjustTimeStep\s+(yes|true)/m);
  // force coefficients every time step, all five Ahmed parts
  for (const p of ["total", "nose", "slant", "base", "rest"]) assert.match(cd, new RegExp(`fc_${p}`));
  assert.equal((cd.match(/writeControl timeStep; writeInterval 1;/g) || []).length, 5);
  // the RANS stage is untouched and the stage-2 script follows the motorBike LES procedure
  assert.match(read(path.join(out, "system/fvSchemes")), /steadyState/);
  assert.match(read(path.join(out, "constant/momentumTransport")), /RAS/);
  const stage2 = read(path.join(out, "AllrunDES"));
  assert.match(stage2, /mv "\$p\/\$LATEST" "\$p\/0"/);
  assert.match(stage2, /rm -rf "\$p\/0\/uniform"/);
  assert.match(stage2, /cp des\/constant\/momentumTransport constant\//);
  assert.ok(stage2.indexOf("source /opt/openfoam12/etc/bashrc || true") < stage2.indexOf("set -e"));
  assert.equal((fs.statSync(path.join(out, "AllrunDES")).mode & 0o111) !== 0, true);
});

test("DES time step: dt = cfl * h_fine / (1.5 U), rounded down; run length in flow-throughs", async () => {
  const r = await writeCase({ preset: "ahmed", nproc: 7, endTime: 4000, turbulence: "ddes" });
  assert.equal(r.ok, true, r.error);
  const d = r.des;
  // Ahmed: blockMesh cell 0.1 m, surface level 6 -> h_fine = 0.1 / 64
  assert.equal(d.hFineM, 0.1 / 64);
  const raw = (1.0 * d.hFineM) / (1.5 * 40);
  assert.ok(d.dtS <= raw && d.dtS > 0.9 * raw, `${d.dtS} vs ${raw}`);
  assert.equal(d.dtS, 2.6e-5);
  assert.ok((1.5 * 40 * d.dtS) / d.hFineM <= 1.0 + 1e-12, "Courant number at the assumed peak speed stays within the target");
  assert.ok(Math.abs(d.flowThroughS - 1.044 / 40) < 1e-12);
  assert.equal(d.discardTimeS, 5 * d.flowThroughS);
  assert.equal(d.windowTimeS, 10 * d.flowThroughS);
  assert.ok(d.endTimeS >= d.discardTimeS + d.windowTimeS && d.endTimeS < d.discardTimeS + d.windowTimeS + d.dtS);
  // a smaller target Courant number gives a smaller step, and the car preset uses its own cell and length
  const r2 = await writeCase({ preset: "ahmed", nproc: 7, endTime: 4000, turbulence: "ddes", cflTarget: 0.5, flowThroughsDiscard: 2, flowThroughsAverage: 4 });
  assert.ok(r2.des.dtS < d.dtS);
  assert.equal(r2.des.windowTimeS, 4 * r2.des.flowThroughS);
  const car = await writeCase({ preset: "car5m", nproc: 7, endTime: 4000, aref: 2.06, lref: 5.185, turbulence: "ddes" });
  assert.equal(car.des.hFineM, 0.4 / 64);
  assert.ok(Math.abs(car.des.flowThroughS - 5.185 / 40) < 1e-12);
});

test("DES on a refined mesh: blockMesh level and the DDES time step are both applied", async () => {
  const med = await writeCase({ preset: "ahmed", nproc: 7, endTime: 4000, turbulence: "ddes", refinement: "medium" });
  const fine = await writeCase({ preset: "ahmed", nproc: 7, endTime: 4000, turbulence: "ddes", refinement: "fine" });
  const coarse = await writeCase({ preset: "ahmed", nproc: 7, endTime: 4000, turbulence: "ddes", refinement: "coarse" });
  assert.equal(med.ok && fine.ok && coarse.ok, true, fine.error || coarse.error || med.error);
  assert.equal(med.turbulence, "ddes");
  assert.equal(fine.turbulence, "ddes");
  assert.equal(coarse.turbulence, "ddes");
  assert.deepEqual(med.blockCells, [80, 20, 14]);
  assert.deepEqual(fine.blockCells, [113, 28, 20]);
  assert.deepEqual(coarse.blockCells, [57, 14, 10]);
  // largest blockMesh edge of the written mesh, divided by 2^surface level (6)
  const edge = (cells, extent) => Math.max(...cells.map((n, i) => extent[i] / n));
  assert.equal(med.des.hFineM, 0.1 / 64);
  assert.equal(fine.des.hFineM, edge([113, 28, 20], [8, 2, 1.4]) / 64);
  assert.equal(coarse.des.hFineM, edge([57, 14, 10], [8, 2, 1.4]) / 64);
  assert.ok(fine.des.hFineM < med.des.hFineM && fine.des.dtS < med.des.dtS);
  assert.ok(coarse.des.hFineM > med.des.hFineM && coarse.des.dtS > med.des.dtS);
  // the RANS dictionaries of a fine DDES case match a fine RANS case; the overlay is extra
  const fineRans = await writeCase({ preset: "ahmed", nproc: 7, endTime: 4000, refinement: "fine" });
  assert.equal(fineRans.ok, true, fineRans.error);
  for (const [f, h] of Object.entries(fineRans.files)) assert.equal(fine.files[f], h, f);
  assert.ok(fine.files["des/system/controlDict"]);
  assert.ok(fine.files.AllrunDES);
  assert.equal(fine.solverSetupSha256, med.solverSetupSha256);
  assert.notEqual(fine.caseSha256, med.caseSha256);
  const out = tmp("fine-des");
  const written = await writeCase({ preset: "ahmed", outDir: out, nproc: 7, endTime: 4000, turbulence: "ddes", refinement: "fine" });
  assert.equal(written.ok, true, written.error);
  const block = read(path.join(out, "system/blockMeshDict"));
  assert.match(block, /hex \(0 1 2 3 4 5 6 7\) \(113 28 20\)/);
  const cd = read(path.join(out, "des/system/controlDict"));
  const dt = Number(cd.match(/deltaT ([0-9.eE+-]+);/)[1]);
  assert.ok(Math.abs(dt - written.des.dtS) / written.des.dtS < 1e-6, `${dt} vs ${written.des.dtS}`);
  assert.match(read(path.join(out, "des/constant/momentumTransport")), /model kOmegaSSTDES;/);
  const car = await writeCase({ preset: "car5m", nproc: 7, endTime: 4000, aref: 2.06, lref: 5.185, turbulence: "ddes", refinement: "fine" });
  assert.equal(car.ok, true, car.error);
  assert.deepEqual(car.blockCells, [120, 42, 21]);
  assert.equal(car.turbulence, "ddes");
  assert.ok(car.des.hFineM < 0.4 / 64);
});

test("RANS stays the default and byte-identical", async () => {
  const base = { preset: "ahmed", nproc: 7, endTime: 2000 };
  const a = await writeCase(base);
  const b = await writeCase({ ...base, turbulence: "rans" });
  assert.equal(a.caseSha256, "75a5f0dced2b2e5eff78bf26aacc95047d53350cbfdd35a29c2407756b5b9e17"); // the pinned recorded case
  assert.equal(b.caseSha256, a.caseSha256);
  assert.equal(a.des, undefined);
  assert.equal(Object.keys(a.files).some((f) => f.startsWith("des/") || f === "AllrunDES"), false);
  const d = await writeCase({ ...base, endTime: 4000, turbulence: "ddes" });
  // the DES request is a strict superset: every RANS file is identical
  const rans = await writeCase({ ...base, endTime: 4000 });
  for (const [f, h] of Object.entries(rans.files)) assert.equal(d.files[f], h, f);
  assert.notEqual(d.caseSha256, rans.caseSha256);
});

test("DES case: invalid or unknown values are refused, never defaulted", async () => {
  const ok = { preset: "ahmed", nproc: 7, endTime: 4000 };
  const bad = [
    { ...ok, turbulence: "iddes" },
    { ...ok, turbulence: "les" },
    { ...ok, turbulence: "DDES" },
    { ...ok, turbulence: null },
    { ...ok, turbulence: "ddes", cflTarget: 0 },
    { ...ok, turbulence: "ddes", cflTarget: 2.5 },
    { ...ok, turbulence: "ddes", cflTarget: "1" },
    { ...ok, turbulence: "ddes", flowThroughsDiscard: -1 },
    { ...ok, turbulence: "ddes", flowThroughsAverage: 1 },
    { ...ok, turbulence: "ddes", flowThroughsAverage: Number.NaN },
    { ...ok, turbulence: "ddes", endTime: 4100 }, // RANS stage must end on a written time
    { ...ok, cflTarget: 1 }, // DES parameter with RANS
    { ...ok, turbulence: "rans", flowThroughsAverage: 10 },
  ];
  for (const req of bad) {
    const r = await writeCase(req);
    assert.equal(r.ok, false, JSON.stringify(req));
    assert.ok(r.error);
  }
});

// ---------- time-window statistics ----------

test("timeWindowStatistics: sine + noise around a known mean", () => {
  // period 0.037 s: batches (0.1 s) span several periods, so the batch means see the noise, not the sine phase
  const r = rng(7), dt = 0.001, mu = 0.3;
  const xs = Array.from({ length: 3000 }, (_, i) => mu + 0.02 * Math.sin((2 * Math.PI * i * dt) / 0.037) + 0.005 * gauss(r));
  const s = timeWindowStatistics(rowsOf(xs, dt), "Cd", { discardTime: 1, windowTime: 2 });
  assert.equal(s.samples, 2000);
  assert.ok(Math.abs(s.fromTime - 1) < 1e-9 && Math.abs(s.toTime - 2.999) < 1e-9);
  assert.ok(Math.abs(s.mean - mu) <= s.ci95HalfWidth, `mean ${s.mean} not within ${s.ci95HalfWidth} of ${mu}`);
  assert.ok(s.ci95HalfWidth < 0.005 && s.ci95HalfWidth > 0);
  assert.ok(Math.abs(s.sd - Math.sqrt(0.02 ** 2 / 2 + 0.005 ** 2)) < 0.002); // sine variance a^2/2 plus the noise
  assert.equal(timeWindowVerdict(s).settled, true);
  // the discarded part really is discarded: a wild start-up transient does not move the mean
  const wild = xs.map((x, i) => (i < 1000 ? x + 5 : x));
  assert.equal(timeWindowStatistics(rowsOf(wild, dt), "Cd", { discardTime: 1, windowTime: 2 }).mean, s.mean);
});

test("timeWindowStatistics: a trending series is not settled", () => {
  const r = rng(11), dt = 0.001;
  const xs = Array.from({ length: 3000 }, (_, i) => 0.3 - 0.03 * (i / 2999) + 0.005 * gauss(r));
  const s = timeWindowStatistics(rowsOf(xs, dt), "Cd", { discardTime: 1, windowTime: 2 });
  const v = timeWindowVerdict(s);
  assert.equal(v.settled, false);
  assert.match(v.reasons.join(), /still moving/);
  assert.ok(s.halfDiff < 0, "the second half is lower");
});

test("timeWindowStatistics: autocorrelation widens the uncertainty that sd/sqrt(n) understates", () => {
  const r = rng(3), dt = 0.001, phi = 0.98, sig = 0.01;
  const innov = sig * Math.sqrt(1 - phi * phi);
  let x = 0;
  const xs = Array.from({ length: 22000 }, () => (x = phi * x + innov * gauss(r)) + 0.3);
  const s = timeWindowStatistics(rowsOf(xs, dt), "Cd", { discardTime: 2, windowTime: 20 });
  // AR(1): Var(mean) = sd^2/n * (1+phi)/(1-phi), so the true standard error is sqrt(99) = 9.95 times the naive one
  const ratio = s.seMean / s.naiveSeMean;
  assert.ok(ratio > 4 && ratio < 20, `batch-means se is ${ratio.toFixed(1)} x the naive se`);
  assert.ok(s.effectiveSamples < s.samples / 10, `${s.effectiveSamples} effective of ${s.samples}`);
  assert.ok(s.integralTimeScale > 0.005, `T_int ${s.integralTimeScale} s (theory ~0.05 s for phi 0.98 at dt 1 ms)`);
});

test("timeWindowStatistics: refuses what it cannot reduce honestly", () => {
  const dt = 0.001, xs = Array(3000).fill(0.3);
  const rows = rowsOf(xs, dt);
  const w = { discardTime: 1, windowTime: 2 };
  assert.throws(() => timeWindowStatistics(rows, "Cd", { discardTime: 1, windowTime: 5 }), /window needs/);
  assert.throws(() => timeWindowStatistics(rows, "Cd", { discardTime: -1, windowTime: 2 }), /discardTime/);
  assert.throws(() => timeWindowStatistics(rows, "Cd", { discardTime: 1 }), /windowTime/);
  assert.throws(() => timeWindowStatistics(rows, "Cz", w), /Cz/);
  assert.throws(() => timeWindowStatistics(rows.slice(0, 1), "Cd", w), /at least 2 rows/);
  assert.throws(() => timeWindowStatistics(rowsOf(xs, dt).map((r, i) => (i === 1500 ? { ...r, Time: r.Time + 0.0004 } : r)), "Cd", w), /not uniform/);
  assert.throws(() => timeWindowStatistics(rows, "Cd", { discardTime: 0, windowTime: 0.1 }), /batches need/);
  assert.equal(TRANSIENT_LIMITS.batches, 20);
  // a flat series has zero spread: settled, with a zero interval (no division blow-up)
  const flat = timeWindowStatistics(rows, "Cd", w);
  assert.ok(flat.sd < 1e-12 && flat.ci95HalfWidth < 1e-12);
  assert.equal(timeWindowVerdict(flat).settled, true);
});

// ---------- per-turbulence Ahmed gate ----------

test("validation: a RANS record never accepts a DES result, nor a DES record a RANS one", () => {
  const settled = (turbulence) => ({ turbulence, status: "settled", target: 0.285, total: { mean: 0.285 * 1.02 } });
  assert.equal(validationAccepted(settled("rans"), "rans").accepted, true);
  assert.equal(validationAccepted(settled("ddes"), "ddes").accepted, true);
  const a = validationAccepted(settled("rans"), "ddes");
  assert.equal(a.accepted, false);
  assert.match(a.reason, /rans Ahmed 25 deg validation does not validate a ddes result/);
  const b = validationAccepted(settled("ddes"), "rans");
  assert.equal(b.accepted, false);
  assert.match(b.reason, /ddes Ahmed 25 deg validation does not validate a rans result/);
  // a record with no turbulence field is a RANS record (the existing shape)
  assert.equal(validationAccepted({ status: "settled", target: 0.285, total: { mean: 0.285 } }, "ddes").accepted, false);
  assert.equal(validationAccepted({ status: "settled", target: 0.285, total: { mean: 0.285 } }).accepted, true);
});

test("validation: the DES Ahmed record is pending and separate; unknown models have none", () => {
  assert.equal(AHMED_DES_VALIDATION.status, "pending");
  assert.equal(AHMED_DES_VALIDATION.turbulence, "ddes");
  assert.equal(AHMED_CFD_VALIDATION.turbulence, "rans");
  assert.notEqual(validationFor("ddes"), validationFor("rans"));
  assert.equal(validationFor("ddes"), AHMED_DES_VALIDATION);
  assert.equal(validationAccepted(AHMED_DES_VALIDATION, "ddes").accepted, false);
  assert.match(validationAccepted(AHMED_DES_VALIDATION, "ddes").reason, /DDES validation is pending/);
  assert.throws(() => validationFor("iddes"), /no Ahmed validation record/);
  assert.throws(() => validationFor("toString"), /no Ahmed validation record/);
});

// ---------- the solver ----------

const HDR = "# Force coefficients\n# magUInf       : 4.0e+01\n# lRef          : 1.0\n# Aref          : 2.0\n# Time\tCm\tCd\tCl\tCl(f)\tCl(r)\n";
const KEY = "fedcba9876543210fedcba98";

function fakeDesRun(xs, dt) {
  const run = tmp("run");
  const d = path.join(run, "postProcessing/fc_total/0");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "forceCoeffs.dat"), HDR + xs.map((cd, i) => `${(i * dt).toFixed(9)}\t0\t${cd}\t0.1\t0\t0`).join("\n"));
  return run;
}
function ctxFor(stepPath) {
  const cad = { runId: "cad.body@BODY", status: "PASS", outputs: { kernel: { value: { requestHash: KEY } }, files: { value: { step: { path: stepPath } } } } };
  return {
    get: (id, p) => (id === "CAR" && p === "props.vehicle.frontalAreaFrom" ? "BODY" : id === "BODY" && p === "geometry" ? { shape: "cad-body" } : undefined),
    result: (solver, id) => (solver === "cad.body" && id === "BODY" ? cad : null),
  };
}

test("aero.cfd: a DES run is reduced with the time window and refused while the DES validation is pending", () => {
  const s = getSolver("aero.cfd");
  const store = tmp("solver");
  const prev = process.env.CONKAY_CFD_DIR;
  process.env.CONKAY_CFD_DIR = store;
  try {
    const step = path.join(store, "body.step");
    fs.writeFileSync(step, "ISO-10303-21;\n");
    const kernelSha256 = sha256File(fileURLToPath(new URL("../lib/conkay/cfd/openfoam_case.py", import.meta.url)));
    const dt = 0.001;
    const des = { discardTimeS: 1, windowTimeS: 2, stepsPerFlowThrough: 1000, flowThroughsDiscard: 1, flowThroughsAverage: 2 };
    const meta = (extra = {}) => ({ stepSha256: sha256File(step), case: { preset: "car5m", aref: 2, lref: 1, endTime: 4000, caseSha256: "c", kernelSha256, turbulence: "ddes", des, ...extra } });
    const imp = (xs, m = meta()) => importRun(KEY, { postProcessingDir: path.join(fakeDesRun(xs, dt), "postProcessing") }, m);
    const r = rng(5);

    // a stationary noisy series: settled by the window statistics, but the DDES validation is pending
    const ok = Array.from({ length: 3000 }, () => 0.3 + 0.01 * gauss(r));
    imp(ok);
    let out = s.run(ctxFor(step), "CAR");
    assert.match(out.notComputed, /Ahmed 25 deg DDES validation is pending/);
    assert.equal(out.outputs.unvalidated.status, "not_a_result");
    const direct = timeWindowStatistics(rowsOf(ok, dt), "Cd", { discardTime: 1, windowTime: 2 });
    assert.ok(Math.abs(out.outputs.unvalidated.value.meanCd - direct.mean) < 1e-12, "reduced over the time window, not the last 500 rows");
    assert.equal(out.inputs.run.value.turbulence, "ddes");

    // a drifting series fails the DES settled check before the gate is consulted
    imp(Array.from({ length: 3000 }, (_, i) => 0.3 - 0.03 * (i / 2999) + 0.005 * gauss(r)));
    out = s.run(ctxFor(step), "CAR");
    assert.match(out.notComputed, /did not settle/);
    assert.match(out.notComputed, /still moving/);
    assert.equal(out.outputs.unsettled.status, "not_a_result");

    // a run shorter than its averaging window
    imp(ok.slice(0, 2000));
    assert.match(s.run(ctxFor(step), "CAR").notComputed, /ddes run is too short.*window needs/);

    // a DES record with no averaging window, and an unknown turbulence treatment
    importRun(KEY, { postProcessingDir: path.join(fakeDesRun(ok, dt), "postProcessing") }, meta({ des: undefined }));
    assert.match(s.run(ctxFor(step), "CAR").notComputed, /no averaging window/);
    importRun(KEY, { postProcessingDir: path.join(fakeDesRun(ok, dt), "postProcessing") }, meta({ turbulence: "iddes" }));
    assert.match(s.run(ctxFor(step), "CAR").notComputed, /unknown turbulence treatment "iddes"/);
  } finally {
    if (prev == null) delete process.env.CONKAY_CFD_DIR; else process.env.CONKAY_CFD_DIR = prev;
  }
});

test("aero.cfd: a RANS run still reports the RANS validation, not the DES one", () => {
  const s = getSolver("aero.cfd");
  const store = tmp("solver-rans");
  const prev = process.env.CONKAY_CFD_DIR;
  process.env.CONKAY_CFD_DIR = store;
  try {
    const step = path.join(store, "body.step");
    fs.writeFileSync(step, "ISO-10303-21;\n");
    const kernelSha256 = sha256File(fileURLToPath(new URL("../lib/conkay/cfd/openfoam_case.py", import.meta.url)));
    const run = tmp("r");
    const d = path.join(run, "postProcessing/fc_total/0");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "forceCoeffs.dat"), HDR + Array.from({ length: 600 }, (_, i) => `${i + 1}\t0\t0.25\t0.1\t0\t0`).join("\n"));
    importRun(KEY, { postProcessingDir: path.join(run, "postProcessing") }, { stepSha256: sha256File(step), case: { preset: "car5m", aref: 2, lref: 1, endTime: 600, caseSha256: "c", kernelSha256 } });
    const out = s.run(ctxFor(step), "CAR");
    assert.match(out.notComputed, /Ahmed 25 deg validation is pending/);
    assert.doesNotMatch(out.notComputed, /DDES/);
  } finally {
    if (prev == null) delete process.env.CONKAY_CFD_DIR; else process.env.CONKAY_CFD_DIR = prev;
  }
});

test("parseForceCoeffs round-trips the DES series the tests write", () => {
  const p = parseForceCoeffs(HDR + "0.000000000\t0\t0.3\t0.1\t0\t0\n0.001000000\t0\t0.31\t0.1\t0\t0");
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[1].Time, 0.001);
});
