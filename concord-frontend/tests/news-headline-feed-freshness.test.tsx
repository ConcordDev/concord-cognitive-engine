// FIX-news-001 — the Live desk rendered a silent empty list while the lens
// badge said Live, even though the headlines action reports its own
// freshness (status / degradedReason / lastOkAt). Pins that HeadlineFeed
// surfaces it: an unavailable banner with the reason when the upstream is
// down, a cached banner when stale/degraded, and neither when fresh.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const runMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => runMock(...args),
}));

import { HeadlineFeed } from '@/components/news/HeadlineFeed';

const story = {
  id: 'h1', title: 'A real story', source: 'Example Wire', url: 'https://example.com/1',
  publishedAt: '2026-11-13T10:00:00Z', excerpt: 'Something happened.', category: 'top', sentiment: 'neutral' as const,
};

function respond(result: Record<string, unknown>) {
  runMock.mockResolvedValue({ data: { ok: true, result } });
}

beforeEach(() => { runMock.mockReset(); });

describe('HeadlineFeed freshness (FIX-news-001)', () => {
  it('names the outage when the feed is unavailable instead of a silent empty desk', async () => {
    respond({ headlines: [], status: 'unavailable', degraded: true, degradedReason: 'gdelt_upstream_error', reason: 'gdelt_upstream_error', lastOkAt: '2026-11-13T09:00:00Z', fetchedAt: null, stale: false });
    render(<HeadlineFeed />);
    const banner = await screen.findByText(/Live headlines are unavailable right now/);
    expect(banner.textContent).toContain('gdelt upstream error');
    expect(banner.textContent).toContain('Last successful pull');
    expect(await screen.findByText(/No headlines to show until the live feed answers again/)).toBeTruthy();
  });

  it('labels cached headlines when the feed is stale or degraded', async () => {
    respond({ headlines: [story], status: 'stale', stale: true, degraded: true, degradedReason: 'gdelt_upstream_error', fetchedAt: '2026-11-13T08:30:00Z' });
    render(<HeadlineFeed />);
    const banner = await screen.findByText(/Showing cached headlines/);
    expect(banner.textContent).toContain('live feed is degraded');
    expect(await screen.findByText('A real story')).toBeTruthy();
  });

  it('shows no banner when the feed is fresh', async () => {
    respond({ headlines: [story], status: 'fresh', stale: false, fetchedAt: '2026-11-13T10:05:00Z' });
    render(<HeadlineFeed />);
    expect(await screen.findByText('A real story')).toBeTruthy();
    expect(screen.queryByText(/Showing cached headlines|Live headlines are unavailable/)).toBeNull();
  });
});
