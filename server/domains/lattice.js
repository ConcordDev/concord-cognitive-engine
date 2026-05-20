// server/domains/lattice.js
// Records substrate for the lattice lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerLatticeSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "lattice", {
    noun: "node", idPrefix: "lat",
  });
}
