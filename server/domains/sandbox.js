// server/domains/sandbox.js
// Records substrate for the sandbox lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerSandboxSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "sandbox", {
    noun: "experiment", idPrefix: "sbx",
  });
}
