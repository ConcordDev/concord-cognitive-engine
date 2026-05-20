// server/domains/cognition.js
// Records substrate for the cognition lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerCognitionSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "cognition", {
    noun: "experiment", idPrefix: "cog",
  });
}
