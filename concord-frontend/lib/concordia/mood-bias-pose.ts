// lib/concordia/mood-bias-pose.ts
//
// WAVE EXPR keystone — the STATE-BIAS BLOCK. The emotional state is already
// computed for schemes/slice-of-life and broadcast on `concordia:npc-mood`
// (mood + grief/hostility/fatigue/threat/relationship/avoidEyeContact) — but
// nothing consumes it, so NPCs render frozen-neutral. This is the PURE map from
// that state vector to a body bias: a spine-up additive posture (head/neck/
// torso/spine/hips only — legs/locomotion stay procedural), a breathing rate,
// a gaze policy, animation timing, and an exaggeration gain. No THREE import →
// headless-testable; the MoodBiasBridge converts `posture` to Euler rotations
// and feeds them to the pose-broker at 'action' priority (masks personality
// over gait, yields to combat/reflex), and routes `emotion` to the facial rig.
//
// Architecture rule (AAA): author the BIAS, never the output — physics/IK still
// solve last. Mappings follow posture research: confident=chest-out/head-up;
// defeated/grief=slump/head-down/shallow-breath; hostile=forward-lean/tense;
// fear=crouch/rapid-breath/closed; exhausted=low-stance/slow/deep-breath/flat.

export type Mood = "neutral" | "hostile" | "friendly" | "content" | "fearful" | "grieving" | "tense" | "wary";
export type GazePolicy = "direct" | "wary" | "avoid";
export type FacialEmotion =
  | "neutral" | "happy" | "sad" | "angry" | "fearful" | "disgusted" | "surprised" | "contempt" | "focused" | "exhausted" | "determined";

export interface MoodVector {
  mood?: string;          // the broadcast moodBias string
  grief?: number;         // 0..1
  hostility?: number;     // 0..1
  fatigue?: number;       // 0..1
  threat?: number;        // 0..1
  relationship?: number;  // -1..1 (toward the observer/player)
  avoidEyeContact?: boolean;
}

export interface PostureBias {
  // radians, spine-up additive offsets (positive pitch = forward/down lean)
  headPitch: number; neckPitch: number; torsoPitch: number; spinePitch: number; hipDrop: number;
}
export interface StateBias {
  posture: PostureBias;
  breathingRate: number;   // Hz (0.2 deep-calm … 0.65 rapid)
  breathingDepth: number;  // 0..1 (amplitude of the spine/shoulder sine)
  gazePolicy: GazePolicy;
  timingScalar: number;    // animation speed multiplier (0.7 sluggish … 1.15 sharp)
  exaggerationGain: number;// motion size (0.6 flat … 1.2 big)
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const n01 = (x: unknown) => clamp(Number(x) || 0, 0, 1);
const POSTURE_LIMIT = 0.42; // ~24° max spine-up lean, keeps it readable not broken

// Base archetype per mood (radians + feel). Numeric axes modulate on top.
const ARCHETYPE: Record<Mood, Partial<StateBias> & { posture: PostureBias }> = {
  neutral:  { posture: { headPitch: 0, neckPitch: 0, torsoPitch: 0, spinePitch: 0, hipDrop: 0 }, breathingRate: 0.28, breathingDepth: 0.4, gazePolicy: "direct", timingScalar: 1.0, exaggerationGain: 1.0 },
  content:  { posture: { headPitch: -0.05, neckPitch: -0.03, torsoPitch: -0.06, spinePitch: -0.04, hipDrop: 0 }, breathingRate: 0.26, breathingDepth: 0.45, gazePolicy: "direct", timingScalar: 1.0, exaggerationGain: 1.08 },
  friendly: { posture: { headPitch: -0.06, neckPitch: -0.03, torsoPitch: -0.05, spinePitch: -0.03, hipDrop: 0 }, breathingRate: 0.28, breathingDepth: 0.45, gazePolicy: "direct", timingScalar: 1.05, exaggerationGain: 1.12 },
  hostile:  { posture: { headPitch: 0.06, neckPitch: 0.04, torsoPitch: 0.16, spinePitch: 0.08, hipDrop: 0.02 }, breathingRate: 0.42, breathingDepth: 0.55, gazePolicy: "direct", timingScalar: 1.1, exaggerationGain: 1.15 },
  tense:    { posture: { headPitch: 0.03, neckPitch: 0.03, torsoPitch: 0.07, spinePitch: 0.05, hipDrop: 0.02 }, breathingRate: 0.4, breathingDepth: 0.35, gazePolicy: "wary", timingScalar: 0.95, exaggerationGain: 0.9 },
  wary:     { posture: { headPitch: 0.02, neckPitch: 0.05, torsoPitch: 0.04, spinePitch: 0.02, hipDrop: 0.03 }, breathingRate: 0.36, breathingDepth: 0.4, gazePolicy: "wary", timingScalar: 0.95, exaggerationGain: 0.95 },
  fearful:  { posture: { headPitch: 0.12, neckPitch: 0.08, torsoPitch: 0.18, spinePitch: 0.1, hipDrop: 0.1 }, breathingRate: 0.6, breathingDepth: 0.3, gazePolicy: "avoid", timingScalar: 1.1, exaggerationGain: 0.85 },
  grieving: { posture: { headPitch: 0.18, neckPitch: 0.1, torsoPitch: 0.16, spinePitch: 0.12, hipDrop: 0.06 }, breathingRate: 0.22, breathingDepth: 0.3, gazePolicy: "avoid", timingScalar: 0.8, exaggerationGain: 0.7 },
};

function asMood(s: string | undefined): Mood {
  return (s && (s as Mood) in ARCHETYPE) ? (s as Mood) : "neutral";
}

/**
 * The keystone: a mood/state vector → a body bias. Deterministic, bounded, pure.
 */
export function stateBias(v: MoodVector = {}): StateBias {
  const base = ARCHETYPE[asMood(v.mood)];
  const grief = n01(v.grief), hostility = n01(v.hostility), fatigue = n01(v.fatigue), threat = n01(v.threat);
  const rel = clamp(Number(v.relationship) || 0, -1, 1);

  // Numeric axes layer on top of the archetype (spine-up additive).
  const p: PostureBias = {
    headPitch:  base.posture.headPitch + grief * 0.18 + fatigue * 0.08 + threat * 0.06 - Math.max(0, rel) * 0.05,
    neckPitch:  base.posture.neckPitch + grief * 0.08 + threat * 0.05,
    torsoPitch: base.posture.torsoPitch + hostility * 0.14 + grief * 0.12 + threat * 0.1 - Math.max(0, rel) * 0.06,
    spinePitch: base.posture.spinePitch + grief * 0.1 + hostility * 0.06 + fatigue * 0.05,
    hipDrop:    base.posture.hipDrop + fatigue * 0.12 + threat * 0.08 + grief * 0.04,
  };
  for (const k of Object.keys(p) as (keyof PostureBias)[]) p[k] = clamp(p[k], -POSTURE_LIMIT, POSTURE_LIMIT);

  const breathingRate = clamp((base.breathingRate ?? 0.28) + threat * 0.18 + hostility * 0.06 - fatigue * 0.06, 0.18, 0.7);
  const breathingDepth = clamp((base.breathingDepth ?? 0.4) + fatigue * 0.2 - threat * 0.1, 0.2, 0.8);
  const timingScalar = clamp((base.timingScalar ?? 1.0) - fatigue * 0.25 - grief * 0.1 + hostility * 0.05, 0.6, 1.2);
  const exaggerationGain = clamp((base.exaggerationGain ?? 1.0) - fatigue * 0.3 - grief * 0.2 + hostility * 0.1, 0.5, 1.3);
  let gazePolicy: GazePolicy = base.gazePolicy ?? "direct";
  if (v.avoidEyeContact || rel < -0.4) gazePolicy = "avoid";
  else if (threat > 0.5 || hostility > 0.5) gazePolicy = gazePolicy === "avoid" ? "avoid" : "wary";

  return { posture: p, breathingRate, breathingDepth, gazePolicy, timingScalar, exaggerationGain };
}

/**
 * Route a mood (+ axes) to the facial EmotionType — fixes the frozen-neutral bug
 * (AvatarSystem3D fed resolveNPCEmotion hardcoded health=1/threat=0). The mood
 * vocabulary maps onto the 11-emotion rig.
 */
export function moodToEmotion(v: MoodVector = {}): FacialEmotion {
  const grief = n01(v.grief), hostility = n01(v.hostility), threat = n01(v.threat), fatigue = n01(v.fatigue);
  if (grief > 0.5) return "sad";
  if (threat > 0.6 || v.mood === "fearful") return "fearful";
  if (hostility > 0.5 || v.mood === "hostile") return "angry";
  if (fatigue > 0.6) return "exhausted";
  switch (asMood(v.mood)) {
    case "grieving": return "sad";
    case "hostile": return "angry";
    case "fearful": return "fearful";
    case "content":
    case "friendly": return "happy";
    case "tense":
    case "wary": return "focused";
    default: return (clamp(Number(v.relationship) || 0, -1, 1) > 0.5) ? "happy" : "neutral";
  }
}

/** The spine-up parts the bias touches (the rest stay procedural). */
export const BIAS_PARTS = ["head", "neck", "torso", "spine", "hips"] as const;
