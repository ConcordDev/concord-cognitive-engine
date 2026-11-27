// tests/conkay-aero-lbm.test.js — aero.lbm: the OpenLB case kernel, force-series reduction,
// the run store, the Ahmed acceptance gate, and the solver's NOT_COMPUTED paths.
//
// Passing these tests is not physical validation: the physics lives in the recorded GPU run
// (tests/fixtures/conkay-lbm/ahmed25), and these tests only check that the numbers are reduced,
// matched and gated honestly.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeLbmCase } from "../lib/conkay/cfd/lbm/lbm-case.js";
import { parseLbmForces, windowStatistics, lbmVerdict, blockHistory, LBM_LIMITS } from "../lib/conkay/cfd/lbm/force-series.js";
import { importLbmRun, readLbmRun } from "../lib/conkay/cfd/lbm/run-store.js";
import { sha256File } from "../lib/conkay/cfd/run-store.js";
import { LBM_AHMED_VALIDATION, lbmValidationAccepted, currentTemplate, AHMED_TOLERANCE } from "../lib/conkay/cfd/lbm/validation.js";
import { getSolver } from "../lib/conkay/physics/registry.js";
import { AHMED_GANT_25 } from "../lib/conkay/aero/calibrated-drag.js";
import "../lib/conkay/physics/solvers/aero-lbm.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures/conkay-lbm/ahmed25");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `conkay-lbm-${p}-`));
const read = (f) => fs.readFileSync(f, "utf8");

// ---------- case kernel ----------

const CAR = { preset: "car", res: 100, tend: 1, lref: 4.2, aref: 2.0, stl: "body.stl", bbox: { min: [0, -0.9, 0.1], max: [4.2, 0.9, 1.4] }, maxMnodes: 200 };

test("case kernel: deterministic, and the written files carry the hashes it replies with", async () => {
  const out = tmp("case");
  const a = await writeLbmCase({ preset: "ahmed", res: 185, tend: 0.94, sample: 500 });
  const b = await writeLbmCase({ preset: "ahmed", res: 185, tend: 0.94, sample: 500, outDir: out });
  assert.equal(a.ok, true, a.error);
  assert.equal(a.caseSha256, b.caseSha256);
  assert.match(a.kernelSha256, /^[0-9a-f]{64}$/);
  for (const [f, sha] of Object.entries(b.files)) assert.equal(sha256File(path.join(out, f)), sha, f);
  // the C++ program is copied byte-for-byte, so the case hash covers the code that ran
  assert.equal(b.files["aero_lbm.cpp"], sha256File(fileURLToPath(new URL("../lib/conkay/cfd/lbm/aero_lbm.cpp", import.meta.url))));
  assert.equal((fs.statSync(path.join(out, "run.sh")).mode & 0o111) !== 0, true);
  assert.equal((fs.statSync(path.join(out, "stl.sh")).mode & 0o111) !== 0, true);
  const cj = JSON.parse(read(path.join(out, "case.json")));
  assert.equal(cj.openlb, "olb-1.9r0");
  assert.equal(cj.flow.ulat, 0.05); // lattice Mach 0.087
  assert.ok(cj.estimate.gpuGiB < 7, "the Ahmed case fits the 7 GB budget on the shared pod");
  assert.match(read(path.join(out, "run.sh")), /--res=185 .*--regions=ahmed/);
  // gmsh writes one solid per physical group and OpenLB reads only the first: the script merges them
  assert.match(read(path.join(out, "stl.sh")), /drop = set\(solid\[1:\]\) \| set\(endsolid\[:-1\]\)/);
  assert.match(read(path.join(out, "ahmed.geo")), /L = 1\.044; W = 0\.389; H = 0\.288/);
});

test("case kernel: a different request gives a different case", async () => {
  const a = await writeLbmCase({ preset: "ahmed", res: 185, tend: 0.94 });
  const b = await writeLbmCase({ preset: "ahmed", res: 180, tend: 0.94 });
  const c = await writeLbmCase({ preset: "ahmed", res: 185, tend: 0.95 });
  assert.notEqual(a.caseSha256, b.caseSha256);
  assert.notEqual(a.caseSha256, c.caseSha256);
});

test("case kernel: the car preset sizes the domain from the body box and has no Ahmed regions", async () => {
  const out = tmp("car");
  const r = await writeLbmCase({ ...CAR, outDir: out });
  assert.equal(r.ok, true, r.error);
  const cj = JSON.parse(read(path.join(out, "case.json")));
  assert.equal(cj.domain.xmin, -2.814); // 0.67 L upstream of the nose
  assert.equal(cj.domain.xmax, 10.668); // 1.54 L behind the base
  assert.equal(cj.domain.zmax, 4.858); // 3.47 H
  assert.match(read(path.join(out, "run.sh")), /--regions=none/);
  assert.match(read(path.join(out, "stl.sh")), /gmsh body\.step -2 -format stl -clmax 0\.015/);
  assert.equal(fs.existsSync(path.join(out, "ahmed.geo")), false);
});

test("case kernel: invalid requests are refused, never defaulted", async () => {
  const bad = [
    { preset: "wing", res: 185, tend: 1 },
    { preset: "ahmed", tend: 1 },
    { preset: "ahmed", res: 10, tend: 1 },
    { preset: "ahmed", res: 185.5, tend: 1 },
    { preset: "ahmed", res: true, tend: 1 },
    { preset: "ahmed", res: 185 },
    { preset: "ahmed", res: 185, tend: 0 },
    { preset: "ahmed", res: 185, tend: 11 },
    { preset: "ahmed", res: 185, tend: 1, sample: 0 },
    { preset: "ahmed", res: 185, tend: 1, sample: 2.5 },
    { preset: "ahmed", res: 185, tend: 1, maxMnodes: -1 },
    // over the memory cap: refused, not silently coarsened
    { preset: "ahmed", res: 200, tend: 1 },
    { ...CAR, lref: undefined },
    { ...CAR, aref: -1 },
    { ...CAR, aref: "2" },
    { ...CAR, stl: "../body.stl" },
    { ...CAR, stl: "body.obj" },
    { ...CAR, bbox: undefined },
    { ...CAR, bbox: { min: [0, -0.9, 0.1], max: [0, 0.9, 1.4] } },
    { ...CAR, bbox: { min: [0, -0.9, -0.5], max: [4.2, 0.9, 1.4] } },
    { ...CAR, bbox: { min: [0, -0.9, 0.1], max: [4.2, 0.9, NaN] } },
    { ...CAR, bbox: { min: [0, -0.9], max: [4.2, 0.9] } },
    { ...CAR, res: 400, maxMnodes: 36 }, // a car at 36 M nodes is about 24 mm cells; 400 over 4.2 m is far past it
  ];
  for (const req of bad) {
    const r = await writeLbmCase(req);
    assert.equal(r.ok, false, JSON.stringify(req));
    assert.ok(r.error);
  }
  const over = await writeLbmCase({ preset: "ahmed", res: 200, tend: 1 });
  assert.match(over.error, /over the 36 M cap|over the 36\.0 M cap/);
});

// ---------- force series ----------

const HDR = (extra = "") => `# ahmed_lbm OpenLB 1.9r0 float D3Q19 dynamics=smagorinsky smago=0.15
# res=185 lref=1.044 ftt_s=0.0261 dx=0.0056432 dt=7.05e-06 U=40 nu=1.5e-05 rho=1.225 ulat=0.05 omega=1.99997${extra}
# domain x[-0.7,2.65] y[-0.95,0.95] z[0,1] nodes=35424000
# Aref=0.112032 qinf=980 Cd=Fx/(qinf*Aref) regions=ahmed (prose that must not become header keys)
# step t_s Cd Cl Fx_nose Fx_slant Fx_base Fx_rest Fz_total maxU_lat rho_avg wall_s
`;
/** one row per 1/10 flow-through, Cd from fn(t in flow-throughs) */
function synth(nFtt, fn, { done = true, hdr = HDR() } = {}) {
  const ftt = 0.0261, dt = ftt / 10;
  const lines = [];
  for (let i = 1; i <= nFtt * 10; i++) {
    const t = i * dt, cd = fn(t / ftt);
    lines.push(`${i * 100} ${t.toFixed(8)} ${cd.toFixed(6)} 0.1 0 0 0 0 0 0.07 1.0 ${i}`);
  }
  return hdr + lines.join("\n") + "\n" + (done ? "# done steps=1\n" : "");
}
const wobble = (t) => 0.3 + 0.02 * Math.sin(2 * Math.PI * t / 0.37);

test("parseLbmForces: header keys, columns and rows; prose in comments is not data", () => {
  const s = parseLbmForces(synth(4, () => 0.3));
  assert.equal(s.header.res, 185);
  assert.equal(s.header.lref, 1.044);
  assert.equal(s.header.Aref, 0.112032);
  assert.equal(s.header.nodes, 35424000);
  assert.equal(s.header.dynamics, "smagorinsky");
  assert.equal("Cd" in s.header, false);
  assert.equal(s.columns.length, 12);
  assert.equal(s.rows.length, 40);
  assert.equal(s.done, true);
  assert.equal(s.diverged, false);
  assert.equal(parseLbmForces(synth(2, () => 0.3, { done: false })).done, false);
  assert.equal(parseLbmForces(synth(2, () => 0.3) + "# DIVERGED step 9\n").diverged, true);
});

test("parseLbmForces: malformed input throws", () => {
  assert.throws(() => parseLbmForces(""), /empty/);
  assert.throws(() => parseLbmForces("1 2 3"), /before the column header/);
  assert.throws(() => parseLbmForces(HDR() + "100 0.1 0.3 0.1"), /4 values/);
  assert.throws(() => parseLbmForces(HDR() + "100 0.1 nan 0.1 0 0 0 0 0 0.07 1 1"), /non-finite/);
  assert.throws(() => parseLbmForces(HDR() + "200 0.2 0.3 0.1 0 0 0 0 0 0.07 1 1\n100 0.3 0.3 0.1 0 0 0 0 0 0.07 1 2"), /step not increasing/);
  assert.throws(() => parseLbmForces(HDR().replace(/ ftt_s=\S+/, "") + "100 0.1 0.3 0.1 0 0 0 0 0 0.07 1 1"), /ftt_s/);
  assert.throws(() => parseLbmForces(HDR().replace("Aref=0.112032", "Aref=0")), /Aref/);
  assert.throws(() => parseLbmForces(HDR().replace(" Cd ", " Cx ")), /no Cd/);
});

test("windowStatistics + lbmVerdict: a steady oscillation settles; a drift, a short run and a coarse window do not", () => {
  const ok = parseLbmForces(synth(36, wobble));
  const s = windowStatistics(ok, "Cd");
  assert.equal(s.flowThroughs, LBM_LIMITS.windowFlowThroughs);
  assert.ok(Math.abs(s.mean - 0.3) < 2e-3, String(s.mean));
  assert.ok(s.sd > 0.01, "the oscillation is physical, not a settled-ness failure");
  assert.equal(s.blocks, 24);
  assert.equal(lbmVerdict(s).settled, true, lbmVerdict(s).reasons.join());
  // a slide from 0.30 to 0.27 across the window: halves disagree
  const slide = parseLbmForces(synth(36, (t) => 0.3 - 0.03 * Math.max(0, t - 12) / 24));
  const v = lbmVerdict(windowStatistics(slide, "Cd"));
  assert.equal(v.settled, false);
  assert.match(v.reasons.join(), /drift/);
  // too few blocks for a standard error
  const short = parseLbmForces(synth(36, wobble));
  const few = windowStatistics(short, "Cd", { fromT: short.rows.at(-1).t_s - 5 * short.header.ftt_s });
  assert.match(lbmVerdict(few).reasons.join(), /blocks/);
  // a noisy series with a poorly known mean: standard error too large
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
  const noisy = parseLbmForces(synth(36, () => 0.3 + 0.6 * rnd()));
  const nv = lbmVerdict(windowStatistics(noisy, "Cd"));
  assert.match(nv.reasons.join(), /standard error/);
  // window that starts before the data
  assert.throws(() => windowStatistics(parseLbmForces(synth(10, wobble)), "Cd"), /series starts at/);
  assert.throws(() => windowStatistics(ok, "Cz"), /Cz/);
  assert.throws(() => windowStatistics(ok, "Cd", { fromT: 1, toT: 0.5 }), /empty window/);
  assert.ok(blockHistory(ok, "Cd", 2).length >= 17);
});

// ---------- validation gate ----------

const TPL = () => currentTemplate();
const rec = (mean, extra = {}) => ({ status: "settled", target: 0.285, total: { mean }, template: TPL(), ...extra });

test("lbmValidationAccepted: pending, a 6 % miss, a 3 % hit, and a template that changed after the run", () => {
  assert.equal(lbmValidationAccepted(rec(0.285 * 1.06)).accepted, false);
  assert.equal(lbmValidationAccepted(rec(0.285 * 0.94)).accepted, false);
  const ok = lbmValidationAccepted(rec(0.285 * 1.03));
  assert.equal(ok.accepted, true);
  assert.ok(Math.abs(ok.relError - 0.03) < 1e-12);
  assert.equal(lbmValidationAccepted({ status: "pending", reason: "x", target: 0.285 }).accepted, false);
  assert.equal(lbmValidationAccepted(rec(0.285, { status: "unsettled", reason: "drift" })).accepted, false);
  const stale = lbmValidationAccepted(rec(0.285), () => ({ kernelSha256: "x", sourceSha256: TPL().sourceSha256 }));
  assert.equal(stale.accepted, false);
  assert.match(stale.reason, /changed after its Ahmed 25 deg validation/);
  assert.equal(AHMED_TOLERANCE.relError, 0.05);
  assert.equal(AHMED_GANT_25.total, 0.285);
});

// ---------- run store ----------

const KEY = "0123456789abcdef01234567";
function fakeRun(text) {
  const run = tmp("run");
  fs.writeFileSync(path.join(run, "forces.dat"), text);
  return path.join(run, "forces.dat");
}

test("run store: import, read back, and refuse tampering, a wrong key, a diverged or unfinished run", () => {
  const store = tmp("store");
  const rec1 = importLbmRun(KEY, { forcesFile: fakeRun(synth(36, wobble)) }, { stepSha256: "s", case: { aref: 0.112032 } }, { dir: store });
  assert.equal(rec1.schema, "conkay-lbm-run/1");
  const r = readLbmRun(KEY, { dir: store });
  assert.equal(r.series.rows.length, 360);
  assert.equal(readLbmRun("abcdefabcdefabcdefabcdef", { dir: store }), null);
  assert.throws(() => readLbmRun("../etc", { dir: store }), /24-hex/);
  fs.appendFileSync(path.join(store, KEY, "lbm", "forces.dat"), "99999 9 0.1 0 0 0 0 0 0 0.07 1 1\n");
  assert.match(readLbmRun(KEY, { dir: store }).error, /receipt hash/);
  assert.throws(() => importLbmRun(KEY, { forcesFile: fakeRun(synth(4, wobble) + "# DIVERGED step 5\n") }, {}, { dir: store }), /diverged/);
  assert.throws(() => importLbmRun(KEY, { forcesFile: fakeRun(synth(4, wobble, { done: false })) }, {}, { dir: store }), /did not finish/);
  assert.throws(() => importLbmRun(KEY, { forcesFile: path.join(store, "nope") }, {}, { dir: store }), /missing/);
});

// ---------- the solver ----------

function ctxFor({ stepPath, key = KEY }) {
  const cad = { runId: "cad.body@BODY", status: "PASS", outputs: { kernel: { value: { requestHash: key } }, files: { value: { step: { path: stepPath } } } } };
  return {
    get: (id, p) => (id === "CAR" && p === "props.vehicle.frontalAreaFrom" ? "BODY" : id === "BODY" && p === "geometry" ? { shape: "cad-body" } : undefined),
    result: (solver, id) => (solver === "cad.body" && id === "BODY" ? cad : null),
  };
}

test("aero.lbm: live Ahmed validation stays pending until a recorded GPU fixture exists", () => {
  assert.equal(LBM_AHMED_VALIDATION.status, "pending");
  assert.match(LBM_AHMED_VALIDATION.reason, /no GPU lattice-Boltzmann run/);
  assert.equal(lbmValidationAccepted(LBM_AHMED_VALIDATION).accepted, false);
  assert.match(lbmValidationAccepted(LBM_AHMED_VALIDATION).reason, /pending/);
  // The receipt dir is not in the tree yet. Do not invent a validation from its absence.
  assert.equal(fs.existsSync(FIX), false);
});

test("aero.lbm: registered as an L4 solver with its declarations", () => {
  const s = getSolver("aero.lbm");
  assert.ok(s);
  assert.equal(s.fidelity, 4);
  assert.equal(s.screening, false);
  assert.equal(s.domain, "aero.drag");
  for (const k of ["regime", "reference", "tolerance", "units", "method", "version"]) assert.ok(s[k], k);
  const g = { nodesOfKind: () => [{ id: "A", props: { vehicle: { cfd: "aero.lbm" } } }, { id: "B", props: { vehicle: { cfd: "aero.cfd" } } }, { id: "C", props: { vehicle: {} } }] };
  assert.deepEqual(s.targets(g), ["A"]);
});

test("aero.lbm: NOT_COMPUTED with no record, a different STEP, a changed template, an unsettled run, or an unaccepted validation", () => {
  const s = getSolver("aero.lbm");
  const store = tmp("solver");
  const prev = process.env.CONKAY_CFD_DIR;
  process.env.CONKAY_CFD_DIR = store;
  try {
    const step = path.join(store, "body.step");
    fs.writeFileSync(step, "ISO-10303-21;\n");
    let r = s.run(ctxFor({ stepPath: step }), "CAR");
    assert.match(r.notComputed, /no LBM run is recorded/);
    assert.match(r.notComputed, /conkay-lbm\.mjs case --body/);

    const tpl = currentTemplate();
    const meta = (over = {}) => ({ stepSha256: sha256File(step), case: { preset: "car", res: 400, aref: 0.112032, lref: 1.044, caseSha256: "c", ...tpl }, ...over });
    const imp = (text, m) => importLbmRun(KEY, { forcesFile: fakeRun(text) }, m, { dir: store });
    imp(synth(36, wobble), meta({ stepSha256: "other" }));
    assert.match(s.run(ctxFor({ stepPath: step }), "CAR").notComputed, /made on STEP/);
    imp(synth(36, wobble), meta({ case: { ...meta().case, sourceSha256: "x" } }));
    assert.match(s.run(ctxFor({ stepPath: step }), "CAR").notComputed, /not the validated template/);
    imp(synth(36, wobble), meta({ case: { ...meta().case, aref: 2 } }));
    assert.match(s.run(ctxFor({ stepPath: step }), "CAR").notComputed, /Aref/);
    imp(synth(12, wobble), meta());
    assert.match(s.run(ctxFor({ stepPath: step }), "CAR").notComputed, /too short/);
    // an unsettled (drifting) run: NOT_COMPUTED, its statistics kept and labelled not_a_result
    imp(synth(36, (t) => 0.3 - 0.03 * Math.max(0, t - 12) / 24), meta());
    r = s.run(ctxFor({ stepPath: step }), "CAR");
    assert.match(r.notComputed, /did not settle/);
    assert.equal(r.outputs.unsettled.status, "not_a_result");
    // a settled run: the number is reported only if the template's own Ahmed validation is accepted
    imp(synth(36, wobble), meta());
    r = s.run(ctxFor({ stepPath: step }), "CAR");
    const gate = lbmValidationAccepted(LBM_AHMED_VALIDATION);
    if (gate.accepted) {
      assert.ok(Math.abs(r.outputs.dragCoefficient.value - 0.3) < 2e-3);
      assert.equal(r.outputs.dragArea.value, r.outputs.dragCoefficient.value * 0.112032);
      assert.ok(r.outputs.ahmedValidation.value.relError !== undefined);
    } else {
      assert.equal(r.notComputed, gate.reason);
      assert.equal(r.outputs.unvalidated.status, "not_a_result");
    }
    // the cad body missing
    const none = { get: (id, p) => (p === "geometry" ? { shape: "cad-body" } : "BODY"), result: () => null };
    assert.match(s.run(none, "CAR").notComputed, /not computed/);
    assert.match(s.run({ get: () => undefined, result: () => null }, "CAR").notComputed, /needs props\.vehicle\.frontalAreaFrom/);
  } finally {
    if (prev == null) delete process.env.CONKAY_CFD_DIR; else process.env.CONKAY_CFD_DIR = prev;
  }
});
