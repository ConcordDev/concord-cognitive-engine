// lib/concordia/mood-registry.ts
//
// WAVE EXPR — the live bridge between the broadcast emotional state and the
// body. NpcPerceptionBridge already dispatches `concordia:npc-mood` (mood +
// avoidEyeContact …) but nothing consumed it, so NPCs rendered frozen-neutral.
// This module is the consumer: a window listener fills a per-NPC mood registry,
// and AvatarSystem3D reads `emotionFor`/`biasFor` per frame to drive the facial
// rig + the pose-broker. Module-level Map (one per tab); install once. Behind
// CONCORD_EXPRESSION at the install site.

import { stateBias, moodToEmotion } from "./mood-bias-pose";
import type { MoodVector, FacialEmotion, StateBias } from "./mood-bias-pose";

const _moods = new Map<string, MoodVector>();
let _installed = false;

/** Map the `concordia:npc-mood` payload onto a MoodVector. */
function fromPayload(d: Record<string, unknown>): MoodVector {
  return {
    mood: typeof d.mood === "string" ? d.mood : undefined,
    grief: typeof d.grief === "number" ? d.grief : undefined,
    hostility: typeof d.hostility === "number" ? d.hostility : undefined,
    fatigue: typeof d.fatigue === "number" ? d.fatigue : undefined,
    threat: typeof d.threat === "number" ? d.threat : undefined,
    relationship: typeof d.relationship === "number" ? d.relationship : undefined,
    avoidEyeContact: !!d.avoidEyeContact,
  };
}

/** Install the window listener once (no-op on SSR or double-install). */
export function installMoodListener(): void {
  if (_installed || typeof window === "undefined") return;
  _installed = true;
  window.addEventListener("concordia:npc-mood", (e: Event) => {
    const d = (e as CustomEvent).detail || {};
    if (!d || !d.npcId) return;
    _moods.set(String(d.npcId), fromPayload(d));
  });
}

export function getMood(npcId: string): MoodVector | null { return _moods.get(npcId) || null; }
/** The facial emotion for an NPC's current mood (null if no mood known → caller falls back). */
export function emotionFor(npcId: string): FacialEmotion | null {
  const m = _moods.get(npcId);
  return m ? moodToEmotion(m) : null;
}
/** The spine-up body bias for an NPC's current mood (null if unknown). */
export function biasFor(npcId: string): StateBias | null {
  const m = _moods.get(npcId);
  return m ? stateBias(m) : null;
}

// test seam
export const _testing = {
  reset() { _moods.clear(); _installed = false; },
  set(npcId: string, v: MoodVector) { _moods.set(npcId, v); },
  installed() { return _installed; },
};
