// server/lib/conkay/cfd/lbm/run-store.js
//
// Recorded aero.lbm runs, one directory per cad.body kernel request hash, beside the OpenFOAM record:
//
//   <CONKAY_CFD_DIR or ~/.cache/conkay-cfd>/<cadRequestHash>/lbm/
//     run.json     the receipt (schema conkay-lbm-run/1)
//     forces.dat   the force time series, copied verbatim from the run
//
// The GPU run takes tens of minutes on a separate machine, so aero.lbm never starts it: it reads
// the record for the exact body and re-derives every number from the copied series. A record that
// cannot be read or does not match is reported as missing, never patched.

import fs from "node:fs";
import path from "node:path";
import { cfdStoreDir, sha256File } from "../run-store.js";
import { parseLbmForces } from "./force-series.js";

export const LBM_RUN_SCHEMA = "conkay-lbm-run/1";
const KEY = /^[0-9a-f]{24}$/;

function assertKey(key) {
  if (typeof key !== "string" || !KEY.test(key)) throw new Error(`lbm run key must be a 24-hex cad.body request hash, got ${JSON.stringify(key)}`);
}

export function lbmRunDir(key, dir = cfdStoreDir()) {
  assertKey(key);
  return path.join(dir, key, "lbm");
}

/** null when no record, { error } when one exists but is unusable, else { record, series }. */
export function readLbmRun(key, { dir = cfdStoreDir() } = {}) {
  const runDir = lbmRunDir(key, dir);
  const file = path.join(runDir, "run.json");
  if (!fs.existsSync(file)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    if (record.schema !== LBM_RUN_SCHEMA) return { error: `run.json schema ${record.schema}, expected ${LBM_RUN_SCHEMA}` };
    if (record.cadRequestHash !== key) return { error: `run.json is for cad.body ${record.cadRequestHash}, not ${key}` };
    for (const [rel, want] of Object.entries(record.files || {})) {
      const p = path.join(runDir, rel);
      if (!fs.existsSync(p)) return { error: `${rel} is in the receipt but missing` };
      if (sha256File(p) !== want) return { error: `${rel} does not match its receipt hash` };
    }
    if (!record.files?.["forces.dat"]) return { error: "the receipt has no forces.dat" };
    const series = parseLbmForces(fs.readFileSync(path.join(runDir, "forces.dat"), "utf8"));
    return { record, series };
  } catch (e) {
    return { error: `cannot read the recorded run (${e.message})` };
  }
}

/**
 * Record a finished run. src = { forcesFile }; meta = the receipt fields (stepSha256, case, openlb, stlSha256,
 * host, gpu, wallSeconds ...). Copies forces.dat and writes run.json with its hash.
 */
export function importLbmRun(key, src, meta, { dir = cfdStoreDir() } = {}) {
  const runDir = lbmRunDir(key, dir);
  if (!src?.forcesFile || !fs.existsSync(src.forcesFile)) throw new Error("importLbmRun: forcesFile missing");
  const series = parseLbmForces(fs.readFileSync(src.forcesFile, "utf8"));
  if (series.diverged) throw new Error("importLbmRun: the run diverged; a diverged run is not recorded");
  if (!series.done) throw new Error("importLbmRun: forces.dat has no '# done' line (the run did not finish)");
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(src.forcesFile, path.join(runDir, "forces.dat"));
  const files = { "forces.dat": sha256File(path.join(runDir, "forces.dat")) };
  const record = { schema: LBM_RUN_SCHEMA, cadRequestHash: key, ...meta, files, importedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}
