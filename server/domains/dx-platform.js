// server/domains/dx-platform.js
// Records substrate for the dx-platform lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerDxPlatformSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "dx-platform", {
    noun: "metric", idPrefix: "dxp",
  });
}
