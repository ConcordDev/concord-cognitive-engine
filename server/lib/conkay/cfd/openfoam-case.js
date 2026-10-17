// server/lib/conkay/cfd/openfoam-case.js
//
// Writes an OpenFOAM case through cfd/openfoam_case.py (stdlib Python; CONKAY_CFD_PYTHON, else
// python3). The kernel replies with the sha256 of every written file and caseSha256 over all of
// them, so a recorded run can be matched to the exact case it was made from.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPythonKernel } from "../cad/kernel-queue.js";
import { sha256File } from "./run-store.js";

export const CASE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "openfoam_case.py");

export function cfdPython() {
  return process.env.CONKAY_CFD_PYTHON || "python3";
}

/** { ok, preset, files, caseSha256, kernelSha256, ... } or { ok:false, error }. outDir omitted = hashes only. */
export async function writeCase({ preset, outDir, nproc, endTime, aref, lref }) {
  const r = await runPythonKernel({ python: cfdPython(), script: CASE_SCRIPT, input: { preset, outDir, nproc, endTime, aref, lref }, timeoutMs: 60000 });
  if (r.ok) r.kernelSha256 = sha256File(CASE_SCRIPT);
  return r;
}

/** True when the box [min, max] lies inside the preset's finest refinement box. */
export function fitsPreset(bbox, fits) {
  return [0, 1, 2].every((i) => bbox.min[i] >= fits.min[i] && bbox.max[i] <= fits.max[i]);
}
