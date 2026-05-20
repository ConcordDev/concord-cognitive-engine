// server/domains/genesis.js
// Records substrate for the genesis lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerGenesisSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "genesis", {
    noun: "seed", idPrefix: "gen",
  });
}
