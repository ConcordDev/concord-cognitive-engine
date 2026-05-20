// server/domains/personas.js
// Records substrate for the personas lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerPersonasLensSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "personas", {
    noun: "persona", idPrefix: "per",
  });
}
