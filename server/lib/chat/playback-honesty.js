// server/lib/chat/playback-honesty.js
//
// Final-answer guard: if the model claims a track/song is playing or that
// audio was created/generated, but no tool result in this run produced an
// audio artifact or audioUrl, rewrite the answer to retract the false claim.
// This is a hard backstop for the honesty rule in agent-mode music/playback.

const PLAYING_CLAIM_RE = /\b(now playing|is playing|are playing|playing (it|now|for you)|started playing|here(?:'s| is) (?:your|the) (?:song|track))\b/i;
const CREATION_CLAIM_RE = /\b(song|track|music|audio)\b[^.]{0,60}\b(created|generated|made|rendered|composed)\b|\b(created|generated|made|rendered|composed)\b[^.]{0,60}\b(song|track|music|audio)\b/i;
const NOTE = "\n\nNote: no audio was produced in this chat, so nothing is playing.";

function hasAudioUrl(value, depth = 0) {
  if (depth > 3 || value == null) return false;
  if (Array.isArray(value)) return value.some((v) => hasAudioUrl(v, depth + 1));
  if (typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value)) {
    if ((k === "audioUrl" || k === "previewUrl") && v) return true;
    if (hasAudioUrl(v, depth + 1)) return true;
  }
  return false;
}

function resultHasAudio(r) {
  if (!r) return false;
  if (r.artifact?.kind === "audio") return true;
  if (Array.isArray(r.artifacts) && r.artifacts.some((a) => a?.kind === "audio")) return true;
  return hasAudioUrl(r.result, 0);
}

/**
 * @param {string} answer
 * @param {Array} results - tool results from the whole run
 * @returns {string} answer, possibly corrected
 */
export function guardPlaybackClaim(answer, results) {
  const text = String(answer || "");
  if (!text.trim()) return text;
  if (!PLAYING_CLAIM_RE.test(text) && !CREATION_CLAIM_RE.test(text)) return text;
  if (Array.isArray(results) && results.some(resultHasAudio)) return text;
  const parts = text.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((p) => !PLAYING_CLAIM_RE.test(p) && !CREATION_CLAIM_RE.test(p));
  const cleaned = kept.join("").trim();
  return cleaned ? `${cleaned}${NOTE}` : NOTE.trim();
}

export default guardPlaybackClaim;
