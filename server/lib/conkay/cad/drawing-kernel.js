// server/lib/conkay/cad/drawing-kernel.js
//
// Runs the drawing projection kernel (conkay_drawing_occ.py, OpenCascade via
// OCP) with the same Python as the CAD body kernel (body-kernel.js). Results
// are cached in memory and on disk by a hash of the script and the request;
// the request carries the content hash of the geometry it projects (the
// body's mesh SHA-256), so a changed body is a different request.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bodyKernelPython, bodyCacheDir, EXTENTS_SCRIPT } from "./body-kernel.js";

export const DRAWING_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "conkay_drawing_occ.py");
const memo = new Map();

export function drawingRequestHash(request) {
  const script = createHash("sha256").update(fs.readFileSync(DRAWING_SCRIPT)).update(fs.readFileSync(EXTENTS_SCRIPT)).digest("hex");
  return createHash("sha256").update(script).update(JSON.stringify(request)).digest("hex").slice(0, 24);
}

/** request = { command: "project", step, geometryHash, views, ... }. Returns the kernel JSON or { ok: false, unavailable | error }. */
export function runDrawingKernel(request, { timeoutMs = 600000 } = {}) {
  const python = bodyKernelPython();
  if (!python) return { ok: false, unavailable: "no Python with OCP: set CONKAY_OCC_PYTHON or install cadquery-ocp in the ConKay OCC venv" };
  const hash = drawingRequestHash(request);
  if (memo.has(hash)) return memo.get(hash);
  const dir = path.join(bodyCacheDir(), `drawing-${hash}`);
  const cached = path.join(dir, "result.json");
  if (fs.existsSync(cached)) {
    try { const r = JSON.parse(fs.readFileSync(cached, "utf8")); memo.set(hash, r); return r; } catch { /* re-run */ }
  }
  let out;
  try {
    const stdout = execFileSync(python, [DRAWING_SCRIPT], { input: JSON.stringify(request), maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, stdio: ["pipe", "pipe", "pipe"] });
    out = JSON.parse(stdout.toString("utf8"));
  } catch (e) {
    return { ok: false, error: `drawing kernel run failed: ${(e.stderr?.toString() || e.message || "").split("\n").filter(Boolean).slice(-1)[0] || "unknown"}` };
  }
  out.requestHash = hash;
  if (out.ok) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cached, JSON.stringify(out));
  }
  memo.set(hash, out);
  return out;
}
