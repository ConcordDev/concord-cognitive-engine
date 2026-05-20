// server/domains/sponsorship.js
// Records substrate for the sponsorship lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerSponsorshipSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "sponsorship", {
    noun: "sponsorship", idPrefix: "spo",
  });
}
