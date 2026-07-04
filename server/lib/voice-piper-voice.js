/**
 * @fileoverview Piper TTS voice-id validation + resolution.
 *
 * `voice.tts` (server.js) previously read the Piper model to synthesize
 * ONLY from process.env.PIPER_VOICE — a per-request `input.voice` had no
 * way to steer synthesis. This module is the honest, allowlist-only
 * validator + resolver that lets a caller-supplied voice id be honored
 * safely (it is passed to `spawnSync` as a `--model` argument, so it MUST
 * be validated against a closed shape — never a blocklist).
 */

import path from "path";

/**
 * Piper voice-id shape, e.g. "en_US-amy-medium", "en_GB-alan-low".
 * Closed allowlist (not a blocklist) — this is what makes path traversal
 * ("../evil") and shell metacharacters structurally impossible to pass.
 */
export const PIPER_VOICE_ID_RE = /^[a-z]{2}_[A-Z]{2}-[a-z0-9]+-(x_low|low|medium|high)$/;

/**
 * Validates a caller-supplied Piper voice id.
 * Returns the id unchanged when it matches the closed allowlist shape,
 * otherwise `null` (covers non-strings, empty string, path traversal,
 * shell metacharacters, and any other shape violation).
 * @param {unknown} voiceId
 * @returns {string|null}
 */
export function validatePiperVoiceId(voiceId) {
  if (typeof voiceId !== "string" || voiceId.length === 0) return null;
  return PIPER_VOICE_ID_RE.test(voiceId) ? voiceId : null;
}

/**
 * Resolves which Piper voice a synthesis call should actually use, and
 * what to pass as the `--model` argument.
 *
 * - requestedVoice: caller-supplied `input.voice` (untrusted)
 * - envVoice: process.env.PIPER_VOICE (existing default-voice behavior)
 * - voicesDir: optional directory of "<voiceId>.onnx" model files
 *   (e.g. PIPER_VOICES_DIR). When set, a validated requestedVoice is only
 *   honored if its model file actually exists on disk; when unset, a
 *   validated requestedVoice is used directly — mirroring the existing
 *   env-voice behavior, which is also passed straight to spawnSync with
 *   no directory join.
 * - existsSync: injected fs.existsSync (testability; defaults to "false"
 *   so callers who forget to inject it fail closed, not open)
 *
 * Never returns an unvalidated string as `modelArg` — an invalid or
 * missing requested voice always falls back to the env voice (or empty).
 *
 * @param {{requestedVoice?: unknown, envVoice?: string, voicesDir?: string, existsSync?: (p: string) => boolean}} params
 * @returns {{modelArg: string, voiceUsed: string, voiceFallback: null|"env"|"none"}}
 */
export function resolvePiperVoice({ requestedVoice, envVoice, voicesDir, existsSync } = {}) {
  const env = typeof envVoice === "string" ? envVoice : "";
  const exists = typeof existsSync === "function" ? existsSync : () => false;
  const dir = typeof voicesDir === "string" ? voicesDir : "";

  const fallbackToEnv = () =>
    env
      ? { modelArg: env, voiceUsed: env, voiceFallback: "env" }
      : { modelArg: "", voiceUsed: "", voiceFallback: "none" };

  if (requestedVoice != null && requestedVoice !== "") {
    const validated = validatePiperVoiceId(requestedVoice);
    if (!validated) return fallbackToEnv();

    if (dir) {
      const resolvedPath = path.join(dir, `${validated}.onnx`);
      if (exists(resolvedPath)) {
        return { modelArg: resolvedPath, voiceUsed: validated, voiceFallback: null };
      }
      return fallbackToEnv();
    }

    return { modelArg: validated, voiceUsed: validated, voiceFallback: null };
  }

  return env
    ? { modelArg: env, voiceUsed: env, voiceFallback: null }
    : { modelArg: "", voiceUsed: "", voiceFallback: "none" };
}
