// server/domains/social.js
// Records substrate for the social lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerSocialLensSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "social", {
    noun: "post", idPrefix: "soc",
  });
}
