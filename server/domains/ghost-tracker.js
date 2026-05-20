// server/domains/ghost-tracker.js
// Records substrate for the ghost-tracker lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerGhostTrackerSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "ghost-tracker", {
    noun: "sighting", idPrefix: "ght",
  });
}
