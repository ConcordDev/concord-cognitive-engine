/**
 * Record (fake MediaRecorder) → stop persists the media id on the take →
 * reload (new mount, session blob gone) → Play points an <audio> at
 * /api/media/:id/stream and advances currentTime.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const store = vi.hoisted(() => {
  const state: { items: Array<Record<string, unknown>> } = { items: [] };
  return {
    state,
    create: vi.fn(async (input: { title?: string; data?: Record<string, unknown> }) => {
      state.items = [{
        id: 'artifact-take-1',
        title: input.title || 'Take',
        data: input.data,
        meta: { tags: [], status: 'ready', visibility: 'private' },
        createdAt: '2026-10-11T00:00:00.000Z',
        updatedAt: '2026-10-11T00:00:00.000Z',
        version: 1,
      }];
      return {};
    }),
  };
});

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: store.state.items,
    total: store.state.items.length,
    isLoading: false,
    isError: false,
    error: null,
    isSeeding: false,
    refetch: vi.fn(),
    create: (input: { title?: string; data?: Record<string, unknown> }) => store.create(input),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/voice/VoiceRecorder', () => ({ VoiceRecorder: () => null }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/store/ui', () => ({
  useUIStore: { getState: () => ({ addToast: vi.fn() }) },
}));

import { api } from '@/lib/api/client';
import { VoiceBoothPanel } from '@/components/voice/VoiceBoothPanel';

class FakeMediaRecorder {
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {}
  stop() {
    const data = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'audio/webm' });
    this.ondataavailable?.({ data });
    this.onstop?.();
  }
}

const uploads: Array<Record<string, unknown>> = [];
let originalPlay: typeof HTMLMediaElement.prototype.play;

beforeEach(() => {
  store.state.items = [];
  store.create.mockClear();
  uploads.length = 0;
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      }),
    },
  });
  vi.spyOn(api, 'post').mockImplementation(async (url: string, body?: unknown) => {
    if (url === '/api/media/upload') {
      uploads.push((body || {}) as Record<string, unknown>);
      return { data: { ok: true, mediaDTU: { id: 'media-take-1' } } };
    }
    return { data: {} };
  });
  originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
    Object.defineProperty(this, 'currentTime', { configurable: true, writable: true, value: 0.5 });
    Object.defineProperty(this, 'paused', { configurable: true, writable: true, value: false });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  };
});

afterEach(() => {
  cleanup();
  HTMLMediaElement.prototype.play = originalPlay;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('voice take playback after reload', () => {
  it('records fake media, reloads, and plays the owner stream', async () => {
    const first = render(<VoiceBoothPanel />);
    expect(screen.getAllByRole('button', { name: 'Record' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Record' })[0]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Stop' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop' })[0]);

    await waitFor(() => expect(store.create).toHaveBeenCalled());
    const saved = store.create.mock.calls[0][0] as { data: { mediaId?: string } };
    expect(saved.data.mediaId).toBe('media-take-1');
    expect(uploads[0]?.privacy).toBe('private');
    expect(typeof uploads[0]?.data).toBe('string');
    expect(String(uploads[0]?.data).length).toBeGreaterThan(0);

    first.unmount();
    render(<VoiceBoothPanel />);
    expect(await screen.findByText('Take 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const audio = document.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio!.getAttribute('src') || audio!.src).toContain('/api/media/media-take-1/stream');
    expect(audio!.currentTime).toBeGreaterThan(0);
  });
});
