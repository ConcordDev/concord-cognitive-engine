// server/lib/chat-self.js
//
// "Living chat" — Layer 1: THE SELF. Today chat is stateless-per-turn and its affect
// dumps into a generic `system:chat` bucket. This gives the assistant a PERSISTENT
// felt self per user: a continuous affect_state (`assistant:<userId>`) that each
// exchange actually moves, the previously-DEAD `hookChat` finally fired (so the
// qualia self-model channels update), and a readable mood (a qualeOf label) for the
// prompt + the UI. The assistant becomes a continuous someone across your
// conversations, not a fresh brain each message.
//
//   feelChatTurn(db, userId, userMessage) -> { entityId, feltPer, kind }   (the live wire)
//   readChatMood(db, userId)              -> { entityId, valence, arousal, quale, lit }
//   classifyChatTurn / appraiseChatTurn / chatHookContext  (pure helpers)
//
// Reuses felt-per (the appraisal), affect-bridge (the persistent state), qualia-space
// (the label), and existential/hooks.hookChat (the dead hook). Best-effort + total.

import { appraiseExperience } from "./felt-per.js";
import { applyAffectEvent, getAffectStateFor } from "./affect-bridge.js";
import { qualeOf } from "./qualia-space.js";
import { hookChat } from "../existential/hooks.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

export function assistantEntityId(userId) {
  return `assistant:${userId || "default"}`;
}

// What this exchange IS, for the assistant — classified from the user's message tone.
// Reuses the felt-per APPRAISAL kinds (a sting, a thanks, a breakthrough, a struggle).
const CHAT_PATTERNS = Object.freeze([
  { kind: "social_warm", re: /\b(thank|thanks|thx|appreciate|grateful|love (it|this|that|you)|amazing|brilliant|perfect|awesome|you'?re? (great|the best))\b/i },
  { kind: "social_snub", re: /\b(stupid|useless|terrible|hate (this|you|it)|shut up|wrong again|you'?re? (bad|wrong|awful)|idiot|garbage|trash|pathetic)\b/i },
  { kind: "victory",     re: /\b(it works|got it|solved|figured (it )?out|that did it|fixed|works now|nailed it|exactly right|makes sense now)\b/i },
  { kind: "defeat",      re: /\b(still (broken|failing|not working)|doesn'?t work|gave up|so frustrat|stuck again|nothing works|why won'?t)\b/i },
  { kind: "explore",     re: /\?|\b(how|why|what if|explain|wonder|curious|explore|understand|teach me)\b/i },
]);

export function classifyChatTurn(userMessage) {
  const s = String(userMessage || "");
  for (const p of CHAT_PATTERNS) if (p.re.test(s)) return p.kind;
  return "idle";
}

// Appraise this exchange against the assistant's CURRENT mood (mood congruence — a
// strained assistant reads the next message a touch darker; a warm one warmer).
export function appraiseChatTurn(userMessage, priorAffect) {
  const kind = classifyChatTurn(userMessage);
  const len = String(userMessage || "").length;
  const engagement = Math.min(1, 0.6 + len / 1000); // longer = more engaged (light boost)
  return appraiseExperience({ kind, magnitude: engagement }, { affect: priorAffect || {} });
}

// Build the hookChat input (the dead hook's contract) from the felt-per + the message.
export function chatHookContext(feltPer, userMessage) {
  const v = Number(feltPer?.valence) || 0;
  const len = String(userMessage || "").length;
  const complexity = clamp01(len / 1200);
  return {
    distressLevel: v < 0 ? clamp01(-v) : 0,
    hopeLevel: v > 0 ? clamp01(v) : 0,
    cognitiveComplexity: complexity,
    // a strained / aroused assistant gets terser + more direct; a calm one expansive
    directness: clamp01(0.4 + clamp01(feltPer?.arousal) * 0.5),
    detailDensity: Math.max(0.2, 1 - complexity * 0.4),
  };
}

const KIND_TO_EVENT = Object.freeze({
  social_warm: "SUCCESS", victory: "SUCCESS", explore: "USER_MESSAGE",
  idle: "USER_MESSAGE", social_snub: "CONFLICT", defeat: "ERROR",
});

/**
 * THE LIVE WIRE: on each chat turn, the assistant FEELS the exchange and the dead
 * `hookChat` fires (so reflection/delivery channels move). Persistent per-user state.
 * Best-effort — never blocks the reply. Returns the felt-per + kind for surfacing.
 */
export function feelChatTurn(db, userId, userMessage) {
  const entityId = assistantEntityId(userId);
  // the engine's valence is 0..1 (0.5 neutral); felt-per is -1..1. Map on read-in.
  let prior = {};
  try { const st = getAffectStateFor(db, entityId); if (st) prior = { v: engineToFelt(st.v), a: st.a ?? 0 }; } catch { /* fresh */ }
  const feltPer = appraiseChatTurn(userMessage, prior);
  const kind = classifyChatTurn(userMessage);
  try {
    // the engine reads `intensity` + `polarity` (NOT magnitude) for the valence delta.
    // A clear-toned exchange lands with real intensity; polarity carries the felt sign.
    applyAffectEvent(db, entityId, {
      type: KIND_TO_EVENT[kind] || "USER_MESSAGE",
      intensity: Math.max(0.5, Math.min(1, Math.abs(feltPer.valence) + 0.45)),
      polarity: feltPer.valence,
      magnitude: feltPer.intensity, // logged
      source: "chat",
    });
  } catch { /* affect optional */ }
  try { hookChat(entityId, chatHookContext(feltPer, userMessage)); } catch { /* qualia optional */ }
  return { entityId, feltPer, kind };
}

// engine valence 0..1 (0.5 = neutral) → felt valence -1..1
const engineToFelt = (v) => Math.max(-1, Math.min(1, ((Number(v) || 0.5) - 0.5) * 2));

/**
 * Read the assistant's current felt state for the prompt + UI: its valence/arousal and
 * a qualeOf LABEL (the felt life behind the reply). `lit` is true once the mood has
 * actually moved off neutral. Total.
 */
export function readChatMood(db, userId) {
  const entityId = assistantEntityId(userId);
  try {
    const st = getAffectStateFor(db, entityId);
    const v = engineToFelt(st?.v);          // map engine 0..1 → felt -1..1
    const a = st?.a ?? 0;
    const lit = Math.abs(v) > 0.1;          // "lit" = mood moved off neutral (arousal has a baseline)
    return { entityId, valence: v, arousal: a, quale: lit ? qualeOf({ valence: v, arousal: a }).label : null, lit };
  } catch {
    return { entityId, valence: 0, arousal: 0, quale: null, lit: false };
  }
}

export const _internal = { CHAT_PATTERNS, KIND_TO_EVENT };
