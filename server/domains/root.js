// server/domains/root.js
// Records substrate for the root lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerRootLensSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "root", {
    noun: "task", idPrefix: "rt",
  });
}
