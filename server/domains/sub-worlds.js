// server/domains/sub-worlds.js
// Records substrate for the sub-worlds lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerSubWorldsSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "sub-worlds", {
    noun: "world", idPrefix: "sbw",
  });
}
