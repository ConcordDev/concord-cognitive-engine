// server/lib/conkay/fea/calculix.js
//
// The CalculiX 3-D stress kernel (fea/calculix_kernel.py) from JavaScript: an
// async wrapper over cad/kernel-queue.js runPythonKernel (a spawned child
// process — the event loop is never blocked). The kernel imports a STEP solid,
// meshes it with gmsh (10-node tets), writes a CalculiX deck, runs ccx with a
// timeout and reads displacement + stress back from the .frd.
//
// Python is resolved the way the Cantera / CAD kernels resolve theirs:
// CONKAY_FEA_PYTHON, else CONKAY_OCC_PYTHON, else the ConKay sidecar venv
// (~/.zuko/venvs/cad-occ/bin/python, where gmsh 4.15 is installed).
// ccx is CONKAY_CCX, else ~/.zuko/envs/calculix/bin/ccx. Either missing ->
// { ok:false, unavailable } — the honest NOT_COMPUTED reason.

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPythonKernel } from "../cad/kernel-queue.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CALCULIX_SCRIPT = path.join(HERE, "calculix_kernel.py");
const DEFAULT_VENV_PYTHON = path.join(os.homedir(), ".zuko", "venvs", "cad-occ", "bin", "python");
const DEFAULT_CCX = path.join(os.homedir(), ".zuko", "envs", "calculix", "bin", "ccx");
// read once when the module loads: a changed kernel script is a different run (the cache key includes it)
export const CALCULIX_SCRIPT_HASH = createHash("sha256").update(fs.readFileSync(CALCULIX_SCRIPT)).digest("hex");
export const DEFAULT_FEA_TIMEOUT_MS = 600_000;

/** The configured kernel Python (not checked). */
export function feaPythonPath() {
  return process.env.CONKAY_FEA_PYTHON || process.env.CONKAY_OCC_PYTHON || DEFAULT_VENV_PYTHON;
}

/** The configured CalculiX executable (not checked). */
export function ccxPath() {
  return process.env.CONKAY_CCX || DEFAULT_CCX;
}

const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

export const FEA_PYTHON_UNAVAILABLE = `no Python with gmsh found: set CONKAY_FEA_PYTHON (or CONKAY_OCC_PYTHON) or install gmsh in ${DEFAULT_VENV_PYTHON.replace(/\/bin\/python$/, "")}`;
export const CCX_UNAVAILABLE = `CalculiX ccx not found: set CONKAY_CCX (default ${DEFAULT_CCX})`;

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  if (typeof v === "number") return Math.round(v * 1e9) / 1e9;
  return v;
}

/** Hash of a request (the kernel script and, for a STEP path, the file's mtime+size included). */
export function feaRequestHash(request) {
  const h = createHash("sha256").update(CALCULIX_SCRIPT_HASH).update(JSON.stringify(canonical(request)));
  if (request?.step) {
    try { const s = fs.statSync(request.step); h.update(`${s.size}:${s.mtimeMs}`); } catch { h.update("missing"); }
  }
  return h.digest("hex").slice(0, 24);
}

/** The kernel-queue cache key for a solid FEA request. */
export const feaKernelKey = (request) => `fea:solid3d:${feaRequestHash(request)}`;

/**
 * Run one static solve. Returns the kernel's JSON ({ ok:true, ... } or { ok:false, error }),
 * or { ok:false, unavailable } when the Python or ccx does not exist. Never throws.
 * The ccx timeout is enforced inside the kernel (timeoutS); the Node timeout is a backstop a little above it.
 */
export async function runSolidStatic(request = {}, { timeoutMs = DEFAULT_FEA_TIMEOUT_MS, python, ccx } = {}) {
  const py = python ?? feaPythonPath();
  if (!(await exists(py))) return { ok: false, unavailable: FEA_PYTHON_UNAVAILABLE };
  const solver = ccx ?? ccxPath();
  if (!(await exists(solver))) return { ok: false, unavailable: CCX_UNAVAILABLE };
  return runPythonKernel({
    python: py,
    script: CALCULIX_SCRIPT,
    input: { op: "static", ...request, ccx: solver, timeoutS: timeoutMs / 1000 },
    timeoutMs: timeoutMs + 15_000,
  });
}

/** The honest NOT_COMPUTED reason for a failed kernel result (null when it succeeded). */
export function feaNotComputedReason(r) {
  if (r?.ok) return null;
  return r?.unavailable || r?.error || "calculix kernel run failed";
}
