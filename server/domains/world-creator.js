// server/domains/world-creator.js
// Records substrate for the world-creator lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerWorldCreatorSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "world-creator", {
    noun: "draft", idPrefix: "wcr",
  });
}
