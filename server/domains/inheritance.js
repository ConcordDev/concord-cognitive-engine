// server/domains/inheritance.js
// Records substrate for the inheritance lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerInheritanceSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "inheritance", {
    noun: "claim", idPrefix: "inh",
  });
}
