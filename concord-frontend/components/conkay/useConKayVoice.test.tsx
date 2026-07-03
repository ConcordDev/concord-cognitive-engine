// concord-frontend/components/conkay/useConKayVoice.test.tsx
//
// F3 (K6-voice) — pins two things:
//  1. `speak()` requests ConKay's pinned voice identity (`CONKAY_VOICE_ID`)
//     from Piper, not an unspecified/default voice.
//  2. The hook exposes a REAL amplitude envelope of ConKay's own speech
//     (`ttsAmplitudeRef`) that tracks `PiperPlaybackHandle#getEnvelopeAt` —
//     never a hardcoded or fabricated number — sampled via rAF (never
//     setInterval/setTimeout), and resets to 0 once speech ends.
//
// `speakWithPiperOrFallback` is mocked so the test controls exactly what
// "ConKay is speaking" looks like (a fake-but-EXPLICIT PiperPlaybackHandle
// whose `getEnvelopeAt` we drive), and `requestAnimationFrame` is stubbed
// with a manually-flushable queue so the per-frame sampling loop is
// deterministic instead of racing real frame timing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/voice/piper-stream', () => ({
  speakWithPiperOrFallback: vi.fn(),
}));

import { useConKayVoice } from './useConKayVoice';
import { CONKAY_VOICE_ID } from './conkay-persona';
import { speakWithPiperOrFallback } from '@/lib/voice/piper-stream';

const mockedSpeak = speakWithPiperOrFallback as unknown as ReturnType<typeof vi.fn>;

type RafCb = FrameRequestCallback;

function stubRaf() {
  let queue: RafCb[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: RafCb) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return {
    /** Run every callback currently queued (and no others scheduled after). */
    flush() {
      const due = queue;
      queue = [];
      due.forEach((cb) => cb(performance.now()));
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useConKayVoice — voice identity pin + own-speech amplitude (K6-voice / F3)', () => {
  let raf: ReturnType<typeof stubRaf>;

  beforeEach(() => {
    vi.clearAllMocks();
    raf = stubRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes CONKAY_VOICE_ID in the Piper voice profile', async () => {
    mockedSpeak.mockResolvedValue({
      cancel: vi.fn(),
      ended: Promise.resolve(),
      getEnvelopeAt: () => 0,
      source: 'piper' as const,
    });

    const { result } = renderHook(() =>
      useConKayVoice({ enabled: false, muted: false, onFinalTranscript: () => {} }),
    );

    await act(async () => {
      result.current.speak('hello, this is Kay');
      await flushMicrotasks();
    });

    expect(mockedSpeak).toHaveBeenCalledTimes(1);
    const [text, profile] = mockedSpeak.mock.calls[0];
    expect(text).toContain('hello, this is Kay');
    expect(profile).toMatchObject({ voice: CONKAY_VOICE_ID, rate: 0.98, pitch: 1.0 });
  });

  it('exposes ttsAmplitudeRef that tracks the REAL getEnvelopeAt value while speaking (not hardcoded)', async () => {
    let envelope = 0;
    let capturedOnStart: (() => void) | undefined;
    mockedSpeak.mockImplementation((_text: string, _profile: unknown, options: { onStart?: () => void }) => {
      capturedOnStart = options.onStart;
      return Promise.resolve({
        cancel: vi.fn(),
        ended: Promise.resolve(),
        getEnvelopeAt: () => envelope,
        source: 'piper' as const,
      });
    });

    const { result } = renderHook(() =>
      useConKayVoice({ enabled: false, muted: false, onFinalTranscript: () => {} }),
    );

    // Before speaking, the envelope ref is inert.
    expect(result.current.ttsAmplitudeRef.current).toBe(0);

    await act(async () => {
      result.current.speak('watch my amplitude move');
      await flushMicrotasks();
    });

    // Fire the real onStart the mocked Piper handle would call — this flips
    // `speaking`, which is what starts the rAF sampling loop.
    act(() => { capturedOnStart?.(); });
    expect(result.current.speaking).toBe(true);

    // First frame: envelope is 0 → exposed value must be 0 (not some default nonzero stub).
    act(() => { raf.flush(); });
    expect(result.current.ttsAmplitudeRef.current).toBe(0);

    // Move the REAL underlying envelope and let one more frame elapse — the
    // exposed value must follow it exactly. If this were faked/hardcoded, it
    // would stay at 0 or some fixed constant regardless of this change.
    envelope = 0.73;
    act(() => { raf.flush(); });
    expect(result.current.ttsAmplitudeRef.current).toBe(0.73);

    envelope = 0.12;
    act(() => { raf.flush(); });
    expect(result.current.ttsAmplitudeRef.current).toBe(0.12);
  });

  it('resets ttsAmplitudeRef to 0 once speech ends', async () => {
    let capturedOnStart: (() => void) | undefined;
    let capturedOnEnd: (() => void) | undefined;
    mockedSpeak.mockImplementation((_text: string, _profile: unknown, options: { onStart?: () => void; onEnd?: () => void }) => {
      capturedOnStart = options.onStart;
      capturedOnEnd = options.onEnd;
      return Promise.resolve({
        cancel: vi.fn(),
        ended: Promise.resolve(),
        getEnvelopeAt: () => 0.55,
        source: 'piper' as const,
      });
    });

    const { result } = renderHook(() =>
      useConKayVoice({ enabled: false, muted: false, onFinalTranscript: () => {} }),
    );

    await act(async () => {
      result.current.speak('a short line');
      await flushMicrotasks();
    });
    act(() => { capturedOnStart?.(); });
    act(() => { raf.flush(); });
    expect(result.current.ttsAmplitudeRef.current).toBe(0.55);

    act(() => { capturedOnEnd?.(); });
    expect(result.current.speaking).toBe(false);
    expect(result.current.ttsAmplitudeRef.current).toBe(0);
  });
});
