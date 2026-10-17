// server/lib/conkay/chem/cantera.js
//
// The Cantera chemistry kernel (chem/cantera_kernel.py) from JavaScript: async
// wrappers over cad/kernel-queue.js runPythonKernel (a spawned child process —
// the event loop is never blocked). One op per call, per-op timeouts.
//
// Python is resolved the way the CAD kernels resolve theirs (cad/body-kernel.js,
// occ-bridge.js): CONKAY_CANTERA_PYTHON, else CONKAY_OCC_PYTHON, else the
// ConKay sidecar venv (~/.zuko/venvs/cad-occ/bin/python) where Cantera 3.2.0 is
// installed alongside OCP. No Python found -> { ok:false, unavailable } — the
// honest reason the solvers report as NOT_COMPUTED; a Python without cantera
// reports the cantera import failure the same way.

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPythonKernel } from "../cad/kernel-queue.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CANTERA_SCRIPT = path.join(HERE, "cantera_kernel.py");
const DEFAULT_VENV_PYTHON = path.join(os.homedir(), ".zuko", "venvs", "cad-occ", "bin", "python");
// read once when the module loads: a changed kernel script is a different run (the cache key includes it)
export const CANTERA_SCRIPT_HASH = createHash("sha256").update(fs.readFileSync(CANTERA_SCRIPT)).digest("hex");

/** JS op name -> kernel op string and its default timeout (ms). */
export const CHEM_OPS = {
  equilibrium: { kernelOp: "equilibrium", timeoutMs: 30_000 },
  ignition: { kernelOp: "ignition", timeoutMs: 60_000 },
  flameSpeed: { kernelOp: "flame_speed", timeoutMs: 120_000 },
};

/** The configured kernel Python (not checked: see resolveCanteraPython). */
export function canteraPythonPath() {
  return process.env.CONKAY_CANTERA_PYTHON || process.env.CONKAY_OCC_PYTHON || DEFAULT_VENV_PYTHON;
}

/** The kernel Python if it exists, else null (async). */
export async function resolveCanteraPython() {
  const p = canteraPythonPath();
  try { await fsp.access(p); return p; } catch { return null; }
}

export const CANTERA_UNAVAILABLE = `no Python with Cantera found: set CONKAY_CANTERA_PYTHON (or CONKAY_OCC_PYTHON) or install cantera in ${DEFAULT_VENV_PYTHON.replace(/\/bin\/python$/, "")}`;

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  if (typeof v === "number") return Math.round(v * 1e9) / 1e9;
  return v;
}

/** Hash of a (op, request) pair, the kernel script included: a changed script or request is a new run. */
export function chemRequestHash(op, request) {
  return createHash("sha256").update(CANTERA_SCRIPT_HASH).update(`${op}:${JSON.stringify(canonical(request))}`).digest("hex").slice(0, 24);
}

/** The kernel-queue cache key for a chemistry request. */
export const chemKernelKey = (op, request) => `chem:${op}:${chemRequestHash(op, request)}`;

/**
 * Run one chemistry op. Returns the kernel's JSON ({ ok: true, ... } or { ok: false, error }),
 * or { ok: false, unavailable } when the configured Python does not exist. Never throws.
 */
export async function runChemistryKernel(op, request = {}, { timeoutMs, python } = {}) {
  const spec = CHEM_OPS[op];
  if (!spec) return { ok: false, error: `unknown chemistry op ${op}: expected one of ${Object.keys(CHEM_OPS).join(", ")}` };
  const py = python ?? await resolveCanteraPython();
  if (!py) return { ok: false, unavailable: CANTERA_UNAVAILABLE };
  return runPythonKernel({ python: py, script: CANTERA_SCRIPT, input: { op: spec.kernelOp, ...request }, timeoutMs: timeoutMs ?? spec.timeoutMs });
}

export async function runEquilibrium(request, opts) {
  return runChemistryKernel("equilibrium", request, opts);
}

export async function runIgnition(request, opts) {
  return runChemistryKernel("ignition", request, opts);
}

export async function runFlameSpeed(request, opts) {
  return runChemistryKernel("flameSpeed", request, opts);
}

/** The honest NOT_COMPUTED reason for a failed kernel result (null when it succeeded). */
export function chemNotComputedReason(r) {
  if (r?.ok) return null;
  return r?.unavailable || r?.error || "cantera kernel run failed";
}