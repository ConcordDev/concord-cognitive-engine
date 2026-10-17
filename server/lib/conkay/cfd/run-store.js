// server/lib/conkay/cfd/run-store.js
//
// Recorded OpenFOAM runs, one directory per cad.body kernel request hash:
//
//   <CONKAY_CFD_DIR or ~/.cache/conkay-cfd>/<cadRequestHash>/
//     run.json                      the receipt (schema conkay-cfd-run/1)
//     forceCoeffs/<fn>/<t>.dat      the forceCoeffs segments, copied verbatim from the run
//     snappy-summary.txt            snappyHexMesh's layer table and cell count
//
// A CFD run takes hours on a separate machine, so the aero.cfd solver never runs OpenFOAM:
// it reads a recorded run for the exact body (same kernel request hash and STEP file hash)
// and re-derives every number from the copied force files. A record that cannot be read
// or does not match is reported as missing, never patched.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { parseForceCoeffs, mergeForceCoeffs, parseSnappySummary } from "./force-coeffs.js";

export const RUN_SCHEMA = "conkay-cfd-run/1";
const KEY = /^[0-9a-f]{24}$/;

export function cfdStoreDir() {
  return process.env.CONKAY_CFD_DIR || path.join(os.homedir(), ".cache", "conkay-cfd");
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function assertKey(key) {
  if (typeof key !== "string" || !KEY.test(key)) throw new Error(`cfd run key must be a 24-hex cad.body request hash, got ${JSON.stringify(key)}`);
}

/** List forceCoeffs segment files under dir/forceCoeffs/<fn>/<startTime>.dat as { fn: [paths] }. */
function segmentFiles(dir) {
  const root = path.join(dir, "forceCoeffs");
  const out = {};
  for (const fn of fs.readdirSync(root)) {
    const sub = path.join(root, fn);
    if (!fs.statSync(sub).isDirectory()) continue;
    out[fn] = fs.readdirSync(sub).filter((f) => /^[\d.]+\.dat$/.test(f)).map((f) => path.join(sub, f));
  }
  return out;
}

/**
 * Read a recorded run. Returns null when there is no record, { error } when one exists but is
 * unusable (bad schema, a copied file whose hash differs from the receipt, unparsable data),
 * else { record, forces: { fn: merged }, snappy }.
 */
export function readRun(key, { dir = cfdStoreDir() } = {}) {
  assertKey(key);
  const runDir = path.join(dir, key);
  const file = path.join(runDir, "run.json");
  if (!fs.existsSync(file)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    if (record.schema !== RUN_SCHEMA) return { error: `run.json schema ${record.schema}, expected ${RUN_SCHEMA}` };
    if (record.cadRequestHash !== key) return { error: `run.json is for cad.body ${record.cadRequestHash}, not ${key}` };
    for (const [rel, want] of Object.entries(record.files || {})) {
      const p = path.join(runDir, rel);
      if (!fs.existsSync(p)) return { error: `${rel} is in the receipt but missing` };
      if (sha256File(p) !== want) return { error: `${rel} does not match its receipt hash` };
    }
    const segs = segmentFiles(runDir);
    const forces = {};
    for (const [fn, paths] of Object.entries(segs)) {
      for (const p of paths) {
        if (!record.files?.[path.relative(runDir, p)]) return { error: `${path.relative(runDir, p)} is not in the receipt` };
      }
      forces[fn] = mergeForceCoeffs(paths.map((p) => parseForceCoeffs(fs.readFileSync(p, "utf8"))));
    }
    if (!forces.fc_total) return { error: "no fc_total force coefficients in the run" };
    const snappyFile = path.join(runDir, "snappy-summary.txt");
    const snappy = fs.existsSync(snappyFile) ? parseSnappySummary(fs.readFileSync(snappyFile, "utf8")) : null;
    return { record, forces, snappy };
  } catch (e) {
    return { error: `cannot read the recorded run (${e.message})` };
  }
}

/**
 * Record a finished run. src = { postProcessingDir, snappySummaryFile? }; meta = the receipt fields
 * (case, surface, solver, host, stepSha256, frontalArea ...). Copies every
 * <postProcessingDir>/<fn>/<startTime>/forceCoeffs.dat and writes run.json with their hashes.
 */
export function importRun(key, src, meta, { dir = cfdStoreDir() } = {}) {
  assertKey(key);
  if (!src?.postProcessingDir || !fs.existsSync(src.postProcessingDir)) throw new Error("importRun: postProcessingDir missing");
  const runDir = path.join(dir, key);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const files = {};
  for (const fn of fs.readdirSync(src.postProcessingDir)) {
    const fnDir = path.join(src.postProcessingDir, fn);
    if (!fs.statSync(fnDir).isDirectory()) continue;
    for (const t of fs.readdirSync(fnDir)) {
      const f = path.join(fnDir, t, "forceCoeffs.dat");
      if (!fs.existsSync(f)) continue;
      const rel = path.join("forceCoeffs", fn, `${t}.dat`);
      fs.mkdirSync(path.dirname(path.join(runDir, rel)), { recursive: true });
      fs.copyFileSync(f, path.join(runDir, rel));
      files[rel] = sha256File(path.join(runDir, rel));
    }
  }
  if (!Object.keys(files).some((r) => r.startsWith(path.join("forceCoeffs", "fc_total")))) throw new Error("importRun: no fc_total/<t>/forceCoeffs.dat under postProcessingDir");
  if (src.snappySummaryFile) {
    fs.copyFileSync(src.snappySummaryFile, path.join(runDir, "snappy-summary.txt"));
    files["snappy-summary.txt"] = sha256File(path.join(runDir, "snappy-summary.txt"));
  }
  const record = { schema: RUN_SCHEMA, cadRequestHash: key, ...meta, files, importedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}
