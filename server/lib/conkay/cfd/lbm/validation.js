// server/lib/conkay/cfd/lbm/validation.js
//
// The LBM template's acceptance against the Ahmed body at 25 deg. aero.lbm reports a car result
// only while this record says the same template (lbm_case.py + aero_lbm.cpp, hashed below) reproduced
// Ahmed's total drag within the tolerance, on a settled run.
//
// Reference: Ahmed, Ramm & Faltin, SAE 840300 (1984), as tabulated by Gant (PhD thesis, Tables
// 7.3-7.4): 25 deg total Cd 0.285 (aero/calibrated-drag.js AHMED_GANT_25). Same tolerance and same
// target as the OpenFOAM template (cfd/validation.js); the component split is reported, not accepted.
//
// Numbers are re-derived from tests/fixtures/conkay-lbm/ahmed25/forces.dat by
// tests/conkay-aero-lbm.test.js, so this record cannot drift from the data it describes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AHMED_GANT_25 } from "../../aero/calibrated-drag.js";
import { sha256File } from "../run-store.js";
export { AHMED_TOLERANCE } from "../validation.js";
import { AHMED_TOLERANCE } from "../validation.js";

export const LBM_AHMED_VALIDATION = Object.freeze({
  status: "pending",
  reason: "no GPU lattice-Boltzmann run of the Ahmed 25 deg body has been recorded yet",
  target: AHMED_GANT_25.total,
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** sha256 of the case generator and of the C++ case program as they are now. */
export function currentTemplate() {
  return { kernelSha256: sha256File(path.join(HERE, "lbm_case.py")), sourceSha256: sha256File(path.join(HERE, "aero_lbm.cpp")) };
}

/**
 * { accepted, reason } for a validation record. A record is only good for the template it was made with:
 * if lbm_case.py or aero_lbm.cpp has changed since (record.template), the gate is closed again.
 */
export function lbmValidationAccepted(v = LBM_AHMED_VALIDATION, now = currentTemplate) {
  if (v.status !== "settled") return { accepted: false, reason: `the LBM template's Ahmed 25 deg validation is ${v.status}: ${v.reason}` };
  const cur = typeof now === "function" ? now() : now;
  if (v.template?.kernelSha256 !== cur.kernelSha256 || v.template?.sourceSha256 !== cur.sourceSha256) {
    return { accepted: false, reason: "the LBM case generator or program changed after its Ahmed 25 deg validation run; the validation no longer describes this template" };
  }
  const err = (v.total.mean - v.target) / v.target;
  if (!(Math.abs(err) <= AHMED_TOLERANCE.relError)) {
    return { accepted: false, reason: `the LBM template misses Ahmed 25 deg by ${(err * 100).toFixed(1)} % (tolerance ${AHMED_TOLERANCE.relError * 100} %)` };
  }
  return { accepted: true, relError: err };
}
