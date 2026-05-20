// server/domains/staking.js
// Records substrate for the staking lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerStakingSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "staking", {
    noun: "stake", idPrefix: "stk",
  });
}
