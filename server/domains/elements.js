// server/domains/elements.js
//
// WS-CHEMISTRY — expose the (already-built) Element-vs-Material matrix +
// environmental feedback as BotW-style COMBINABLE player verbs. Applying an
// element at a spot writes its environmental signature (elementalEnvFeedback)
// into the embodied signal grid, where the existing signal-propagation chemistry
// (evaluateCombos: steam at hot+humid, etc.) already composes it with everything
// else — so fire + water from two players makes steam without any new rule. The
// matrix (ignites/douses/reactions) tells the caller what the combination does.
//
// matrix  — read the reaction table (public).
// apply   — apply an element at a location (writes signals; requires actor).
// ignite/douse — convenience wrappers with the ignites/douses material check.

import { ELEMENTS, reactionsFor, ignites, douses, elementVsElement } from "../lib/element-matrix.js";
import { elementalEnvFeedback } from "../lib/embodied/skill-environment.js";
import { recordSignal } from "../lib/embodied/signals.js";

function applyElementAt(db, { worldId, x, z, element, magnitude = 50, userId }) {
  const feedback = elementalEnvFeedback(element, magnitude);
  let written = 0;
  for (const sig of feedback) {
    const r = recordSignal(db, {
      worldId, x, z, channel: sig.channel, value: sig.value,
      ttlSeconds: sig.ttlSeconds, source: "player_element", sourceId: userId || null,
    });
    if (r) written++;
  }
  return { signalsWritten: written, feedback };
}

export default function registerElementMacros(register) {
  register("elements", "matrix", async (_ctx, input = {}) => {
    if (input.a && input.b) {
      return { ok: true, pair: { a: input.a, b: input.b, result: elementVsElement(input.a, input.b) } };
    }
    const table = ELEMENTS.map((e) => ({ element: e, reactions: reactionsFor(e) }));
    return { ok: true, elements: ELEMENTS, table };
  }, { note: "the element reaction matrix (combinable-verb reference)" });

  register("elements", "apply", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const { worldId, x, z, element, magnitude } = input;
    if (!worldId || !element) return { ok: false, reason: "missing_args" };
    if (!ELEMENTS.includes(element)) return { ok: false, reason: "unknown_element" };
    const res = applyElementAt(db, { worldId, x, z, element, magnitude, userId });
    return { ok: true, element, reactions: reactionsFor(element), ...res };
  }, { note: "apply an element at a location — writes env signals the chemistry composes" });

  register("elements", "ignite", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const { worldId, x, z, targetMaterial, element = "fire" } = input;
    if (!worldId) return { ok: false, reason: "missing_args" };
    const caught = targetMaterial ? ignites(element, targetMaterial) : true;
    const res = applyElementAt(db, { worldId, x, z, element, magnitude: input.magnitude ?? 60, userId });
    return { ok: true, element, targetMaterial: targetMaterial ?? null, caught, ...res };
  }, { note: "ignite (fire by default) — caught=true when the target material burns" });

  register("elements", "douse", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const { worldId, x, z, present, element = "water" } = input;
    if (!worldId) return { ok: false, reason: "missing_args" };
    const doused = present ? douses(element, present) : true;
    const res = applyElementAt(db, { worldId, x, z, element, magnitude: input.magnitude ?? 50, userId });
    return { ok: true, element, doused, ...res };
  }, { note: "douse (water by default) — doused=true when it quenches the present element" });
}
