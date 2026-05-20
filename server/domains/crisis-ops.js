// server/domains/crisis-ops.js
// Records substrate for the crisis-ops lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerCrisisOpsSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "crisis-ops", {
    noun: "incident", idPrefix: "crs",
  });
}
