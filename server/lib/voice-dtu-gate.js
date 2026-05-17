// lib/voice-dtu-gate.js
//
// Phase 13 (Stage B) — gating logic for the `voice.transcribe` macro's
// optional DTU mint. Extracted into a pure helper so a Tier-2 contract
// test can pin the gates without needing to load the entire server.js
// monolith.
//
// Gates:
//   - caller opted in via mintAsDtu: true (default false)
//   - transcript ≥ 20 chars (skip filler like "yes" / "hold on")
//   - audio duration ≥ 3s (skip filler)
//   - not during an active voice room (room has its own ledger)
//
// Returns { mint: bool, reason: string|null }. When `mint: true`, the
// caller should insert a `voice_capture` DTU with scope='personal'.

export const MIN_TRANSCRIPT_LEN = 20;
export const MIN_DURATION_S = 3;

export function shouldMintVoiceCaptureDtu({
  mintAsDtu,
  transcript,
  durationSeconds,
  inVoiceRoom,
}) {
  if (mintAsDtu !== true) return { mint: false, reason: 'not_opted_in' };
  const t = String(transcript || '');
  if (t.length < MIN_TRANSCRIPT_LEN) return { mint: false, reason: 'transcript_too_short' };
  const d = Number(durationSeconds) || 0;
  if (d < MIN_DURATION_S) return { mint: false, reason: 'audio_too_short' };
  if (inVoiceRoom === true) return { mint: false, reason: 'in_voice_room' };
  return { mint: true, reason: null };
}
