// server/domains/voice-tts.js
//
// Sprint D / CC2+CC3 — voice TTS macro surface (ElevenLabs-backed).
// Distinct from the existing voice.js (transcript analysis).

import { synthesizeLine } from "../lib/voice-synthesis.js";
import { getAuthoredNPC } from "../lib/content-seeder.js";

const DEFAULT_ARCHETYPE_VOICES = {
  warrior:   process.env.ELEVENLABS_VOICE_WARRIOR   || "21m00Tcm4TlvDq8ikWAM",
  guard:     process.env.ELEVENLABS_VOICE_GUARD     || "21m00Tcm4TlvDq8ikWAM",
  scholar:   process.env.ELEVENLABS_VOICE_SCHOLAR   || "MF3mGyEYCl7XYWbV9V6O",
  mystic:    process.env.ELEVENLABS_VOICE_MYSTIC    || "EXAVITQu4vr4xnSDxMaL",
  hunter:    process.env.ELEVENLABS_VOICE_HUNTER    || "ErXwobaYiN019PkySvjV",
  trader:    process.env.ELEVENLABS_VOICE_TRADER    || "AZnzlk1XvdvUeBnXmlld",
  legend:    process.env.ELEVENLABS_VOICE_LEGEND    || "VR6AewLTigWG4xSOukaG",
  default:   process.env.ELEVENLABS_VOICE_DEFAULT   || "21m00Tcm4TlvDq8ikWAM",
};

function voiceProfileFor(npc) {
  if (!npc) return { voice_id: DEFAULT_ARCHETYPE_VOICES.default };
  if (npc.voice_profile?.voice_id) return npc.voice_profile;
  const arch = npc.archetype || "default";
  return {
    voice_id: DEFAULT_ARCHETYPE_VOICES[arch] || DEFAULT_ARCHETYPE_VOICES.default,
    stability: 0.55, similarity_boost: 0.7, style: 0,
  };
}

export default function registerVoiceTTSMacros(register) {
  register("voice-tts", "synthesize", async (_ctx, input = {}) => {
    if (!input.npcId || !input.text) return { ok: false, reason: "missing_inputs" };
    const npc = getAuthoredNPC(input.npcId);
    const profile = input.voiceProfileOverride ?? voiceProfileFor(npc);
    return synthesizeLine(input.text, profile.voice_id, {
      stability: profile.stability,
      similarityBoost: profile.similarity_boost,
      style: profile.style,
    });
  });

  register("voice-tts", "preview", async (_ctx, input = {}) => {
    if (!input.voiceId) return { ok: false, reason: "missing_voice_id" };
    const text = input.text || "By the bones of the old archive, traveler — what news from the road?";
    return synthesizeLine(text, input.voiceId);
  });

  register("voice-tts", "profile_for_npc", async (_ctx, input = {}) => {
    if (!input.npcId) return { ok: false, reason: "missing_npcId" };
    const npc = getAuthoredNPC(input.npcId);
    return { ok: true, profile: voiceProfileFor(npc), hero: !!npc?.voice_profile };
  });

  register("voice-tts", "archetype_voices", async () => {
    return { ok: true, voices: { ...DEFAULT_ARCHETYPE_VOICES } };
  });
}

export { DEFAULT_ARCHETYPE_VOICES };
