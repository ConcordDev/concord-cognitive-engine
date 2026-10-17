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
  turbulence: "rans",
  status: "pending",
  reason: "the first 2000-iteration run did not settle (half-window drift 1.1 % on the total); the 4000-iteration extension is running",
  target: AHMED_GANT_25.total,
});

// The transient DDES template (cfd/openfoam_case.py, turbulence "ddes"). It has never been run: no
// DES Ahmed case exists, so this stays pending. A settled record here must come from a DES run
// reduced with timeWindowStatistics/timeWindowVerdict (force-coeffs.js), not from the RANS tail.
export const AHMED_DES_VALIDATION = Object.freeze({
  turbulence: "ddes",
  status: "pending",
  reason: "no DES Ahmed 25 deg run has been made with the DDES template",
  target: AHMED_GANT_25.total,
});

const VALIDATIONS = Object.freeze({ rans: AHMED_CFD_VALIDATION, ddes: AHMED_DES_VALIDATION });

/** The validation record for a turbulence model; throws on an unknown model (no fallback to RANS). */
export function validationFor(turbulence) {
  if (!Object.hasOwn(VALIDATIONS, turbulence)) throw new Error(`no Ahmed validation record for turbulence ${JSON.stringify(turbulence)}`);
  return VALIDATIONS[turbulence];
}

/**
 * { accepted, reason } for a validation record, used for a result of the given turbulence model.
 * A record only ever unlocks results of its own model: a RANS validation never accepts a DES result
 * and vice versa. A record without a `turbulence` field is a RANS record.
 */
export function validationAccepted(v = AHMED_CFD_VALIDATION, turbulence = "rans") {
  const own = v.turbulence ?? "rans";
  if (own !== turbulence) return { accepted: false, reason: `the ${own} Ahmed 25 deg validation does not validate a ${turbulence} result` };
  const label = turbulence === "rans" ? "" : `${turbulence.toUpperCase()} `;
  if (v.status !== "settled") return { accepted: false, reason: `the CFD template's Ahmed 25 deg ${label}validation is ${v.status}: ${v.reason}` };
  const err = (v.total.mean - v.target) / v.target;
  if (!(Math.abs(err) <= AHMED_TOLERANCE.relError)) {
    return { accepted: false, reason: `the CFD template (${turbulence}) misses Ahmed 25 deg by ${(err * 100).toFixed(1)} % (tolerance ${AHMED_TOLERANCE.relError * 100} %)` };
  }
  return { accepted: true, relError: err };
}
