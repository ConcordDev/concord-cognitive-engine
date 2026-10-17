// server/lib/conkay/cfd/validation.js
//
// The OpenFOAM template's acceptance against the Ahmed body at 25 deg. aero.cfd reports a car
// result only while this record says the same template (case kernel hash below) reproduced
// Ahmed's total drag within the tolerance, on a settled run.
//
// Reference: Ahmed, Ramm & Faltin, SAE 840300 (1984), as tabulated by Gant (PhD thesis,
// Tables 7.3-7.4): 25 deg total Cd 0.285 (aero/calibrated-drag.js AHMED_GANT_25). Ahmed measured
// components only at 5, 12.5 and 30 deg; 25 deg is their interpolation.
// The component split (nose / slant / base) is reported beside it but is NOT part of the
// acceptance: the first run showed the slant and base trading pressure as the slant flow
// separated, a known difficulty of steady RANS at this critical angle.
//
// Numbers are re-derived from tests/fixtures/conkay-cfd/ahmed25 by tests/conkay-aero-cfd.test.js,
// so this record cannot drift from the data it describes.

import { AHMED_GANT_25 } from "../aero/calibrated-drag.js";

export const AHMED_TOLERANCE = Object.freeze({
  relError: 0.05,
  basis: "choice: +/-5 % of Gant's 0.285. Gant's tables are the only published 25 deg total in the sources read (Lienhart gives slant and base, no total), so no experimental spread is available to set it from",
});

export const AHMED_CFD_VALIDATION = Object.freeze({
  status: "pending",
  reason: "the first 2000-iteration run did not settle (half-window drift 1.1 % on the total); the 4000-iteration extension is running",
  target: AHMED_GANT_25.total,
});

/** { accepted, reason } for a validation record. */
export function validationAccepted(v = AHMED_CFD_VALIDATION) {
  if (v.status !== "settled") return { accepted: false, reason: `the CFD template's Ahmed 25 deg validation is ${v.status}: ${v.reason}` };
  const err = (v.total.mean - v.target) / v.target;
  if (!(Math.abs(err) <= AHMED_TOLERANCE.relError)) {
    return { accepted: false, reason: `the CFD template misses Ahmed 25 deg by ${(err * 100).toFixed(1)} % (tolerance ${AHMED_TOLERANCE.relError * 100} %)` };
  }
  return { accepted: true, relError: err };
}
