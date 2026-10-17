// server/lib/conkay/em/meep.js
//
// The Meep FDTD kernel (em/meep_kernel.py) from JavaScript: an async wrapper
// over cad/kernel-queue.js runPythonKernel (a spawned child process — the
// event loop is never blocked). The kernel renices itself (nice 15) and runs
// single-threaded (OMP_NUM_THREADS=1).
//
// Python is CONKAY_MEEP_PYTHON, else the ConKay Meep env
// (~/.zuko/envs/meep/bin/python, MIT Meep 1.35). Missing -> { ok:false,
// unavailable } — the honest NOT_COMPUTED reason.

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPythonKernel } from "../cad/kernel-queue.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MEEP_SCRIPT = path.join(HERE, "meep_kernel.py");
const DEFAULT_MEEP_PYTHON = path.join(os.homedir(), ".zuko", "envs", "meep", "bin", "python");
export const MEEP_SCRIPT_HASH = createHash("sha256").update(fs.readFileSync(MEEP_SCRIPT)).digest("hex");
export const DEFAULT_EM_TIMEOUT_MS = 600_000;

/** The configured Meep Python (not checked). */
export function meepPythonPath() {
  return process.env.CONKAY_MEEP_PYTHON || DEFAULT_MEEP_PYTHON;
}

const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

export const MEEP_PYTHON_UNAVAILABLE = () => `no Python with Meep found at ${meepPythonPath()}: set CONKAY_MEEP_PYTHON or install Meep in ${DEFAULT_MEEP_PYTHON.replace(/\/bin\/python$/, "")}`;

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  if (typeof v === "number") return Math.round(v * 1e9) / 1e9;
  return v;
}

/** The kernel-queue cache key for an FDTD request (kernel script hash included). */
export const emKernelKey = (request) => `em:fdtd:${createHash("sha256").update(MEEP_SCRIPT_HASH).update(JSON.stringify(canonical(request))).digest("hex").slice(0, 24)}`;

/** Run one stack1d FDTD solve. Never throws; { ok:false, unavailable } when the Python is missing. */
export async function runStack1d(request = {}, { timeoutMs = DEFAULT_EM_TIMEOUT_MS, python } = {}) {
  const py = python ?? meepPythonPath();
  if (!(await exists(py))) return { ok: false, unavailable: MEEP_PYTHON_UNAVAILABLE() };
  return runPythonKernel({
    python: py,
    script: MEEP_SCRIPT,
    input: { op: "stack1d", ...request },
    timeoutMs,
    env: { ...process.env, OMP_NUM_THREADS: "1" },
  });
}

/** The honest NOT_COMPUTED reason for a failed kernel result (null when it succeeded). */
export function emNotComputedReason(r) {
  if (r?.ok) return null;
  return r?.unavailable || r?.error || "meep kernel run failed";
}
