// lib/modality-config.js
//
// Modality Configuration — sibling to brain-config.js.
//
// Brains share a `chat(messages)` contract; modalities (STT, TTS, image gen,
// embedding) don't. They have no system prompt, no token budget, no reasoning
// surface. Forcing them into BRAIN_CONFIG would leak abstraction at every
// `for (const brain of BRAIN_CONFIG)` site. They live here instead.
//
// init-modalities.js probes each modality at boot and stamps `enabled`.

export const MODALITY = {
  stt: {
    backend: "whisper_cpp",
    binEnv: "WHISPER_CPP_BIN",
    bin: process.env.WHISPER_CPP_BIN || "",
    enabled: false,
    role: "speech-to-text via local whisper.cpp",
    timeoutMs: Number(process.env.WHISPER_TIMEOUT_MS) || 30000,
    stats: { calls: 0, errors: 0, lastError: null },
  },

  tts: {
    // Two TTS providers, separate intent. Piper = always-on local for NPC
    // dialogue + ambient TTS (no quota). ElevenLabs = reserved for player-
    // authored content (synthesis cost is real). The router picks based on
    // call site, not "best available".
    piper: {
      backend: "piper",
      binEnv: "PIPER_BIN",
      bin: process.env.PIPER_BIN || "",
      voiceEnv: "PIPER_VOICE",
      voice: process.env.PIPER_VOICE || "",
      enabled: false,
      role: "local TTS for NPC dialogue + ambient",
      timeoutMs: Number(process.env.PIPER_TIMEOUT_MS) || 15000,
      stats: { calls: 0, errors: 0, lastError: null },
    },
    elevenlabs: {
      backend: "elevenlabs",
      apiKeyEnv: "ELEVENLABS_API_KEY",
      apiKey: process.env.ELEVENLABS_API_KEY || "",
      enabled: false,
      role: "cloud TTS for player-authored creative content",
      timeoutMs: Number(process.env.ELEVENLABS_TIMEOUT_MS) || 30000,
      stats: { calls: 0, errors: 0, lastError: null },
    },
  },

  // Sprint C #4 — stem splitting (Demucs / Open-Unmix backend).
  // Reads DEMUCS_BIN at boot, stays disabled until the binary is
  // present. Mirrors STT/TTS shape so init-modalities probes uniformly.
  stems: {
    backend: "demucs",
    binEnv: "DEMUCS_BIN",
    bin: process.env.DEMUCS_BIN || "",
    enabled: false,
    role: "audio stem separation (vocal / drums / bass / other)",
    timeoutMs: Number(process.env.DEMUCS_TIMEOUT_MS) || 180_000,
    cacheDir: process.env.DEMUCS_CACHE_DIR || "./data/stems-cache",
    stats: { calls: 0, errors: 0, lastError: null },
  },
};

/**
 * Return a shallow snapshot for /api/health or diagnostics. Never returns
 * api keys or binary paths — only enabled/role/stats.
 */
export function getModalitySnapshot() {
  return {
    stt: {
      backend: MODALITY.stt.backend,
      enabled: MODALITY.stt.enabled,
      role: MODALITY.stt.role,
      stats: { ...MODALITY.stt.stats },
    },
    tts: {
      piper: {
        backend: MODALITY.tts.piper.backend,
        enabled: MODALITY.tts.piper.enabled,
        role: MODALITY.tts.piper.role,
        stats: { ...MODALITY.tts.piper.stats },
      },
      elevenlabs: {
        backend: MODALITY.tts.elevenlabs.backend,
        enabled: MODALITY.tts.elevenlabs.enabled,
        role: MODALITY.tts.elevenlabs.role,
        stats: { ...MODALITY.tts.elevenlabs.stats },
      },
    },
  };
}

/**
 * Convenience predicate — "is there at least one TTS provider available?"
 * Callers that don't care which provider use this.
 */
export function ttsAvailable() {
  return MODALITY.tts.piper.enabled || MODALITY.tts.elevenlabs.enabled;
}

/** Stem splitter availability — true when Demucs binary probed OK. */
export function stemsAvailable() {
  return !!MODALITY.stems.enabled;
}
