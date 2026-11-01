import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { get: (...a: unknown[]) => apiGet(...a) } }));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/components/music/MusicWorkspace', () => ({ MusicWorkspace: () => <div data-testid="member-music-workspace" /> }));
vi.mock('@/components/market/MarketListingsPanel', () => ({ MarketListingsPanel: () => null }));

import { SignedOutMusicBrowse } from '@/components/public/SignedOutMusicBrowse';
import { SignedOutMarketBrowse } from '@/components/public/SignedOutMarketBrowse';
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

  it('every write is a sign-in link back to this page, never a button that errors', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, items: [TRACK('m1', 'Night Drive')], total: 1 } });
    render(<SignedOutMusicBrowse />);
    await waitFor(() => expect(screen.getByTestId('visitor-track-m1')).toBeTruthy());
    const up = screen.getByTestId('visitor-upload');
    expect(up.tagName).toBe('A');
    expect(up.textContent).toMatch(/Sign in to upload/);
    expect(up.getAttribute('href')).toContain('/login?from=');
    expect(screen.getByText(/Sign in to like or comment/).closest('a')!.getAttribute('href')).toContain('/login?from=');
    // the visitor frame offers sign-in + create account, and says what a visitor can do
    expect(screen.getByTestId('visitor-signin').getAttribute('href')).toContain('/login?from=');
    expect(screen.getByTestId('visitor-register').getAttribute('href')).toBe('/register');
    expect(screen.getByTestId('visitor-note').textContent).toMatch(/30 seconds/);
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

describe('Market for a signed-out visitor', () => {
  const ROWS = [
    { id: 'm1', title: 'Night Drive', description: 'free track', price: 0, type: 'music', listenOnly: true, mediaType: 'audio', streamUrl: '/api/media/m1/stream', tags: ['lofi'] },
    { id: 's1', title: 'Mixing service', description: 'I mix', category: 'audio', price: 20, tier: 'standard', rating: 4.5, reviewCount: 2 },
    { id: 's2', title: 'Logo design', description: 'a logo', category: 'design', price: 50 },
  ];

  it('shows listings: free listen-only tracks play as previews, paid ones show price and a sign-in link in place of Buy', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, listings: ROWS } });
    render(<SignedOutMarketBrowse />);
    await waitFor(() => expect(screen.getByTestId('visitor-listing-m1')).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith('/api/marketplace/listings');
    const media = screen.getByTestId('visitor-listing-m1');
    expect(within(media).getByText('Free · listen only')).toBeTruthy();
    expect(media.querySelector('audio')!.getAttribute('src')).toBe('/api/media/m1/stream');
    expect(within(media).queryByText(/Sign in to buy/)).toBeNull();
    const svc = screen.getByTestId('visitor-listing-s1');
    expect(within(svc).getByText('20 CC')).toBeTruthy();
    const buy = within(svc).getByText(/Sign in to buy/).closest('a')!;
    expect(buy.getAttribute('href')).toBe(`/login?from=${encodeURIComponent('/lenses/music')}`);
    expect(screen.getByTestId('visitor-list-something').textContent).toMatch(/Sign in to list something/);
    expect(screen.queryByRole('button', { name: /buy|purchase|list/i })).toBeNull(); // there is nothing that can write
  });

  it('filters by category and search, and says so when nothing matches', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, listings: ROWS } });
    render(<SignedOutMarketBrowse />);
    await waitFor(() => expect(screen.getByTestId('visitor-listing-s1')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'design' } });
    expect(screen.queryByTestId('visitor-listing-s1')).toBeNull();
    expect(screen.getByTestId('visitor-listing-s2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search listings'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('visitor-market-empty').textContent).toMatch(/No listings match/);
  });

  it('empty marketplace and a failed load are honest', async () => {
    apiGet.mockResolvedValueOnce({ data: { ok: true, listings: [] } });
    render(<SignedOutMarketBrowse />);
    await waitFor(() => expect(screen.getByTestId('visitor-market-empty').textContent).toMatch(/Nothing is listed yet/));
    cleanup();
    apiGet.mockRejectedValueOnce(new Error('x'));
    render(<SignedOutMarketBrowse />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not load the listings/));
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
