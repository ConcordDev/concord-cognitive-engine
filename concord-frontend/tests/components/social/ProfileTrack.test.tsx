/**
 * ProfileTrack — the owner's chosen Studio track on the Social profile
 * (job oc-social-5, Social identity / JOB 8).
 *
 * The play control is the existing PostMediaCard player over the
 * listing's public /preview stream (never /master): tap-to-play only,
 * NEVER autoplay. The owner picker saves through
 * POST /api/social/identity/track and lists only the owner's own
 * published tracks from GET /api/social/identity/track-options. Only
 * the HTTP layer is mocked.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

import { ProfileTrack } from '@/components/social/ProfileTrack';

const TRACK = {
  listingId: 'lst_abc123',
  title: 'Midnight Loop',
  artist: 'Alice',
  genre: 'ambient',
  previewUrl: '/api/economy/marketplace/listings/lst_abc123/preview',
};

const OPTIONS = {
  ok: true,
  options: [
    { listingId: 'lst_abc123', title: 'Midnight Loop', artist: 'Alice' },
    { listingId: 'lst_def456', title: 'Sunrise Tape', artist: 'Alice' },
  ],
};

function renderTrack(props: { track?: typeof TRACK | null; isOwner?: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProfileTrack userId="alice" track={props.track ?? null} isOwner={props.isOwner ?? false} />
    </QueryClientProvider>,
  );
}

describe('ProfileTrack', () => {
  let playSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ data: OPTIONS });
    apiPost.mockResolvedValue({ data: { ok: true } });
    playSpy = vi.fn(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      playSpy();
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders a tap-to-play control over the listing preview stream — and NEVER autoplays', () => {
    renderTrack({ track: TRACK });
    const audio = document.querySelector('audio');
    expect(audio).toBeTruthy();
    // The stream is the listing's public PREVIEW — never /master.
    expect(audio?.getAttribute('src')).toBe(TRACK.previewUrl);
    expect(audio?.getAttribute('src')).not.toContain('/master');
    expect(audio?.hasAttribute('autoplay')).toBe(false);
    expect(audio?.getAttribute('preload')).toBe('none');
    // Nothing plays until the user taps.
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('shows the track title from the server payload', () => {
    renderTrack({ track: TRACK });
    expect(screen.getByText('Midnight Loop')).toBeTruthy();
    expect(screen.getByText(/Alice/)).toBeTruthy();
  });

  it('renders nothing for a viewer when no track is set (no fake placeholder)', () => {
    const { container } = renderTrack({ track: null, isOwner: false });
    expect(container.firstElementChild).toBeNull();
  });

  it('owner picker lists their own published tracks and saves the choice', async () => {
    renderTrack({ track: TRACK, isOwner: true });
    // Wait for the options to arrive before asserting the select's value —
    // a controlled select only sticks to an option that exists.
    await screen.findByText('Sunrise Tape');
    const select = screen.getByLabelText('Profile track') as HTMLSelectElement;
    expect(apiGet).toHaveBeenCalledWith('/api/social/identity/track-options');
    expect(select.value).toBe('lst_abc123');
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['No profile track', 'Midnight Loop', 'Sunrise Tape']);

    fireEvent.change(select, { target: { value: 'lst_def456' } });
    await vi.waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/social/identity/track', { listingId: 'lst_def456' });
    });
  });

  it('owner can clear the track by choosing “No profile track”', async () => {
    renderTrack({ track: TRACK, isOwner: true });
    const select = await screen.findByLabelText('Profile track');
    fireEvent.change(select, { target: { value: '' } });
    await vi.waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/social/identity/track', { listingId: null });
    });
  });

  it('surfaces the server error when the track cannot be set', async () => {
    apiPost.mockResolvedValue({ data: { ok: false, error: 'You can only feature your own tracks.' } });
    renderTrack({ track: TRACK, isOwner: true });
    const select = await screen.findByLabelText('Profile track');
    fireEvent.change(select, { target: { value: 'lst_def456' } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/only feature your own tracks/);
  });
});