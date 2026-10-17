// server/lib/conkay/em/fenicsx.js
//
// The FEniCSx magnetostatic kernel (em/fenicsx_magnetostatic_kernel.py) from
// JavaScript: an async wrapper over cad/kernel-queue.js runPythonKernel (a
// spawned child process — the event loop is never blocked). The kernel
// renices itself (nice 15) and runs single-threaded (OMP_NUM_THREADS=1).
//
// Python is CONKAY_FENICSX_PYTHON, else the ConKay FEniCSx env
// (~/.zuko/envs/fenicsx/bin/python: dolfinx 0.11 + gmsh 4.15, conda-forge).
// Missing -> { ok:false, unavailable } — the honest NOT_COMPUTED reason.

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPythonKernel } from "../cad/kernel-queue.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MAGNETOSTATIC_SCRIPT = path.join(HERE, "fenicsx_magnetostatic_kernel.py");
const DEFAULT_FENICSX_PYTHON = path.join(os.homedir(), ".zuko", "envs", "fenicsx", "bin", "python");
export const MAGNETOSTATIC_SCRIPT_HASH = createHash("sha256").update(fs.readFileSync(MAGNETOSTATIC_SCRIPT)).digest("hex");
export const DEFAULT_MAG_TIMEOUT_MS = 600_000;

/** The configured FEniCSx Python (not checked). */
export function fenicsxPythonPath() {
  return process.env.CONKAY_FENICSX_PYTHON || DEFAULT_FENICSX_PYTHON;
}

const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

export const FENICSX_PYTHON_UNAVAILABLE = () => `no Python with FEniCSx found at ${fenicsxPythonPath()}: set CONKAY_FENICSX_PYTHON or install fenics-dolfinx + gmsh in ${DEFAULT_FENICSX_PYTHON.replace(/\/bin\/python$/, "")}`;

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  if (typeof v === "number") return Math.round(v * 1e12) / 1e12;
  return v;
}

/** The kernel-queue cache key for a magnetostatic request (kernel script hash included). */
export const magKernelKey = (request) => `em:magnetostatic:${createHash("sha256").update(MAGNETOSTATIC_SCRIPT_HASH).update(JSON.stringify(canonical(request))).digest("hex").slice(0, 24)}`;

/** Run one planar 2-D A_z solve. Never throws; { ok:false, unavailable } when the Python is missing. */
export async function runPlanar2d(request = {}, { timeoutMs = DEFAULT_MAG_TIMEOUT_MS, python } = {}) {
  const py = python ?? fenicsxPythonPath();
  if (!(await exists(py))) return { ok: false, unavailable: FENICSX_PYTHON_UNAVAILABLE() };
  return runPythonKernel({
    python: py,
    script: MAGNETOSTATIC_SCRIPT,
    input: { op: "planar2d", ...request },
    timeoutMs,
    // FI_PROVIDER=tcp: MPICH's default libfabric provider hangs in MPI_Finalize on macOS.
    env: { ...process.env, OMP_NUM_THREADS: "1", FI_PROVIDER: process.env.FI_PROVIDER || "tcp" },
  });
}

/** The honest NOT_COMPUTED reason for a failed kernel result (null when it succeeded). */
export function magNotComputedReason(r) {
  if (r?.ok) return null;
  return r?.unavailable || r?.error || "fenicsx magnetostatic kernel run failed";
}
