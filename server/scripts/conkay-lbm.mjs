#!/usr/bin/env node
// server/scripts/conkay-lbm.mjs — write a GPU lattice-Boltzmann (OpenLB) case for a ConKay CAD body, or record a finished run.
//
//   node scripts/conkay-lbm.mjs case --ahmed --out <dir> [--res 185] [--tend 0.94] [--sample 500]
//   node scripts/conkay-lbm.mjs case --body <cadRequestHash> --out <dir> [--res N] [--tend S] [--sample 500]
//                                    [--aref <m2> --aref-basis "<text>"] [--max-mnodes 36]
//   node scripts/conkay-lbm.mjs import --body <cadRequestHash> --run <finished case dir> [--host "<machine>"]
//
// `case` writes the OpenLB case (cfd/lbm/lbm_case.py) and, for a body, copies its STEP file. On the GPU
// machine: ./stl.sh (gmsh), build OpenLB 1.9r0 with config.mk and `make` in the case dir, then ./run.sh.
// `import` copies the run's forces.dat into the LBM run store (cfd/lbm/run-store.js) with case.json and
// surface.json as the receipt. See docs/CONKAY-AERO-LBM.md.

import fs from "node:fs";
import path from "node:path";
import { bodyCacheDir } from "../lib/conkay/cad/body-kernel.js";
import { writeLbmCase } from "../lib/conkay/cfd/lbm/lbm-case.js";
import { importLbmRun, lbmRunDir } from "../lib/conkay/cfd/lbm/run-store.js";
import { sha256File } from "../lib/conkay/cfd/run-store.js";

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function num(v, name, dflt) {
  if (v == null) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
}

async function cmdCase(a) {
  if (!a.out) throw new Error("--out <dir> required");
  if (fs.existsSync(a.out) && fs.readdirSync(a.out).length) throw new Error(`${a.out} is not empty`);
  const res = Math.round(num(a.res, "res", 185));
  const tend = num(a.tend, "tend", 0.94);
  const sample = Math.round(num(a.sample, "sample", 500));
  const maxMnodes = a["max-mnodes"] == null ? undefined : num(a["max-mnodes"], "max-mnodes");
  if (a.ahmed) {
    const r = await writeLbmCase({ preset: "ahmed", outDir: a.out, res, tend, sample, maxMnodes });
    if (!r.ok) throw new Error(r.error);
    return r;
  }
  const key = a.body;
  if (!/^[0-9a-f]{24}$/.test(String(key))) throw new Error("--body <24-hex cad.body request hash> required (or --ahmed)");
  const dir = path.join(bodyCacheDir(), key);
  const result = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8"));
  const step = path.join(dir, "body.step");
  if (!fs.existsSync(step)) throw new Error(`no body.step in ${dir}`);
  const m = result.metrics;
  if (!m?.bbox) throw new Error("cad.body result has no bbox");
  let aref = m.frontalAreaM2, arefBasis = `cad.body frontal area (kernel projection, ${m.frontalSlices} slices)`;
  if (a.aref != null) {
    aref = Number(a.aref);
    if (!(aref > 0) || !a["aref-basis"]) throw new Error("--aref needs a positive number and --aref-basis \"<where it came from>\"");
    arefBasis = String(a["aref-basis"]);
  }
  const r = await writeLbmCase({ preset: "car", outDir: a.out, res, tend, sample, maxMnodes, aref, lref: m.lengthM, bbox: m.bbox, stl: "body.stl" });
  if (!r.ok) throw new Error(r.error);
  fs.copyFileSync(step, path.join(a.out, "body.step"));
  const extra = { cadRequestHash: key, stepSha256: sha256File(step), frontalAreaBasis: arefBasis, caseSha256: r.caseSha256, kernelSha256: r.kernelSha256, files: r.files };
  const cj = path.join(a.out, "case.json");
  fs.writeFileSync(path.join(a.out, "receipt.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(cj, "utf8")), ...extra }, null, 2));
  return { ...extra, args: r.args };
}

function cmdImport(a) {
  const key = a.body;
  if (!/^[0-9a-f]{24}$/.test(String(key))) throw new Error("--body <24-hex cad.body request hash> required");
  if (!a.run) throw new Error("--run <finished case dir> required");
  const rj = JSON.parse(fs.readFileSync(path.join(a.run, "receipt.json"), "utf8"));
  if (rj.cadRequestHash !== key) throw new Error(`receipt.json is for ${rj.cadRequestHash}, not ${key}`);
  const surface = JSON.parse(fs.readFileSync(path.join(a.run, "surface.json"), "utf8"));
  const rec = importLbmRun(key, { forcesFile: path.join(a.run, "forces.dat") }, {
    stepSha256: rj.stepSha256,
    case: { preset: rj.preset, res: rj.res, tend: rj.tend, sample: rj.sample, aref: rj.aref, lref: rj.lref, caseSha256: rj.caseSha256, kernelSha256: rj.kernelSha256, sourceSha256: rj.files["aero_lbm.cpp"] },
    frontalAreaBasis: rj.frontalAreaBasis,
    openlb: rj.openlb,
    surface,
    host: a.host || null,
    gpu: a.gpu || null,
  });
  return { stored: lbmRunDir(key), files: Object.keys(rec.files).length };
}

const a = args(process.argv.slice(2));
const cmd = a._[0];
try {
  const out = cmd === "case" ? await cmdCase(a) : cmd === "import" ? cmdImport(a) : null;
  if (!out) throw new Error("usage: conkay-lbm.mjs case|import ... (see the header)");
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(`conkay-lbm: ${e.message}`);
  process.exitCode = 1;
}
