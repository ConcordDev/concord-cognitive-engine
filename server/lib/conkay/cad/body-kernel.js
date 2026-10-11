// server/lib/conkay/cad/body-kernel.js
//
// The CAD body kernel (conkay_body_occ.py, OpenCascade via OCP) for the
// cad.body solver. The kernel runs for tens of seconds, so it never runs on
// the solver path (kernel-queue.js): runBodyKernel() (sync, used by the
// solver) returns a result already computed in this process, a disk-cached
// one, or queues the run and reports it pending; runBodyKernelAsync() runs it
// in a child process with async file I/O. Results are cached by a hash of the
// request and the kernel scripts, in memory and on disk, so a re-solve of the
// same parameters does not rerun the kernel. The output directory is chosen
// here, never by a request.
//
// Python: CONKAY_OCC_PYTHON, else the ConKay OCC venv
// (~/.zuko/venvs/cad-occ/bin/python, the same one occ-bridge.js uses). No
// Python with OCP means { unavailable } and the solver reports NOT_COMPUTED.

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestKernel, rememberKernel, runPythonKernel } from "./kernel-queue.js";
import { readStlFile } from "../aero/stl-sections.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BODY_SCRIPT = path.join(HERE, "conkay_body_occ.py");
export const EXTENTS_SCRIPT = path.join(HERE, "extents_occ.py");
const DEFAULT_VENV_PYTHON = path.join(os.homedir(), ".zuko", "venvs", "cad-occ", "bin", "python");
// read once when the module loads (the kernel imports extents_occ.py: a change to either script is a different kernel)
export const BODY_SCRIPT_HASH = createHash("sha256").update(fs.readFileSync(BODY_SCRIPT)).update(fs.readFileSync(EXTENTS_SCRIPT)).digest("hex");

/** The configured kernel Python (not checked: see resolveKernelPython). */
export function kernelPythonPath() {
  return process.env.CONKAY_OCC_PYTHON || DEFAULT_VENV_PYTHON;
}

/** The kernel Python if it exists, else null (async). */
export async function resolveKernelPython() {
  const p = kernelPythonPath();
  try { await fsp.access(p); return p; } catch { return null; }
}

export const UNAVAILABLE = `no Python with OCP: set CONKAY_OCC_PYTHON or install cadquery-ocp in ${DEFAULT_VENV_PYTHON.replace(/\/bin\/python$/, "")}`;

// Cached kernel results are trusted when read back, so the cache must not be a
// shared, predictable directory another local user could pre-create or write
// into (a world-writable tmpdir path was exactly that). Default: the user's
// own cache directory; created 0700, files 0600, and refused unless it is a
// real directory owned by this process's user.
export function bodyCacheDir() {
  if (process.env.CONKAY_CAD_BODY_CACHE) return process.env.CONKAY_CAD_BODY_CACHE;
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "conkay-cad-body");
}

/** mkdir -p with mode 0700, then confirm `dir` is a directory (not a link) owned by this user. Returns true or false. */
export async function ensurePrivateDir(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const st = await fsp.lstat(dir);
    if (!st.isDirectory()) return false;
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) return false;
    return true;
  } catch {
    return false;
  }
}

/** Write a cache file readable only by this user. */
export async function writePrivateFile(file, text) {
  await fsp.writeFile(file, text, { mode: 0o600 });
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  if (typeof v === "number") return Math.round(v * 1e9) / 1e9;
  return v;
}

export function requestHash(request) {
  return createHash("sha256").update(BODY_SCRIPT_HASH).update(JSON.stringify(canonical(request))).digest("hex").slice(0, 24);
}

const keyOf = (hash) => `body:${hash}:${kernelPythonPath()}`;

/** Park the body's STL triangles before the sync aero solver can see the kernel result. */
async function preloadBodyStl(result) {
  const stl = result?.files?.stl;
  if (!stl?.path) return;
  try { await readStlFile(stl.path, { sha256: stl.sha256 }); } catch { /* cachedStlTriangles rethrows; aero reports notComputed */ }
}

/**
 * Run a kernel command asynchronously. request = { command, ... } (no outDir: set here for "body").
 * noCache: always run the kernel, into a fresh temporary directory (determinism checks).
 * Returns the kernel's JSON ({ ok: true, ... } or { ok: false, error }), or { ok: false, unavailable }.
 */
export async function runBodyKernelAsync(request, { timeoutMs = 1800000, noCache = false } = {}) {
  const python = await resolveKernelPython();
  if (!python) return { ok: false, unavailable: UNAVAILABLE };
  const hash = requestHash(request);
  // An unusable cache (not ours, not creatable) means run uncached, never trust it.
  const useCache = !noCache && await ensurePrivateDir(bodyCacheDir());
  const dir = useCache ? path.join(bodyCacheDir(), hash) : await fsp.mkdtemp(path.join(os.tmpdir(), `conkay-cad-body-${hash}-`));
  const cached = path.join(dir, "result.json");
  if (useCache) {
    try {
      const r = JSON.parse(await fsp.readFile(cached, "utf8"));
      await preloadBodyStl(r);
      rememberKernel(keyOf(hash), r);
      return r;
    } catch { /* not cached, or result.json unreadable: run */ }
  }
  const full = request.command === "body" ? { ...request, outDir: dir } : request;
  const out = await runPythonKernel({ python, script: BODY_SCRIPT, input: full, timeoutMs });
  out.requestHash = hash;
  if (out.ok) await preloadBodyStl(out);
  if (noCache) return out;
  if (out.ok) {
    if (useCache && await ensurePrivateDir(dir)) {
      await writePrivateFile(cached, JSON.stringify(out));
      await writePrivateFile(path.join(dir, "request.json"), JSON.stringify(full)); // the receipt: what the kernel was given
    }
    rememberKernel(keyOf(hash), out);
  }
  return out;
}

/**
 * For the (synchronous) solver: the result if this process has it, else the run is queued and
 * { ok:false, pending:true, reason } is returned (DesignSession.settle() runs it and reruns the solver).
 */
export function runBodyKernel(request) {
  const hash = requestHash(request);
  return requestKernel(keyOf(hash), () => runBodyKernelAsync(request), `CAD body ${hash}`);
}
