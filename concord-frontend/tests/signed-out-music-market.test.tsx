import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const { apiGet, openAuth } = vi.hoisted(() => ({ apiGet: vi.fn(), openAuth: vi.fn() }));
// GB-1536: a visitor's write control opens the ONE signup modal in place (useGuestAuth) instead of
// linking away to /login. Spy on openAuth; the rest of lib/guest stays real.
vi.mock('@/lib/guest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/guest')>()),
  useGuestAuth: () => ({ openAuth }),
}));
vi.mock('@/lib/api/client', () => ({ api: { get: (...a: unknown[]) => apiGet(...a) } }));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/components/music/liner/LinerNotesApp', () => ({ LinerNotesApp: () => <div data-testid="member-music-workspace" /> }));
vi.mock('@/components/market/MarketListingsPanel', () => ({ MarketListingsPanel: () => null }));

import { SignedOutMusicBrowse } from '@/components/public/SignedOutMusicBrowse';
import { MusicLensEntry } from '@/components/music/MusicLensEntry';
import { AnonBrowseProvider } from '@/lib/anon-browse';

const TRACK = (id: string, title: string, extra = {}) => ({
  id, title, description: 'a song', mediaType: 'audio', duration: 125, tags: ['lofi'], createdAt: '2026-11-01T00:00:00Z',
  authorName: null, views: 3, likes: 1, streamUrl: `/api/media/${id}/stream`, previewSeconds: 30, ...extra,
});
const SIGNED_OUT_PREVIEW = { 'x-concord-preview': 'true', 'x-concord-preview-seconds': '30', 'x-concord-full-requires': 'sign-in' };

beforeEach(() => {
  window.history.replaceState(null, '', '/lenses/music');
  apiGet.mockReset();
  openAuth.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 206, headers: new Headers(SIGNED_OUT_PREVIEW) }) as unknown as Response));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('Music for a signed-out visitor', () => {
  it('lists the public catalog with a player per track, no owner identity, and an honest anonymous byline', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, items: [TRACK('m1', 'Night Drive'), TRACK('m2', 'Sunrise', { authorName: 'Ada' })], total: 2 } });
    render(<SignedOutMusicBrowse />);
    await waitFor(() => expect(screen.getByTestId('visitor-track-m1')).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith('/api/media/public-feed', expect.objectContaining({ params: expect.objectContaining({ mediaType: 'audio', tab: 'latest', limit: 20, offset: 0 }) }));
    expect(screen.getByTestId('visitor-music-browse')).toBeTruthy();
    expect(within(screen.getByTestId('visitor-track-m1')).getByText('A Concord member')).toBeTruthy();
    expect(within(screen.getByTestId('visitor-track-m2')).getByText('Ada')).toBeTruthy();
    expect(within(screen.getByTestId('visitor-track-m1')).getByText('2:05')).toBeTruthy();
    expect(document.querySelectorAll('audio').length).toBe(2);
    expect(document.querySelector('audio')!.getAttribute('src')).toBe('/api/media/m1/stream');
  });

  it('the 30 s preview signal shows the Preview badge on play and the sign-in prompt when it ends', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, items: [TRACK('m1', 'Night Drive')], total: 1 } });
    render(<SignedOutMusicBrowse />);
    await waitFor(() => expect(screen.getByTestId('visitor-track-m1')).toBeTruthy());
    const audio = document.querySelector('audio') as HTMLAudioElement;
    fireEvent.play(audio);
    await waitFor(() => expect(screen.getByTestId('media-preview-badge')).toBeTruthy());
    fireEvent.ended(audio);
    const prompt = screen.getByTestId('media-preview-signin');
    expect(prompt.textContent).toMatch(/Sign in for the full track/);
    expect(prompt.getAttribute('href')).toBe(`/login?from=${encodeURIComponent('/lenses/music')}`);
  });

  it('every write is a sign-up gate that opens the auth modal, never a write that errors', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, items: [TRACK('m1', 'Night Drive')], total: 1 } });
    render(<SignedOutMusicBrowse />);
    await waitFor(() => expect(screen.getByTestId('visitor-track-m1')).toBeTruthy());
    const up = screen.getByTestId('visitor-upload');
    expect(up.tagName).toBe('BUTTON');
    expect(up.getAttribute('type')).toBe('button'); // never a form submit
    expect(up.textContent).toMatch(/Sign in to upload/);
    fireEvent.click(up);
    expect(openAuth).toHaveBeenCalledTimes(1);
    expect(openAuth).toHaveBeenCalledWith('signup');
    fireEvent.click(screen.getByText(/Sign in to like or comment/).closest('button')!);
    expect(openAuth).toHaveBeenCalledTimes(2);
    // Gating a write made no call beyond the one public read (the mock api has no write verbs).
    for (const c of apiGet.mock.calls) expect(c[0]).toBe('/api/media/public-feed');
    // The old in-frame sign-in/register/note chrome is retired: guests get it from the normal
    // shell's Topbar + GuestBanner (pinned in tests/appshell-visitor-browse.test.tsx).
    expect(screen.queryByTestId('visitor-signin')).toBeNull();
  });

  it('search and the Trending tab refetch the public catalog (no write calls are ever made)', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, items: [], total: 0 } });
    render(<SignedOutMusicBrowse />);
    await waitFor(() => expect(screen.getByTestId('visitor-music-empty')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'trending' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/api/media/public-feed', expect.objectContaining({ params: expect.objectContaining({ tab: 'trending' }) })));
    fireEvent.change(screen.getByLabelText('Search public tracks'), { target: { value: 'night' } });
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/api/media/public-feed', expect.objectContaining({ params: expect.objectContaining({ q: 'night' }) })));
    expect(screen.getByTestId('visitor-music-empty').textContent).toMatch(/No public tracks match/);
    for (const c of apiGet.mock.calls) expect(c[0]).toBe('/api/media/public-feed'); // only the one public read
  });

  it('paginates with Load more and shows an honest error with Retry', async () => {
    apiGet.mockResolvedValueOnce({ data: { ok: true, items: Array.from({ length: 2 }, (_, i) => TRACK(`a${i}`, `A${i}`)), total: 3 } });
    render(<SignedOutMusicBrowse />);
    await waitFor(() => expect(screen.getByTestId('visitor-music-more')).toBeTruthy());
    apiGet.mockResolvedValueOnce({ data: { ok: true, items: [TRACK('a2', 'A2')], total: 3 } });
    fireEvent.click(screen.getByTestId('visitor-music-more'));
    await waitFor(() => expect(screen.getByTestId('visitor-track-a2')).toBeTruthy());
    expect(apiGet).toHaveBeenLastCalledWith('/api/media/public-feed', expect.objectContaining({ params: expect.objectContaining({ offset: 2 }) }));
    expect(screen.queryByTestId('visitor-music-more')).toBeNull();
    cleanup();
    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error('down'));
    render(<SignedOutMusicBrowse />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not load the public catalog/));
    apiGet.mockResolvedValueOnce({ data: { ok: true, items: [TRACK('r1', 'Back')], total: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('visitor-track-r1')).toBeTruthy());
  });
});

describe('/lenses/music entry', () => {
  it('a visitor (flag on) gets the read-only catalog, not the member workspace', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, items: [], total: 0 } });
    render(<AnonBrowseProvider value><MusicLensEntry /></AnonBrowseProvider>);
    expect(screen.getByTestId('visitor-music-browse')).toBeTruthy();
    expect(screen.queryByTestId('member-music-workspace')).toBeNull();
  });
  it('a member (flag off, and the default) gets the full workspace', () => {
    render(<AnonBrowseProvider value={false}><MusicLensEntry /></AnonBrowseProvider>);
    expect(screen.getByTestId('member-music-workspace')).toBeTruthy();
    cleanup();
    render(<MusicLensEntry />);
    expect(screen.getByTestId('member-music-workspace')).toBeTruthy();
    expect(apiGet).not.toHaveBeenCalled();
  });
});
