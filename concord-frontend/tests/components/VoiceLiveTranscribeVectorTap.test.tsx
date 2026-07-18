/**
 * VoiceLiveTranscribe — the parallel raw-audio mic tap that computes a real
 * per-final-segment acoustic vector (lib/voice/audio-features.ts) and rides
 * it along on voice.live-append calls. This is what makes
 * voice.recording-auto-label-speakers reachable on live/meeting transcripts
 * (docs/WAVE4_INVENTORY.md voice row).
 *
 * Pins:
 *  1. A final SpeechRecognition result, after the tap has accumulated real
 *     frames, sends live-append WITH a genuinely computed `.vector`.
 *  2. An interim (non-final) result never attaches/consumes a vector.
 *  3. When the tap never accumulated any frames for a segment (or the tap
 *     never started at all — mic denied), live-append is called with NO
 *     vector field — an honest omission, never a fabricated placeholder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import React from 'react';

interface LiveAppendCall { domain: string; action: string; params: Record<string, unknown> }
const calls: LiveAppendCall[] = [];

const lensRunMock = vi.fn(async (domain: string, action: string, params: Record<string, unknown> = {}) => {
  calls.push({ domain, action, params });
  if (domain === 'voice' && action === 'live-start') {
    return { data: { ok: true, result: { session: { id: 'live_test_1', title: (params.title as string) || 'Live', language: (params.language as string) || 'en-US', status: 'live', words: [] } } } };
  }
  if (domain === 'voice' && action === 'live-append') {
    return { data: { ok: true, result: { wordCount: 1, accepted: { id: `lw_${calls.length}`, text: params.text, isFinal: params.isFinal, vector: params.vector } } } };
  }
  if (domain === 'voice' && action === 'live-detail') {
    return { data: { ok: true, result: { session: { id: 'live_test_1', title: 'Live', language: 'en-US', status: 'live', words: [] } } } };
  }
  if (domain === 'voice' && action === 'live-list') {
    return { data: { ok: true, result: { sessions: [] } } };
  }
  return { data: { ok: true, result: {} } };
});

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: [string, string, Record<string, unknown>?]) => lensRunMock(...args),
}));

import { VoiceLiveTranscribe } from '@/components/voice/VoiceLiveTranscribe';

// ── Fake SpeechRecognition ───────────────────────────────────────────────
interface FakeRecInstance {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
}
let lastRec: FakeRecInstance | null = null;

class FakeSpeechRecognition implements FakeRecInstance {
  lang = 'en-US'; continuous = false; interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastRec = this;
  }
}

function fireResult(text: string, isFinal: boolean) {
  lastRec!.onresult!({
    resultIndex: 0,
    results: { length: 1, 0: { isFinal, 0: { transcript: text }, length: 1 } },
  });
}

// ── Fake Web Audio graph for the mic tap ─────────────────────────────────
let fakeFreqValue = -100; // dB — near-silent by default
class FakeAnalyser {
  fftSize = 2048;
  frequencyBinCount = 4;
  getFloatFrequencyData(arr: Float32Array) { arr.fill(fakeFreqValue); }
  getFloatTimeDomainData(arr: Float32Array) { arr.fill(0.3); } // non-zero RMS so frames are distinguishable from silence
}
class FakeAudioCtx {
  sampleRate = 16000;
  createMediaStreamSource() { return { connect: vi.fn() }; }
  createAnalyser() { return new FakeAnalyser(); }
  close() { return Promise.resolve(); }
}

let rafCallback: FrameRequestCallback | null = null;

function grantMicAccess() {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    configurable: true,
  });
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioCtx as unknown;
}

function denyMicAccess() {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    configurable: true,
  });
}

describe('VoiceLiveTranscribe — real per-segment vector capture via the mic tap', () => {
  const originalMediaDevices = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  const originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;

  beforeEach(() => {
    calls.length = 0;
    lastRec = null;
    rafCallback = null;
    fakeFreqValue = -100;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCallback = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true });
    (window as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a final result AFTER the tap accumulated real frames sends live-append WITH a genuine .vector', async () => {
    grantMicAccess();
    const { getByText } = render(<VoiceLiveTranscribe />);

    await act(async () => { fireEvent.click(getByText('Go live')); });
    // Let the startVectorTap async chain (getUserMedia → AudioContext → first rAF schedule) settle.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(rafCallback).not.toBeNull();
    // Simulate 2 accumulated audio frames before the SpeechRecognition final arrives.
    await act(async () => { rafCallback!(0); });
    await act(async () => { rafCallback!(0); });

    await act(async () => { fireResult('hello world', true); });

    const appendCalls = calls.filter((c) => c.action === 'live-append');
    expect(appendCalls).toHaveLength(1);
    const vec = appendCalls[0].params.vector as number[] | undefined;
    expect(vec).toBeDefined();
    expect(vec).toHaveLength(5);
    // Non-silent constant time-domain data (0.3) → real, non-zero energy dim.
    expect(vec![1]).toBeGreaterThan(0);
  });

  it('an interim (non-final) result never attaches a vector, even with frames accumulated', async () => {
    grantMicAccess();
    const { getByText } = render(<VoiceLiveTranscribe />);
    await act(async () => { fireEvent.click(getByText('Go live')); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { rafCallback!(0); });

    await act(async () => { fireResult('hel', false); });

    const appendCalls = calls.filter((c) => c.action === 'live-append');
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0].params.isFinal).toBe(false);
    expect(appendCalls[0].params.vector).toBeUndefined();
  });

  it('a final result with ZERO accumulated frames sends live-append with NO vector field (honest omission, not fabrication)', async () => {
    grantMicAccess();
    const { getByText } = render(<VoiceLiveTranscribe />);
    await act(async () => { fireEvent.click(getByText('Go live')); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // No rafCallback invoked at all — zero frames accumulated for this segment.
    await act(async () => { fireResult('untapped', true); });

    const appendCalls = calls.filter((c) => c.action === 'live-append');
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0].params.vector).toBeUndefined();
  });

  it('when mic access is denied, live transcription still works via SpeechRecognition alone — no vector ever attached', async () => {
    denyMicAccess();
    const { getByText } = render(<VoiceLiveTranscribe />);
    await act(async () => { fireEvent.click(getByText('Go live')); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { fireResult('still transcribing', true); });

    const appendCalls = calls.filter((c) => c.action === 'live-append');
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0].params.text).toBe('still transcribing');
    expect(appendCalls[0].params.vector).toBeUndefined();
    // A denied mic tap is an honest no-op — it does not throw or block
    // transcription; SpeechRecognition.start() still ran.
    expect(lastRec!.start).toHaveBeenCalled();
  });
});
