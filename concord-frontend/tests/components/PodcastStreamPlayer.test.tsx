/// <reference types="@testing-library/jest-dom/vitest" />
// tests/components/PodcastStreamPlayer.test.tsx
//
// Pins the trim-silence auto-skip wiring in PodcastStreamPlayer: the "trim
// silence on" badge (previously inert — docs/WAVE4_INVENTORY.md podcast
// row) now drives a real auto-skip during playback once a silence range
// has actually been detected, and stays a true no-op when the preference
// is off. Network/decode analysis (`analyzeEpisodeForSilence`) is mocked
// here since it depends on `fetch` + `AudioContext.decodeAudioData`, which
// are exercised directly with real synthetic PCM math in
// tests/lib/podcast-silence-detect.test.ts — this file only pins the
// player's *reaction* to detected ranges.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ReactLocal = require('react');
      return ReactLocal.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    };
    Component.displayName = name;
    return Component;
  };
  return {
    Play: createIcon('Play'),
    Pause: createIcon('Pause'),
    SkipBack: createIcon('SkipBack'),
    SkipForward: createIcon('SkipForward'),
    ListTree: createIcon('ListTree'),
    Moon: createIcon('Moon'),
    Scissors: createIcon('Scissors'),
    Loader2: createIcon('Loader2'),
    Gauge: createIcon('Gauge'),
    X: createIcon('X'),
    Wand2: createIcon('Wand2'),
  };
});

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const analyzeEpisodeForSilenceMock = vi.fn();
vi.mock('@/lib/podcast/silence-detect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/podcast/silence-detect')>('@/lib/podcast/silence-detect');
  return {
    ...actual,
    analyzeEpisodeForSilence: (...args: unknown[]) => analyzeEpisodeForSilenceMock(...args),
  };
});

import { PodcastStreamPlayer } from '@/components/podcast/PodcastStreamPlayer';

function descriptorFor(trimSilence: boolean) {
  return {
    ok: true,
    result: {
      episodeId: 'ep_1',
      title: 'Test Episode',
      audioUrl: 'https://example.com/ep1.mp3',
      durationSec: 600,
      chapters: [],
      resumeSec: 0,
      playbackSpeed: 1,
      trimSilence,
      skipIntroSec: 0,
    },
  };
}

describe('PodcastStreamPlayer — trim-silence auto-skip', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    analyzeEpisodeForSilenceMock.mockReset();
    lensRunMock.mockResolvedValue({ data: { ok: true } });
  });

  it('auto-skips past a detected silence range on timeupdate when trimSilence is ON', async () => {
    lensRunMock.mockResolvedValueOnce({ data: descriptorFor(true) });
    // Simulate the (mocked) analysis engine reporting a real detected
    // range [5, 10) as soon as it "runs".
    analyzeEpisodeForSilenceMock.mockImplementation(async (_url: string, onProgress: (r: unknown) => void) => {
      onProgress([{ startSec: 5, endSec: 10 }]);
    });

    const { container } = render(
      <PodcastStreamPlayer episodeId="ep_1" deviceLabel="test-device" onClose={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('Test Episode')).toBeInTheDocument());
    // Analysis ran because trimSilence started true.
    await waitFor(() => expect(analyzeEpisodeForSilenceMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/trim silence on/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/1 gap found/)).toBeInTheDocument());

    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio).not.toBeNull();

    // Playback reaches a position inside the detected silent range.
    act(() => {
      Object.defineProperty(audio, 'currentTime', { value: 6, writable: true, configurable: true });
      Object.defineProperty(audio, 'duration', { value: 600, writable: true, configurable: true });
      fireEvent.timeUpdate(audio);
    });

    // The auto-skip logic should have jumped currentTime to the end of the
    // detected range (10), not left it sitting inside the silent stretch.
    expect(audio.currentTime).toBe(10);
  });

  it('does NOT auto-skip when trimSilence is OFF, even if a range was previously detected', async () => {
    lensRunMock.mockResolvedValueOnce({ data: descriptorFor(false) });

    const { container } = render(
      <PodcastStreamPlayer episodeId="ep_1" deviceLabel="test-device" onClose={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('Test Episode')).toBeInTheDocument());
    // Analysis never starts because trimSilence is off.
    expect(analyzeEpisodeForSilenceMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/trim silence on/)).toBeNull();

    const audio = container.querySelector('audio') as HTMLAudioElement;
    act(() => {
      Object.defineProperty(audio, 'currentTime', { value: 6, writable: true, configurable: true });
      Object.defineProperty(audio, 'duration', { value: 600, writable: true, configurable: true });
      fireEvent.timeUpdate(audio);
    });

    // No ranges were ever detected (analysis didn't run) and the gate is
    // off — currentTime must stay exactly where playback put it.
    expect(audio.currentTime).toBe(6);
  });

  it('clicking the trim-silence toggle persists the preference via playback-prefs-set', async () => {
    lensRunMock.mockResolvedValueOnce({ data: descriptorFor(false) });
    render(<PodcastStreamPlayer episodeId="ep_1" deviceLabel="test-device" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Test Episode')).toBeInTheDocument());
    const toggle = screen.getByLabelText('Toggle trim silence');
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { trimSilence: true } } });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('podcast', 'playback-prefs-set', { trimSilence: true }),
    );
    // Turning it on should kick off analysis.
    await waitFor(() => expect(analyzeEpisodeForSilenceMock).toHaveBeenCalled());
  });
});
