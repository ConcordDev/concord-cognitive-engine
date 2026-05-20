// server/domains/tournaments.js
// Records substrate for the tournaments lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerTournamentsSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "tournaments", {
    noun: "tournament", idPrefix: "trn",
  });
}
