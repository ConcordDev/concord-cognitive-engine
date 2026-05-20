// server/domains/bounties.js
// Records substrate for the bounties lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerBountiesSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "bounties", {
    noun: "bounty", idPrefix: "bnt",
  });
}
