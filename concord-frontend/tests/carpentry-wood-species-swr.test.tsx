/**
 * Wood species stale-while-revalidate completion (FIX-carpentry-012).
 *
 * The species lookup rides the shared feed-cache, whose resolve() is
 * SWR by design (muse-b5's investigated disposition — the cache is
 * NOT changed): an expired entry is served stale once while a
 * background refresh runs. But WoodSpeciesReference held its own
 * copy and never re-read, so the refresh never reached the user —
 * the first lookup stranded them on the disclosed cached copy until
 * a manual retry. These pins drive the real panel against a mocked
 * public-lookup (freshness meta reproduced faithfully, WeakMap-keyed
 * like lib/public-lookup): a stale answer is replaced automatically
 * by the refreshed copy (exactly one re-read); a still-stale re-read
 * leaves the disclosed cached copy standing, with no retry loop.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const META = new WeakMap<object, { stale: boolean; fetchedAt: number | null }>();
const wikiSummaryMock = vi.fn();
vi.mock('@/lib/public-lookup', () => ({
  wikiSummary: (...a: unknown[]) => wikiSummaryMock(...a),
  lookupMeta: (d: unknown) => (d && typeof d === 'object' ? META.get(d as object) : undefined),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: async () => ({ data: { ok: true, result: { species: [] } } }),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { WoodSpeciesReference } from '@/components/carpentry/WoodSpeciesReference';

function summary(title: string, stale: boolean) {
  const s = { title, extract: `All about ${title}.`, description: 'tree species' };
  META.set(s, { stale, fetchedAt: stale ? Date.parse('2026-11-01T18:43:25Z') : Date.now() });
  return s;
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
async function until(pred: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('until: timed out');
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  }
}

beforeEach(() => { wikiSummaryMock.mockReset(); });
afterEach(() => { cleanup(); });

describe('wood species SWR completion (FIX-carpentry-012)', () => {
  it('a stale first lookup is automatically replaced by the refreshed copy', async () => {
    wikiSummaryMock
      .mockResolvedValueOnce(summary('Oak (cached)', true))
      .mockResolvedValue(summary('Oak', false));
    wrap(<WoodSpeciesReference />);
    fireEvent.click(screen.getByRole('button', { name: 'Oak' }));
    await until(() => document.body.textContent?.includes('Oak (cached)') ?? false);
    expect(screen.getByText(/cached copy/)).toBeInTheDocument();

    await until(() => !(document.body.textContent?.includes('Oak (cached)') ?? true) && screen.queryByText(/cached copy/) == null);
    expect(document.body.textContent).toContain('All about Oak.');
    // Exactly one automatic re-read — the initial lookup + 1.
    expect(wikiSummaryMock.mock.calls.length).toBe(2);
  });

  it('a still-stale re-read leaves the disclosed cached copy standing — no loop', async () => {
    wikiSummaryMock.mockResolvedValue(summary('Oak (cached)', true));
    wrap(<WoodSpeciesReference />);
    fireEvent.click(screen.getByRole('button', { name: 'Oak' }));
    await until(() => document.body.textContent?.includes('Oak (cached)') ?? false);
    // Give the single re-read time to fire and settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 1800)); });
    expect(wikiSummaryMock.mock.calls.length).toBe(2);
    expect(document.body.textContent).toContain('Oak (cached)');
    expect(screen.getByText(/cached copy/)).toBeInTheDocument();
  });
});
