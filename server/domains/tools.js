// server/domains/tools.js
// Records substrate for the tools lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerToolsLensSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "tools", {
    noun: "tool", idPrefix: "tol",
  });
}
