// server/domains/immersive-sim.js
//
// Phase II Wave 27 — immersive-sim polish: prop verbs + disguise.

import {
  PROP_VERBS, getVerbsForProp, hasVerb, listAllPropKinds, resolveVerbInvocation,
} from "../lib/prop-verb-registry.js";
import {
  probabilityOfRecognition, rollRecognition, DISGUISE_CONSTANTS,
} from "../lib/disguise-system.js";

export default function registerImmersiveSimMacros(register) {
  register("immersive_sim", "prop_verbs", async (_ctx, input = {}) => {
    const propKind = String(input?.propKind || "");
    return { ok: true, verbs: getVerbsForProp(propKind) };
  });

  register("immersive_sim", "invoke_verb", async (_ctx, input = {}) => {
    return resolveVerbInvocation(String(input?.propKind || ""), String(input?.verb || ""));
  });

  register("immersive_sim", "all_prop_kinds", async () => {
    return { ok: true, propKinds: listAllPropKinds() };
  });

  register("immersive_sim", "has_verb", async (_ctx, input = {}) => {
    return { ok: true, has: hasVerb(String(input?.propKind || ""), String(input?.verb || "")) };
  });

  register("immersive_sim", "recognition_probability", async (_ctx, input = {}) => {
    return { ok: true, probability: probabilityOfRecognition(input) };
  });

  register("immersive_sim", "roll_recognition", async (_ctx, input = {}) => {
    return rollRecognition(input);
  });

  register("immersive_sim", "registries", async () => {
    return {
      ok: true,
      propRegistry: PROP_VERBS,
      disguiseConstants: DISGUISE_CONSTANTS,
    };
  });
}
