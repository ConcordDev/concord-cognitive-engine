// tests/conkay-aero-cfd.test.js — aero.cfd: the OpenFOAM case kernel, forceCoeffs reduction,
// the run store, the Ahmed acceptance gate, and the solver's NOT_COMPUTED paths.
//
// Passing these tests is not physical validation: the physics lives in the recorded OpenFOAM
// runs (tests/fixtures/conkay-cfd), and these tests only check that the numbers are reduced,
// matched and gated honestly.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeCase, fitsPreset } from "../lib/conkay/cfd/openfoam-case.js";
import { parseForceCoeffs, tailStatistics, convergenceVerdict, mergeForceCoeffs, parseSnappySummary, CONVERGENCE_LIMITS } from "../lib/conkay/cfd/force-coeffs.js";
import { importRun, readRun, sha256File } from "../lib/conkay/cfd/run-store.js";
import { validationAccepted, AHMED_CFD_VALIDATION, AHMED_TOLERANCE } from "../lib/conkay/cfd/validation.js";
import { getSolver } from "../lib/conkay/physics/registry.js";
import { AHMED_GANT_25 } from "../lib/conkay/aero/calibrated-drag.js";
import "../lib/conkay/physics/solvers/aero-cfd.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures/conkay-cfd/ahmed25");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `conkay-cfd-${p}-`));
const read = (f) => fs.readFileSync(f, "utf8");

// ---------- case kernel ----------

test("case kernel: the recorded runs' cases are reproduced exactly (pinned caseSha256)", async () => {
  // These are the hashes of the dictionaries that ran on the pod (diffed byte-for-byte when recorded).
  const cases = [
    [{ preset: "ahmed", nproc: 7, endTime: 2000 }, "75a5f0dced2b2e5eff78bf26aacc95047d53350cbfdd35a29c2407756b5b9e17"],
    [{ preset: "ahmed", nproc: 7, endTime: 4000 }, "de740ee555abab986906e2b369164375bfad4ed6464428b740b0a88b2522cad7"],
    [{ preset: "car5m", nproc: 7, endTime: 4000, aref: 2.062284, lref: 5.185 }, "8084cfd0b4dd9cf965e6f1cc8aaa7e0a6fe3bb49b2d1e56cad11f1084b24617d"],
    [{ preset: "car5m", nproc: 7, endTime: 4000, aref: 2.060492, lref: 5.185 }, "d4b8d04f1619798196e993d9c4003dd48287fc6db6f991989141e46cf0e301ed"],
  ];
  for (const [req, sha] of cases) {
    const r = await writeCase(req);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.caseSha256, sha, JSON.stringify(req));
    assert.match(r.kernelSha256, /^[0-9a-f]{64}$/);
  }
});

test("case kernel: written case carries the three fixes found on the first run", async () => {
  const out = tmp("case");
  const r = await writeCase({ preset: "ahmed", outDir: out, nproc: 7, endTime: 2000 });
  assert.equal(r.ok, true, r.error);
  for (const f of ["U", "p", "k", "omega", "nut"]) {
    // decomposed fields cannot be read without an entry for the processor patches
    assert.match(read(path.join(out, "0", f)), /"proc\.\*" \{ type processor; \}/, f);
  }
  // potentialFoam needs a Phi solver
  assert.match(read(path.join(out, "system/fvSolution")), /Phi \{ \$p; \}/);
  // each symmetryPlane patch must be one plane: the two sides are separate patches
  const bm = read(path.join(out, "system/blockMeshDict"));
  assert.match(bm, /sideL\s+\{ type symmetryPlane; faces \(\(3 7 6 2\)\); \}/);
  assert.match(bm, /sideR\s+\{ type symmetryPlane; faces \(\(1 5 4 0\)\); \}/);
  // the OpenFOAM bashrc exits non-zero under set -e: it is sourced before set -e
  const allrun = read(path.join(out, "Allrun"));
  assert.ok(allrun.indexOf("source /opt/openfoam12/etc/bashrc || true") < allrun.indexOf("set -e"));
  assert.match(read(path.join(out, "system/decomposeParDict")), /numberOfSubdomains 7;/);
  assert.match(read(path.join(out, "system/controlDict")), /endTime 2000;/);
  assert.equal((fs.statSync(path.join(out, "Allrun")).mode & 0o111) !== 0, true);
  // the Ahmed preset reports per-part forces for the component comparison
  for (const p of ["total", "nose", "slant", "base", "rest"]) assert.match(read(path.join(out, "system/controlDict")), new RegExp(`fc_${p}`));
});

test("case kernel: invalid requests are refused, never defaulted", async () => {
  const bad = [
    { preset: "wing", nproc: 7, endTime: 10 },
    { preset: "ahmed", nproc: 0, endTime: 10 },
    { preset: "ahmed", nproc: 2.5, endTime: 10 },
    { preset: "ahmed", nproc: true, endTime: 10 },
    { preset: "ahmed", nproc: 7 },
    { preset: "car5m", nproc: 7, endTime: 10, lref: 5 },
    { preset: "car5m", nproc: 7, endTime: 10, aref: -1, lref: 5 },
    { preset: "car5m", nproc: 7, endTime: 10, aref: 2, lref: "5" },
  ];
  for (const req of bad) {
    const r = await writeCase(req);
    assert.equal(r.ok, false, JSON.stringify(req));
    assert.ok(r.error);
  }
});

test("fitsPreset: a body outside the finest refinement box is rejected", () => {
  const fits = { min: [-0.3, -1.25, 0], max: [7.5, 1.25, 1.7] };
  assert.equal(fitsPreset({ min: [0.1, -0.97, 0.09], max: [5.285, 0.97, 1.28] }, fits), true);
  assert.equal(fitsPreset({ min: [0.1, -1.3, 0.09], max: [5.285, 1.3, 1.28] }, fits), false);
});

// ---------- forceCoeffs ----------

const HDR = "# Force coefficients\n# magUInf       : 4.0e+01\n# lRef          : 1.0\n# Aref          : 2.0\n# Time\tCm\tCd\tCl\tCl(f)\tCl(r)\n";
const rowsText = (from, cds) => cds.map((cd, i) => `${from + i}\t0\t${cd}\t0.1\t0\t0`).join("\n");

test("parseForceCoeffs: malformed input throws", () => {
  assert.throws(() => parseForceCoeffs(""), /empty/);
  assert.throws(() => parseForceCoeffs("1 2 3"), /before the column header/);
  assert.throws(() => parseForceCoeffs(HDR + "1\t0\t0.3"), /3 values/);
  assert.throws(() => parseForceCoeffs(HDR + "1\t0\tnan\t0\t0\t0"), /non-finite/);
  assert.throws(() => parseForceCoeffs(HDR + "2\t0\t0.3\t0\t0\t0\n1\t0\t0.3\t0\t0\t0"), /not increasing/);
  assert.throws(() => parseForceCoeffs(HDR.replace(/# Aref.*\n/, "") + "1\t0\t0.3\t0\t0\t0"), /Aref/);
  assert.throws(() => parseForceCoeffs(HDR.replace("Cd", "Cx") + "1\t0\t0.3\t0\t0\t0"), /no Cd/);
});

test("tailStatistics + convergenceVerdict: flat and trending series", () => {
  const flat = parseForceCoeffs(HDR + rowsText(1, Array(600).fill(0.3)));
  const s = tailStatistics(flat.rows, "Cd", 500);
  assert.ok(Math.abs(s.mean - 0.3) < 1e-12); assert.ok(s.sd < 1e-12); assert.equal(s.fromTime, 101); assert.equal(s.toTime, 600);
  assert.equal(convergenceVerdict(s).settled, true);
  // a steady 0.3 -> 0.27 slide: sd small, but the halves disagree
  const trend = parseForceCoeffs(HDR + rowsText(1, Array.from({ length: 500 }, (_, i) => 0.3 - 0.03 * i / 499)));
  const v = convergenceVerdict(tailStatistics(trend.rows, "Cd", 500));
  assert.equal(v.settled, false);
  assert.match(v.reasons.join(), /drift/);
  assert.throws(() => tailStatistics(flat.rows, "Cd", 700), /window needs 700/);
  assert.throws(() => tailStatistics(flat.rows, "Cd", 3), />= 4/);
  assert.throws(() => tailStatistics(flat.rows, "Cz", 10), /Cz/);
});

test("mergeForceCoeffs: a restart overrides the overlap; mismatched references are refused", () => {
  const a = parseForceCoeffs(HDR + rowsText(1, Array(10).fill(0.3)));
  const b = parseForceCoeffs(HDR + rowsText(8, Array(5).fill(0.2)));
  const m = mergeForceCoeffs([b, a]);
  assert.deepEqual(m.rows.map((r) => r.Time), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(m.rows[7].Cd, 0.2);
  const c = parseForceCoeffs(HDR.replace("2.0", "3.0") + rowsText(20, [0.3]));
  assert.throws(() => mergeForceCoeffs([a, c]), /Aref differs/);
  assert.throws(() => mergeForceCoeffs([]), /no segments/);
});

// ---------- Ahmed fixture: the first 2000-iteration run ----------

test("Ahmed 25 deg, first run (2000 its): total near 0.29 but NOT settled — and is not accepted", () => {
  const p = (n) => parseForceCoeffs(read(path.join(FIX, `fc_${n}.dat`)));
  const total = p("total");
  assert.equal(total.header.Aref, 0.112032); // W x H = 0.389 x 0.288 (AHMED_GEOMETRY)
  assert.equal(total.header.magUInf, 40);
  const s = tailStatistics(total.rows, "Cd", 500);
  assert.equal(s.fromTime, 1501); assert.equal(s.toTime, 2000);
  assert.ok(Math.abs(s.mean - 0.29339) < 5e-5, String(s.mean));
  assert.ok(s.relDrift > CONVERGENCE_LIMITS.maxRelDrift, "the slant-to-base migration shows as drift");
  assert.equal(convergenceVerdict(s).settled, false);
  // slant falls, base rises across the window (pressure moving from the slant to the base)
  const slant = tailStatistics(p("slant").rows, "Cd", 500), base = tailStatistics(p("base").rows, "Cd", 500);
  assert.ok(slant.secondHalfMean < slant.firstHalfMean && base.secondHalfMean > base.firstHalfMean);
  // gant's 25 deg total is the target the acceptance uses
  assert.equal(AHMED_GANT_25.total, 0.285);
  const snap = parseSnappySummary(read(path.join(FIX, "snappy-summary.txt")));
  assert.equal(snap.cells, 5623724);
  assert.equal(snap.openfoamBuild, "12-86e126a7bc4d");
  for (const k of ["ahmed_nose", "ahmed_slant", "ahmed_base", "ahmed_rest"]) assert.ok(snap.layers[k].coveragePct >= 99, k);
});

test("validationAccepted: pending, a 6 % miss and a 3 % hit", () => {
  assert.equal(AHMED_CFD_VALIDATION.status, "pending");
  assert.equal(validationAccepted().accepted, false);
  const rec = (mean) => ({ status: "settled", target: 0.285, total: { mean } });
  assert.equal(validationAccepted(rec(0.285 * 1.06)).accepted, false);
  assert.equal(validationAccepted(rec(0.285 * 0.94)).accepted, false);
  const ok = validationAccepted(rec(0.285 * 1.03));
  assert.equal(ok.accepted, true);
  assert.ok(Math.abs(ok.relError - 0.03) < 1e-12);
  assert.equal(AHMED_TOLERANCE.relError, 0.05);
});

// ---------- run store ----------

function fakeRun(cds) {
  const run = tmp("run");
  const d = path.join(run, "postProcessing/fc_total/0");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "forceCoeffs.dat"), HDR + rowsText(1, cds));
  return run;
}
const KEY = "0123456789abcdef01234567";

test("run store: import, read back, and refuse tampering or a wrong key", () => {
  const store = tmp("store");
  const run = fakeRun(Array(600).fill(0.3));
  const rec = importRun(KEY, { postProcessingDir: path.join(run, "postProcessing") }, { stepSha256: "s", case: { aref: 2 } }, { dir: store });
  assert.equal(rec.schema, "conkay-cfd-run/1");
  const r = readRun(KEY, { dir: store });
  assert.equal(r.forces.fc_total.rows.length, 600);
  assert.equal(readRun("abcdefabcdefabcdefabcdef", { dir: store }), null);
  assert.throws(() => readRun("../etc", { dir: store }), /24-hex/);
  fs.appendFileSync(path.join(store, KEY, "forceCoeffs/fc_total/0.dat"), "601\t0\t0.1\t0\t0\t0\n");
  assert.match(readRun(KEY, { dir: store }).error, /receipt hash/);
  assert.throws(() => importRun(KEY, { postProcessingDir: path.join(store, "nope") }, {}, { dir: store }), /missing/);
});

// ---------- the solver ----------

function ctxFor({ stepPath, key = KEY }) {
  const cad = { runId: "cad.body@BODY", status: "PASS", outputs: { kernel: { value: { requestHash: key } }, files: { value: { step: { path: stepPath } } } } };
  return {
    get: (id, p) => (id === "CAR" && p === "props.vehicle.frontalAreaFrom" ? "BODY" : id === "BODY" && p === "geometry" ? { shape: "cad-body" } : undefined),
    result: (solver, id) => (solver === "cad.body" && id === "BODY" ? cad : null),
  };
}

test("aero.cfd: registered as an L4 solver with its declarations", () => {
  const s = getSolver("aero.cfd");
  assert.ok(s);
  assert.equal(s.fidelity, 4);
  assert.equal(s.screening, false);
  for (const k of ["regime", "reference", "tolerance", "units", "method"]) assert.ok(s[k], k);
  const g = { nodesOfKind: () => [{ id: "A", props: { vehicle: { cfd: "aero.cfd" } } }, { id: "B", props: { vehicle: {} } }] };
  assert.deepEqual(s.targets(g), ["A"]);
});

test("aero.cfd: NOT_COMPUTED with no record, a different STEP, an unsettled run, or an unaccepted template", () => {
  const s = getSolver("aero.cfd");
  const store = tmp("solver");
  const prev = process.env.CONKAY_CFD_DIR;
  process.env.CONKAY_CFD_DIR = store;
  try {
    const step = path.join(store, "body.step");
    fs.writeFileSync(step, "ISO-10303-21;\n");
    let r = s.run(ctxFor({ stepPath: step }), "CAR");
    assert.match(r.notComputed, /no OpenFOAM run is recorded/);
    assert.match(r.notComputed, /conkay-cfd\.mjs case --body/);

    const kernelSha256 = sha256File(fileURLToPath(new URL("../lib/conkay/cfd/openfoam_case.py", import.meta.url)));
    const meta = (cds) => ({ stepSha256: sha256File(step), case: { preset: "car5m", aref: 2, lref: 1, endTime: cds.length, caseSha256: "c", kernelSha256 } });
    // a different STEP
    importRun(KEY, { postProcessingDir: path.join(fakeRun(Array(600).fill(0.3)), "postProcessing") }, { ...meta(Array(600)), stepSha256: "other" });
    assert.match(s.run(ctxFor({ stepPath: step }), "CAR").notComputed, /made on STEP/);
    // a case kernel other than the validated template
    importRun(KEY, { postProcessingDir: path.join(fakeRun(Array(600).fill(0.3)), "postProcessing") }, { ...meta(Array(600)), case: { ...meta(Array(600)).case, kernelSha256: "x" } });
    assert.match(s.run(ctxFor({ stepPath: step }), "CAR").notComputed, /not the validated template/);
    // an unsettled (trending) run: NOT_COMPUTED, its statistics kept and labelled not_a_result
    const trend = Array.from({ length: 600 }, (_, i) => 0.3 - 0.03 * i / 599);
    importRun(KEY, { postProcessingDir: path.join(fakeRun(trend), "postProcessing") }, meta(trend));
    r = s.run(ctxFor({ stepPath: step }), "CAR");
    assert.match(r.notComputed, /did not settle/);
    assert.equal(r.outputs.unsettled.status, "not_a_result");
    // a settled run, but the template's Ahmed validation is still pending
    const flat = Array(600).fill(0.25);
    importRun(KEY, { postProcessingDir: path.join(fakeRun(flat), "postProcessing") }, meta(flat));
    r = s.run(ctxFor({ stepPath: step }), "CAR");
    assert.match(r.notComputed, /Ahmed 25 deg validation is pending/);
    assert.equal(r.outputs.unvalidated.status, "not_a_result");
    // the cad body missing
    const none = { get: () => "BODY", result: () => null };
    assert.match(s.run({ ...none, get: (id, p) => (p === "geometry" ? { shape: "cad-body" } : "BODY") }, "CAR").notComputed, /not computed/);
  } finally {
    if (prev == null) delete process.env.CONKAY_CFD_DIR; else process.env.CONKAY_CFD_DIR = prev;
  }
});
