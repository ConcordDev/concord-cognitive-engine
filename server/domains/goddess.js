// server/domains/goddess.js
// Records substrate for the goddess lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerGoddessLensSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "goddess", {
    noun: "invocation", idPrefix: "gds",
  });
}
