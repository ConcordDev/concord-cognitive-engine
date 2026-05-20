// server/domains/deities.js
// Records substrate for the deities lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerDeitiesSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "deities", {
    noun: "deity", idPrefix: "dei",
  });
}
