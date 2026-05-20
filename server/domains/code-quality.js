// server/domains/code-quality.js
// Records substrate for the code-quality lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerCodeQualitySubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "code-quality", {
    noun: "finding", idPrefix: "cdq",
  });
}
