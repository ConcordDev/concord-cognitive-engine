// server/domains/death-insurance.js
// Records substrate for the death-insurance lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerDeathInsuranceSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "death-insurance", {
    noun: "policy", idPrefix: "dip",
  });
}
