/**
 * lib/voice/piper-stream.ts — fetchPiperAudio envelope-unwrap contract.
 *
 * Root-cause pattern this pins: POST /api/lens/run always responds
 * { ok: true, result: PAYLOAD } where the outer `ok` is just a transport
 * flag — voice.tts's real `{ ok, audioBase64 }` payload lives under
 * `.result` (server.js:12362 `register("voice","tts", ...)`). Before the
 * fix, `fetchPiperAudio` read `json.ok` / `json.audioBase64` directly off
 * the transport envelope, which are always undefined, so Piper TTS never
 * played and every NPC line silently fell back to Web Speech.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPiperAudio, createSpeechActivityEnvelope } from '@/lib/voice/piper-stream';

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPiperAudio — envelope unwrap', () => {
  it('reads audioBase64 from the correctly-nested { ok, result: { ok, audioBase64 } } envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, result: { ok: true, audioBase64: 'QUJD' } }),
    ));
    const r = await fetchPiperAudio('hello there', {});
    expect(r).not.toBeNull();
    expect(r?.ok).toBe(true);
    expect(r?.audioBase64).toBe('QUJD');
  });

  it('returns null when the nested macro payload reports ok:false (e.g. voice disabled)', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, result: { ok: false, error: 'voice disabled' } }),
    ));
    const r = await fetchPiperAudio('hello there', {});
    expect(r).toBeNull();
  });

  it('returns null when the nested payload is ok:true but missing audioBase64', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, result: { ok: true } }),
    ));
    const r = await fetchPiperAudio('hello there', {});
    expect(r).toBeNull();
  });

  it('falls back gracefully to a flat (unwrapped) payload shape for back-compat', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, audioBase64: 'ZmxhdA==' }),
    ));
    const r = await fetchPiperAudio('hello there', {});
    expect(r?.audioBase64).toBe('ZmxhdA==');
  });

  it('returns null on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({}, false)));
    const r = await fetchPiperAudio('hello there', {});
    expect(r).toBeNull();
  });

  it('returns null on a network/transport error (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(fetchPiperAudio('hello there', {})).resolves.toBeNull();
  });
});

describe('createSpeechActivityEnvelope — Web Speech fallback (B#14)', () => {
  // The Web Speech API exposes no audio amplitude; the old fallback
  // fabricated a 4Hz sine "lip flap". The replacement reports only an
  // activity level driven by real utterance events. These tests pin
  // that contract: silence is 0, levels come from events (not time
  // alone), and nothing oscillates on its own.
  it('is 0 while not speaking, whatever the clock says', () => {
    const env = createSpeechActivityEnvelope();
    expect(env.sample(0)).toBe(0);
    expect(env.sample(60_000)).toBe(0);
  });

  it('speaking without boundary events is a steady 0.3 (no synthetic oscillation)', () => {
    const env = createSpeechActivityEnvelope();
    env.start();
    expect(env.sample(1_000)).toBe(0.3);
    expect(env.sample(1_125)).toBe(0.3); // a sine flap would differ here
    expect(env.sample(9_999)).toBe(0.3);
  });

  it('a word boundary raises the level, which then decays back to the speaking base', () => {
    const env = createSpeechActivityEnvelope();
    env.start();
    // boundary() stamps Date.now(); sample relative to a fresh stamp.
    env.boundary();
    const t0 = Date.now();
    expect(env.sample(t0)).toBe(0.75);
    const mid = env.sample(t0 + 260); // halfway through the 120..400ms decay
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.75);
    expect(env.sample(t0 + 10_000)).toBe(0.3); // long past the boundary: voice-active base
  });

  it('stop() returns the level to 0 immediately', () => {
    const env = createSpeechActivityEnvelope();
    env.start();
    env.boundary();
    env.stop();
    expect(env.sample(Date.now())).toBe(0);
  });
});
