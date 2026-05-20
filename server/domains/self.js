// server/domains/self.js
// Records substrate for the self lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerSelfLensSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "self", {
    noun: "reflection", idPrefix: "slf",
  });
}
