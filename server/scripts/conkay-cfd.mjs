#!/usr/bin/env node
// server/scripts/conkay-cfd.mjs — write an OpenFOAM case for a ConKay CAD body, or record a finished run.
//
//   node scripts/conkay-cfd.mjs case --body <cadRequestHash> --out <dir> [--nproc 7] [--end 4000]
//                                    [--aref <m2> --aref-basis "<text>"]
//                                    [--turbulence rans|ddes] [--ft-discard 5] [--ft-average 10] [--cfl 1]
//   node scripts/conkay-cfd.mjs case --ahmed --out <dir> [--nproc 7] [--end 4000]
//   node scripts/conkay-cfd.mjs import --body <cadRequestHash> --run <finished case dir>
//
// `case --body` reads the cached cad.body result (~/.cache/conkay-cad-body/<hash>), writes the
// dictionaries (cfd/openfoam_case.py, preset car5m), copies body.step, and writes tessellate.sh and
// case.json. On the CFD machine: ./tessellate.sh (gmsh), then ./Allrun. Size --nproc to the
// machine's real CPU quota (/sys/fs/cgroup/cpu.max), not nproc.
// `--turbulence ddes` (default rans) adds the transient SST-DDES overlay (des/ dictionaries and
// AllrunDES; --end is then the RANS stage and must be a multiple of 500). On the CFD machine:
// ./Allrun (steady RANS) then ./AllrunDES. The DES template has never been run.
// `import` copies the run's forceCoeffs files and snappy summary into the CFD run store
// (cfd/run-store.js) with case.json and surface.json as the receipt. See docs/CONKAY-AERO-CFD.md.

import fs from "node:fs";
import path from "node:path";
import { bodyCacheDir } from "../lib/conkay/cad/body-kernel.js";
import { writeCase, fitsPreset } from "../lib/conkay/cfd/openfoam-case.js";
import { importRun, sha256File, cfdStoreDir } from "../lib/conkay/cfd/run-store.js";

const TESSELLATION = Object.freeze({ tool: "gmsh", clmax: 0.015, clmin: 0.003, curvaturePoints: 24 });

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

function intArg(v, name, dflt) {
  if (v == null) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

/** Turbulence options from the CLI, as writeCase fields; the kernel validates them. */
function turbulenceArgs(a) {
  const out = {};
  if (a.turbulence != null) out.turbulence = String(a.turbulence);
  for (const [flag, field] of [["ft-discard", "flowThroughsDiscard"], ["ft-average", "flowThroughsAverage"], ["cfl", "cflTarget"]]) {
    if (a[flag] != null) {
      const n = Number(a[flag]);
      if (!(n > 0) || !Number.isFinite(n)) throw new Error(`--${flag} must be a positive number`);
      out[field] = n;
    }
  }
  return out;
}

function tessellateScript(name) {
  // the STL's single solid is renamed so snappyHexMesh names the patch <name>_body
  return `#!/bin/bash
# Re-tessellate the CAD body's STEP for snappyHexMesh, then record the surface it made.
set -e
cd "\${0%/*}"
gmsh constant/geometry/body.step -2 -format stl -clmax ${TESSELLATION.clmax} -clmin ${TESSELLATION.clmin} \\
  -setnumber Mesh.MeshSizeFromCurvature ${TESSELLATION.curvaturePoints} -o constant/geometry/${name}.stl > log.gmsh 2>&1
sed -i "1s/.*/solid body/; \\$s/.*/endsolid body/" constant/geometry/${name}.stl
python3 - <<'EOF'
import hashlib, json, re, subprocess
stl = "constant/geometry/${name}.stl"
tris = sum(1 for l in open(stl) if l.lstrip().startswith("facet"))
ver = subprocess.run(["gmsh", "--version"], capture_output=True, text=True)
json.dump({"tool": "gmsh", "gmshVersion": (ver.stdout or ver.stderr).strip(), "clmax": ${TESSELLATION.clmax}, "clmin": ${TESSELLATION.clmin},
           "curvaturePoints": ${TESSELLATION.curvaturePoints}, "triangles": tris,
           "stlSha256": hashlib.sha256(open(stl, "rb").read()).hexdigest()}, open("surface.json", "w"), indent=2)
EOF
`;
}

async function cmdCase(a) {
  if (!a.out) throw new Error("--out <dir> required");
  if (fs.existsSync(a.out) && fs.readdirSync(a.out).length) throw new Error(`${a.out} is not empty`);
  const nproc = intArg(a.nproc, "nproc", 7);
  const endTime = intArg(a.end, "end", 4000);
  const turb = turbulenceArgs(a);
  if (a.ahmed) {
    const r = await writeCase({ preset: "ahmed", outDir: a.out, nproc, endTime, ...turb });
    if (!r.ok) throw new Error(r.error);
    const geo = new URL("../lib/conkay/cfd/ahmed.geo", import.meta.url);
    fs.copyFileSync(geo, path.join(a.out, "ahmed.geo"));
    fs.writeFileSync(path.join(a.out, "case.json"), JSON.stringify({ preset: "ahmed", nproc, endTime, turbulence: r.turbulence ?? "rans", des: r.des ?? null, caseSha256: r.caseSha256, kernelSha256: r.kernelSha256, files: r.files, geometry: "ahmed.geo: gmsh ahmed.geo -2 -format stl -o constant/geometry/ahmed.stl" }, null, 2));
    return r;
  }
  const key = a.body;
  if (!/^[0-9a-f]{24}$/.test(String(key))) throw new Error("--body <24-hex cad.body request hash> required (or --ahmed)");
  const dir = path.join(bodyCacheDir(), key);
  const result = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8"));
  const step = path.join(dir, "body.step");
  if (!fs.existsSync(step)) throw new Error(`no body.step in ${dir}`);
  const m = result.metrics;
  const bbox = m?.bbox;
  if (!bbox) throw new Error("cad.body result has no bbox");
  let aref = m.frontalAreaM2, arefBasis = `cad.body frontal area (kernel projection, ${m.frontalSlices} slices)`;
  if (a.aref != null) {
    aref = Number(a.aref);
    if (!(aref > 0) || !a["aref-basis"]) throw new Error("--aref needs a positive number and --aref-basis \"<where it came from>\"");
    arefBasis = String(a["aref-basis"]);
  }
  const lref = m.lengthM;
  const r = await writeCase({ preset: "car5m", outDir: a.out, nproc, endTime, aref, lref, ...turb });
  if (!r.ok) throw new Error(r.error);
  if (!fitsPreset(bbox, r.fits)) throw new Error(`the body box ${JSON.stringify(bbox)} is outside the car5m preset's refinement box ${JSON.stringify(r.fits)}`);
  fs.mkdirSync(path.join(a.out, "constant/geometry"), { recursive: true });
  fs.copyFileSync(step, path.join(a.out, "constant/geometry/body.step"));
  fs.writeFileSync(path.join(a.out, "tessellate.sh"), tessellateScript("car"), { mode: 0o755 });
  const caseJson = {
    preset: "car5m", cadRequestHash: key, stepSha256: sha256File(step), nproc, endTime, aref, lref,
    frontalAreaBasis: arefBasis, turbulence: r.turbulence ?? "rans", des: r.des ?? null, caseSha256: r.caseSha256, kernelSha256: r.kernelSha256, files: r.files, tessellation: TESSELLATION,
  };
  fs.writeFileSync(path.join(a.out, "case.json"), JSON.stringify(caseJson, null, 2));
  return caseJson;
}

function cmdImport(a) {
  const key = a.body;
  if (!/^[0-9a-f]{24}$/.test(String(key))) throw new Error("--body <24-hex cad.body request hash> required");
  if (!a.run) throw new Error("--run <finished case dir> required");
  const cj = JSON.parse(fs.readFileSync(path.join(a.run, "case.json"), "utf8"));
  if (cj.cadRequestHash !== key) throw new Error(`case.json is for ${cj.cadRequestHash}, not ${key}`);
  const surface = JSON.parse(fs.readFileSync(path.join(a.run, "surface.json"), "utf8"));
  const snappyLog = path.join(a.run, "log.snappyHexMesh");
  let summary = null;
  if (fs.existsSync(snappyLog)) {
    // the layer table and final cell count, as in tests/fixtures/conkay-cfd/*/snappy-summary.txt
    const log = fs.readFileSync(snappyLog, "utf8").split("\n");
    // the last "patch faces layers overall thickness" table, up to its closing blank line
    const head = log.findLastIndex((l) => /^patch\s+faces\s+layers/.test(l));
    let end = head;
    while (head >= 0 && end < log.length && log[end].trim() !== "") end++;
    const table = head >= 0 ? log.slice(head, end) : [];
    const tail = log.filter((l) => /Layer mesh : cells:|Finished meshing in/.test(l));
    const foam = path.join(a.run, "log.foamRun");
    const build = fs.existsSync(foam) ? fs.readFileSync(foam, "utf8").split("\n").find((l) => /^Build\s*:/.test(l)) : null;
    summary = path.join(a.run, "snappy-summary.txt");
    fs.writeFileSync(summary, [...table, ...tail, ...(build ? [build] : [])].join("\n") + "\n");
  }
  const rec = importRun(key, { postProcessingDir: path.join(a.run, "postProcessing"), snappySummaryFile: summary }, {
    stepSha256: cj.stepSha256,
    case: { preset: cj.preset, turbulence: cj.turbulence ?? "rans", des: cj.des ?? null, nproc: cj.nproc, endTime: cj.endTime, aref: cj.aref, lref: cj.lref, caseSha256: cj.caseSha256, kernelSha256: cj.kernelSha256 },
    frontalAreaBasis: cj.frontalAreaBasis,
    surface,
    host: a.host || null,
  });
  return { stored: path.join(cfdStoreDir(), key), files: Object.keys(rec.files).length };
}

const a = args(process.argv.slice(2));
const cmd = a._[0];
try {
  const out = cmd === "case" ? await cmdCase(a) : cmd === "import" ? cmdImport(a) : null;
  if (!out) throw new Error("usage: conkay-cfd.mjs case|import ... (see the header)");
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(`conkay-cfd: ${e.message}`);
  process.exitCode = 1;
}
