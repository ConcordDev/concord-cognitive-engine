// server/lib/voice/voice-pipeline.js
// Real-time voice agent pipeline.
// Orchestrates: inbound audio → STT (Whisper) → inference → TTS (Piper) → outbound audio.
// Designed for low-latency conversational flow: target < 700ms end-to-end.
//
// The STT (voice.transcribe) and TTS (voice.tts) macros already exist in server.js.
// This module adds the real-time session layer: VAD, barge-in, WebRTC signaling state.

import crypto from "node:crypto";

/**
 * Voice session states.
 */
export const SESSION_STATES = Object.freeze({
  IDLE: "idle",
  LISTENING: "listening",
  PROCESSING: "processing",
  SPEAKING: "speaking",
  INTERRUPTED: "interrupted",
  CLOSED: "closed",
});

/**
 * In-memory active sessions map. In production this would be Redis-backed.
 * Map: sessionId → VoiceSession
 */
const _sessions = new Map();

/**
 * @typedef {Object} VoiceSession
 * @property {string} id
 * @property {string} userId
 * @property {string} state
 * @property {string[]} history   - recent transcript turns for context
 * @property {number} createdAt
 * @property {number} lastActiveAt
 * @property {AbortController} [currentGeneration]  - abort handle for barge-in
 */

/**
 * Create a new voice session.
 * @param {string} userId
 * @returns {VoiceSession}
 */
export function createSession(userId) {
  const id = `vs_${crypto.randomBytes(8).toString("hex")}`;
  const session = {
    id,
    userId,
    state: SESSION_STATES.IDLE,
    history: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  _sessions.set(id, session);
  return session;
}

/**
 * Get an existing voice session.
 */
export function getSession(sessionId) {
  return _sessions.get(sessionId) || null;
}

/**
 * Terminate a voice session and release resources.
 */
export function closeSession(sessionId) {
  const session = _sessions.get(sessionId);
  if (!session) return;
  if (session.currentGeneration) {
    session.currentGeneration.abort();
  }
  session.state = SESSION_STATES.CLOSED;
  _sessions.delete(sessionId);
}

/**
 * Handle barge-in: user speaks while agent is responding.
 * Aborts current generation and switches to listening state.
 */
export function handleBargeIn(sessionId) {
  const session = _sessions.get(sessionId);
  if (!session || session.state !== SESSION_STATES.SPEAKING) return false;
  if (session.currentGeneration) {
    session.currentGeneration.abort();
    session.currentGeneration = null;
  }
  session.state = SESSION_STATES.INTERRUPTED;
  return true;
}

/**
 * Process a voice turn: audio buffer → transcript → inference → TTS audio.
 *
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {Buffer|string} opts.audioData   - raw audio buffer or base64 string
 * @param {string} [opts.audioFormat]      - 'webm', 'wav', 'ogg' etc.
 * @param {Function} opts.runMacro         - server.js runMacro function
 * @param {Function} opts.infer            - @concord/inference infer()
 * @param {object} opts.ctx                - makeCtx(req) context
 * @returns {Promise<{ok, transcript, responseText, audioBase64?, latencyMs}>}
 */
export async function processVoiceTurn({ sessionId, audioData, audioFormat = "webm", runMacro, infer, ctx }) {
  const startTime = Date.now();
  const session = _sessions.get(sessionId);
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.state === SESSION_STATES.CLOSED) return { ok: false, error: "session_closed" };

  session.state = SESSION_STATES.PROCESSING;
  session.lastActiveAt = Date.now();

  // 1. Speech-to-text via existing voice.transcribe macro
  let transcript = "";
  try {
    const audioInput = Buffer.isBuffer(audioData)
      ? audioData.toString("base64")
      : audioData;

    const sttResult = await runMacro("voice", "transcribe", {
      audioBase64: audioInput,
      format: audioFormat,
    }, ctx);

    if (!sttResult?.ok) {
      session.state = SESSION_STATES.IDLE;
      return { ok: false, error: sttResult?.error || "transcription_failed" };
    }
    transcript = sttResult.transcript || "";
  } catch (err) {
    session.state = SESSION_STATES.IDLE;
    return { ok: false, error: err?.message || "transcription_error" };
  }

  if (!transcript.trim()) {
    session.state = SESSION_STATES.IDLE;
    return { ok: true, transcript: "", responseText: "", latencyMs: Date.now() - startTime };
  }

  // 2. Inference — with barge-in support via AbortController
  const abortController = new AbortController();
  session.currentGeneration = abortController;
  session.state = SESSION_STATES.SPEAKING;

  let responseText = "";
  try {
    const result = await infer({
      role: "conscious",
      intent: transcript,
      history: session.history.slice(-6).map((h, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: h,
      })),
      callerId: `voice:${sessionId}`,
      maxSteps: 5,
      signal: abortController.signal,
    });

    if (!abortController.signal.aborted) {
      responseText = result.finalText || "";
    }
  } catch (err) {
    if (err?.name !== "AbortError") {
      session.state = SESSION_STATES.IDLE;
      return { ok: false, error: err?.message || "inference_error" };
    }
    // Aborted by barge-in — return partial
    session.state = SESSION_STATES.INTERRUPTED;
    return { ok: true, transcript, responseText: "", interrupted: true, latencyMs: Date.now() - startTime };
  } finally {
    if (session.currentGeneration === abortController) {
      session.currentGeneration = null;
    }
  }

  // 3. Update conversation history
  session.history.push(transcript, responseText);
  if (session.history.length > 20) session.history.splice(0, 2);

  // 4. Text-to-speech via existing voice.tts macro
  let audioBase64 = null;
  if (responseText) {
    try {
      const ttsResult = await runMacro("voice", "tts", {
        text: responseText.slice(0, 1000), // cap for latency
      }, ctx);
      if (ttsResult?.ok) {
        audioBase64 = ttsResult.audioBase64 || null;
      }
    } catch { /* TTS failure is non-fatal — return text only */ }
  }

  session.state = SESSION_STATES.IDLE;

  return {
    ok: true,
    transcript,
    responseText,
    audioBase64,
    latencyMs: Date.now() - startTime,
  };
}

/**
 * Get all active session stats (for monitoring).
 */
export function getSessionStats() {
  const sessions = [..._sessions.values()];
  return {
    total: sessions.length,
    byState: sessions.reduce((acc, s) => {
      acc[s.state] = (acc[s.state] || 0) + 1;
      return acc;
    }, {}),
  };
}

// Prune stale sessions every 5 minutes
const STALE_SESSION_MS = 30 * 60 * 1000; // 30 minutes
// @resource-leak-ok: process-lifetime — voice queue heartbeat
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of _sessions) {
    if (now - session.lastActiveAt > STALE_SESSION_MS) {
      closeSession(id);
    }
  }
}, 5 * 60 * 1000).unref?.();
