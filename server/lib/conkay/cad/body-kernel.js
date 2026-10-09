// server/lib/conkay/cad/body-kernel.js
//
// Runs the CAD body kernel (conkay_body_occ.py, OpenCascade via OCP) for the
// cad.body solver. Solvers are synchronous, so this blocks on the Python
// process; results are cached by a hash of the request (and the script) in
// memory and on disk, so a re-solve of the same parameters does not rerun
// the kernel. The output directory is chosen here, never by a request.
//
// Python: CONKAY_OCC_PYTHON, else the ConKay OCC venv
// (~/.zuko/venvs/cad-occ/bin/python, the same one occ-bridge.js uses). No
// Python with OCP means { unavailable } and the solver reports NOT_COMPUTED.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BODY_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "conkay_body_occ.py");
const DEFAULT_VENV_PYTHON = path.join(os.homedir(), ".zuko", "venvs", "cad-occ", "bin", "python");
const memo = new Map();
let scriptHash = null;

export function bodyKernelPython() {
  const p = process.env.CONKAY_OCC_PYTHON || DEFAULT_VENV_PYTHON;
  return fs.existsSync(p) ? p : null;
}

export function bodyCacheDir() {
  return process.env.CONKAY_CAD_BODY_CACHE || path.join(os.tmpdir(), "conkay-cad-body");
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  if (typeof v === "number") return Math.round(v * 1e9) / 1e9;
  return v;
}

export function requestHash(request) {
  if (!scriptHash) scriptHash = createHash("sha256").update(fs.readFileSync(BODY_SCRIPT)).digest("hex");
  return createHash("sha256").update(scriptHash).update(JSON.stringify(canonical(request))).digest("hex").slice(0, 24);
}

/**
 * Run a kernel command. request = { command, ... } (no outDir: set here for "body").
 * noCache: always run the kernel, into a fresh temporary directory (determinism checks).
 * Returns the kernel's JSON ({ ok: true, ... } or { ok: false, error }), or { ok: false, unavailable }.
 */
export function runBodyKernel(request, { timeoutMs = 1800000, noCache = false } = {}) {
  const python = bodyKernelPython();
  if (!python) return { ok: false, unavailable: `no Python with OCP: set CONKAY_OCC_PYTHON or install cadquery-ocp in ${DEFAULT_VENV_PYTHON.replace(/\/bin\/python$/, "")}` };
  const hash = requestHash(request);
  if (!noCache && memo.has(hash)) return memo.get(hash);
  const dir = noCache ? fs.mkdtempSync(path.join(os.tmpdir(), `conkay-cad-body-${hash}-`)) : path.join(bodyCacheDir(), hash);
  const cached = path.join(dir, "result.json");
  if (!noCache && fs.existsSync(cached)) {
    try { const r = JSON.parse(fs.readFileSync(cached, "utf8")); memo.set(hash, r); return r; } catch { /* re-run */ }
  }
  const full = request.command === "body" ? { ...request, outDir: dir } : request;
  let out;
  try {
    const stdout = execFileSync(python, [BODY_SCRIPT], { input: JSON.stringify(full), maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, env: { ...process.env, PYTHONUNBUFFERED: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    out = JSON.parse(stdout.toString("utf8"));
  } catch (e) {
    return { ok: false, error: `kernel run failed: ${(e.stderr?.toString() || e.message || "").split("\n").filter(Boolean).slice(-1)[0] || "unknown"}` };
  }
  out.requestHash = hash;
  if (noCache) return out;
  if (out.ok) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cached, JSON.stringify(out));
    fs.writeFileSync(path.join(dir, "request.json"), JSON.stringify(full)); // the receipt: what the kernel was given
  }
  memo.set(hash, out);
  return out;
}
