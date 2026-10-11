// server/lib/conkay/cad/tub-fit-kernel.js
//
// Clearance of structural parts (oriented boxes) to the inner face of the CAD
// body's skin, measured on the body's STEP by OpenCascade (cad/tub_fit_occ.py):
// corner classification + BRepExtrema distance to the outer shell, minus the
// skin thickness. Async (child process); { ok:false, error } when no kernel.

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { runPythonKernel, requestKernel } from "./kernel-queue.js";
import { resolveKernelPython, UNAVAILABLE } from "./body-kernel.js";

export const TUB_FIT_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "tub_fit_occ.py");

/** boxes: [{ id, center, half, axes }] (packaging/geometry.js obb). */
export async function runTubFitKernelAsync({ step, skinThickness, boxes }, { timeoutMs = 600000 } = {}) {
  const python = await resolveKernelPython();
  if (!python) return { ok: false, error: UNAVAILABLE };
  if (!step) return { ok: false, error: "no body STEP (cad.body files.step)" };
  return runPythonKernel({ python, script: TUB_FIT_SCRIPT, input: { step, skinThickness, boxes: boxes.map((b) => ({ id: b.id, center: b.center, half: b.half, axes: b.axes })) }, timeoutMs });
}

const SCRIPT_HASH = createHash("sha256").update(fs.readFileSync(TUB_FIT_SCRIPT)).digest("hex");

/** Synchronous: a computed result, or { ok:false, pending:true } with the run queued (settle() runs it). */
export function runTubFitKernel(req) {
  const key = createHash("sha256").update(SCRIPT_HASH).update(JSON.stringify(req)).digest("hex").slice(0, 24);
  return requestKernel(`tub-fit:${key}`, () => runTubFitKernelAsync(req), `tub fit ${key}`);
}
