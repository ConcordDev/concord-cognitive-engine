// server/domains/psyops.js
// Records substrate for the psyops lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerPsyopsSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "psyops", {
    noun: "operation", idPrefix: "pso",
  });
}
