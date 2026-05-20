// server/domains/cognitive-replay.js
// Records substrate for the cognitive-replay lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerCognitiveReplaySubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "cognitive-replay", {
    noun: "replay", idPrefix: "rpl",
  });
}
