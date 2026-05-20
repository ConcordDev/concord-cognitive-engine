// server/domains/expedition-journal.js
// Records substrate for the expedition-journal lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerExpeditionJournalSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "expedition-journal", {
    noun: "entry", idPrefix: "exj",
  });
}
