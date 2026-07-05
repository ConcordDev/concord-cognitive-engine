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
import { fetchPiperAudio } from '@/lib/voice/piper-stream';

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
