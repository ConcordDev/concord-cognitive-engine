// server/domains/sentinel.js
// Records substrate for the sentinel lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerSentinelSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "sentinel", {
    noun: "watch", idPrefix: "snt",
  });
}
