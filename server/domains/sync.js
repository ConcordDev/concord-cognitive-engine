// server/domains/sync.js
// Records substrate for the sync lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerSyncLensSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "sync", {
    noun: "device", idPrefix: "syn",
  });
}
