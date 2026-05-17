// lib/init-modalities.js
//
// Probe non-LLM modalities at boot. Mirrors initFiveBrains() pattern but
// for STT (whisper.cpp) + TTS (Piper / ElevenLabs).
//
// Detection is intentionally light: presence of the binary or API key is
// enough to mark `enabled`. Actual capability errors (model file missing,
// API key revoked, etc.) surface at use-time and bump the per-modality
// `stats.errors` counter — no health-loop polling here.

import { existsSync, statSync } from "node:fs";
import { MODALITY } from "./modality-config.js";

function isExecutableFile(p) {
  if (!p) return false;
  try {
    const s = statSync(p);
    if (!s.isFile()) return false;
    // X bit for any class
    return (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Probe all configured modalities once at boot. Idempotent.
 * Returns a flat object suitable for structured logging.
 */
export async function initModalities() {
  // STT — whisper.cpp binary present + executable
  const sttBin = MODALITY.stt.bin;
  MODALITY.stt.enabled = isExecutableFile(sttBin);

  // TTS — Piper binary present + executable
  const piperBin = MODALITY.tts.piper.bin;
  MODALITY.tts.piper.enabled = isExecutableFile(piperBin);

  // TTS — ElevenLabs API key set (non-empty is the only check we'll do at
  // boot; we don't burn API quota probing on startup).
  MODALITY.tts.elevenlabs.enabled = !!MODALITY.tts.elevenlabs.apiKey;

  return {
    stt: MODALITY.stt.enabled,
    tts_piper: MODALITY.tts.piper.enabled,
    tts_elevenlabs: MODALITY.tts.elevenlabs.enabled,
    sttSource: MODALITY.stt.enabled ? "whisper_cpp" : "none",
    ttsSource: MODALITY.tts.piper.enabled
      ? "piper"
      : MODALITY.tts.elevenlabs.enabled
        ? "elevenlabs"
        : "none",
  };
}

/**
 * Test-only override. Test files inject fake state by passing
 * { stt: bool, ttsPiper: bool, ttsElevenLabs: bool }.
 */
export function _testForceModalityState({ stt, ttsPiper, ttsElevenLabs }) {
  if (stt !== undefined) MODALITY.stt.enabled = !!stt;
  if (ttsPiper !== undefined) MODALITY.tts.piper.enabled = !!ttsPiper;
  if (ttsElevenLabs !== undefined) MODALITY.tts.elevenlabs.enabled = !!ttsElevenLabs;
}

export { isExecutableFile as _isExecutableFile_forTesting };
