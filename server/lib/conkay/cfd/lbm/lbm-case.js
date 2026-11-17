// server/lib/conkay/cfd/lbm/lbm-case.js
//
// Writes an aero.lbm case through lbm_case.py (stdlib Python; CONKAY_CFD_PYTHON, else python3). The
// kernel replies with the sha256 of every written file and caseSha256 over all of them, so a
// recorded run can be matched to the exact case it was made from.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPythonKernel } from "../../cad/kernel-queue.js";
import { cfdPython } from "../openfoam-case.js";
import { sha256File } from "../run-store.js";

export const LBM_CASE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "lbm_case.py");
export const LBM_CASE_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "aero_lbm.cpp");

/** { ok, preset, args, files, caseSha256, kernelSha256 } or { ok:false, error }. outDir omitted = hashes only. */
export async function writeLbmCase(req) {
  const r = await runPythonKernel({ python: cfdPython(), script: LBM_CASE_SCRIPT, input: req, timeoutMs: 60000 });
  if (r.ok) r.kernelSha256 = sha256File(LBM_CASE_SCRIPT);
  return r;
}
