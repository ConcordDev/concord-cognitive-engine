// server/domains/conkay.js
//
// ConKay Voice + Affect fusion (#15) — macros over lib/conkay-affect.js. Tracks
// a persistent per-user affect state from real VAD analysis of the user's words,
// exposes the TTS prosody it implies, and a one-line persona note. The actual
// speech I/O is the existing real voice adapter (voice-tts.synthesize) — these
// macros produce the affect + prosody it consumes.
//
// Registered from server.js: registerConkayMacros(register).

import { observeTurn, getAffectState, prosodyParams, affectNote, analyzeAffect } from "../lib/conkay-affect.js";

export default function registerConkayMacros(register) {
  register("conkay", "observe", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const state = observeTurn(db, userId, input.text || "");
    return { ok: true, state, prosody: prosodyParams(state), note: affectNote(state) };
  }, { note: "update ConKay's affect state from a user turn (real VAD) + derive prosody (#15)" });

  register("conkay", "affect_state", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const state = getAffectState(db, userId);
    return { ok: true, state, prosody: prosodyParams(state), note: affectNote(state) };
  }, { note: "current ConKay affect state + prosody + persona note (#15)" });

  register("conkay", "analyze", async (_ctx, input = {}) => {
    return { ok: true, vad: analyzeAffect(input.text || "") };
  }, { note: "analyze the VAD affect of a piece of text (real lexicon) (#15)" });
}
