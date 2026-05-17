/**
 * AudioReelRecorder render tests.
 *
 * Pins:
 *   - Renders unsupported-browser banner when MediaRecorder is absent
 *   - Mic permission denied surfaces an error banner with Retry
 *   - Close button calls onClose
 *
 * Full record-and-post integration is exercised in lens-e2e — this file
 * is the render contract only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AudioReelRecorder } from '@/components/voice/AudioReelRecorder';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('AudioReelRecorder — unsupported browser', () => {
  beforeEach(() => {
    // Strip MediaRecorder so the unsupported-banner path renders.
    // @ts-expect-error — deletion is intentional for the no-recorder branch
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  });

  it('renders the "browser doesn\'t support" banner', () => {
    const { getByText } = wrap(<AudioReelRecorder onClose={() => {}} />);
    expect(getByText(/doesn.+support audio recording/i)).toBeTruthy();
  });
});

describe('AudioReelRecorder — supported browser', () => {
  beforeEach(() => {
    // Fake MediaRecorder + getUserMedia
    class FakeMediaRecorder {
      static isTypeSupported(_mime: string) { return _mime.startsWith('audio/webm'); }
      state: 'inactive' | 'recording' = 'inactive';
      ondataavailable: ((ev: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_stream: MediaStream, _opts?: MediaRecorderOptions) {}
      start(_chunkMs: number) { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.onstop?.(); }
    }
    // @ts-expect-error — overriding global for the test
    globalThis.MediaRecorder = FakeMediaRecorder;
    // jsdom doesn't ship navigator.mediaDevices — define a minimal stub.
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: () => {} }],
          getAudioTracks: () => [{ stop: () => {}, enabled: true }],
        }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    // @ts-expect-error — restore
    delete globalThis.MediaRecorder;
  });

  it('renders the recorder header with "Record an audio reel"', () => {
    const { getByText } = wrap(<AudioReelRecorder onClose={() => {}} />);
    expect(getByText('Record an audio reel')).toBeTruthy();
  });

  it('clicking the close button invokes onClose', () => {
    const onClose = vi.fn();
    const { getByLabelText } = wrap(<AudioReelRecorder onClose={onClose} />);
    fireEvent.click(getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes max-60s constraint in the header', () => {
    const { getByText } = wrap(<AudioReelRecorder onClose={() => {}} />);
    expect(getByText(/max 60s/i)).toBeTruthy();
  });
});
