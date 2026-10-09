// server/lib/conkay/cad/drawing-kernel.js
//
// The drawing projection kernel (conkay_drawing_occ.py, OpenCascade via OCP),
// same Python and same off-the-solver-path pattern as the body kernel
// (kernel-queue.js). Results are cached in memory and on disk by a hash of the
// scripts and the request; the request carries the content hash of the
// geometry it projects (the body's mesh SHA-256), so a changed body is a
// different request.

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveKernelPython, kernelPythonPath, bodyCacheDir, ensurePrivateDir, writePrivateFile, EXTENTS_SCRIPT, UNAVAILABLE } from "./body-kernel.js";
import { requestKernel, rememberKernel, runPythonKernel } from "./kernel-queue.js";

export const DRAWING_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "conkay_drawing_occ.py");
// read once when the module loads
const SCRIPT_HASH = createHash("sha256").update(fs.readFileSync(DRAWING_SCRIPT)).update(fs.readFileSync(EXTENTS_SCRIPT)).digest("hex");

export function drawingRequestHash(request) {
  return createHash("sha256").update(SCRIPT_HASH).update(JSON.stringify(request)).digest("hex").slice(0, 24);
}

const keyOf = (hash) => `drawing:${hash}:${kernelPythonPath()}`;

/** request = { command: "project", step, geometryHash, views, ... }. Async; returns the kernel JSON or { ok: false, unavailable | error }. */
export async function runDrawingKernelAsync(request, { timeoutMs = 600000 } = {}) {
  const python = await resolveKernelPython();
  if (!python) return { ok: false, unavailable: UNAVAILABLE };
  const hash = drawingRequestHash(request);
  const dir = path.join(bodyCacheDir(), `drawing-${hash}`);
  const cached = path.join(dir, "result.json");
  const useCache = await ensurePrivateDir(bodyCacheDir()); // not ours / not creatable: run uncached, never trust it
  if (useCache) {
    try { const r = JSON.parse(await fsp.readFile(cached, "utf8")); rememberKernel(keyOf(hash), r); return r; } catch { /* not cached: run */ }
  }
  const out = await runPythonKernel({ python, script: DRAWING_SCRIPT, input: request, timeoutMs });
  out.requestHash = hash;
  if (out.ok) {
    if (useCache && await ensurePrivateDir(dir)) await writePrivateFile(cached, JSON.stringify(out));
    rememberKernel(keyOf(hash), out);
  }
  return out;
}

/** For the (synchronous) solver: the result if this process has it, else queued and reported pending. */
export function runDrawingKernel(request) {
  const hash = drawingRequestHash(request);
  return requestKernel(keyOf(hash), () => runDrawingKernelAsync(request), `drawing projection ${hash}`);
}
