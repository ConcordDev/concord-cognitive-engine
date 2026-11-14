/**
 * Sentinel NVD degraded-state retry (FIX-sentinel-004).
 *
 * The walk found the live NVD feed down with the panel serving the
 * cached fallback — the banner copy was good, but neither degraded
 * state (stale cache, hard error) offered any way to retry: the only
 * recovery was changing severity and back, or waiting out the query
 * staleTime. The ticket's expected state is "live feed available, or
 * clear degraded state with retry". These pins drive the real
 * SentinelCves against a mocked publicLookup (its only data path —
 * the freshness meta contract is reproduced faithfully: a WeakMap
 * keyed on the payload object, exactly like lib/public-lookup):
 * both banners carry a working Retry that re-issues the lookup and
 * clears the degraded state when NVD answers.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const META = new WeakMap<object, { stale: boolean; fetchedAt: number | null }>();
const publicLookupMock = vi.fn();
vi.mock('@/lib/public-lookup', () => ({
  publicLookup: (...a: unknown[]) => publicLookupMock(...a),
  carryLookupMeta: (from: unknown, to: object) => {
    const m = from && typeof from === 'object' ? META.get(from as object) : undefined;
    if (m) META.set(to, m);
    return to;
  },
  lookupMeta: (d: unknown) => (d && typeof d === 'object' ? META.get(d as object) : undefined),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { SentinelCves } from '@/components/sentinel/SentinelCves';

const CVE = {
  cve: {
    id: 'CVE-2026-0001',
    published: '2026-11-01T00:00:00.000Z',
    descriptions: [{ lang: 'en', value: 'A test vulnerability.' }],
    metrics: { cvssMetricV31: [{ cvssData: { baseScore: 9.8, baseSeverity: 'CRITICAL' } }] },
  },
};

function payload() { return { vulnerabilities: [CVE] }; }
function respondStale() {
  const p = payload();
  META.set(p, { stale: true, fetchedAt: Date.parse('2026-11-09T15:27:21Z') });
  publicLookupMock.mockResolvedValue(p);
}
function respondFresh() {
  const p = payload();
  META.set(p, { stale: false, fetchedAt: Date.now() });
  publicLookupMock.mockResolvedValue(p);
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
async function until(pred: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('until: timed out');
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

beforeEach(() => { publicLookupMock.mockReset(); });
afterEach(() => { cleanup(); });

describe('sentinel NVD retry (FIX-sentinel-004)', () => {
  it('the stale-cache banner offers a Retry that re-reads and clears when live answers', async () => {
    respondStale();
    wrap(<SentinelCves />);
    await until(() => screen.queryByText(/Showing cached NVD data/) != null);
    expect(screen.getByText('CVE-2026-0001')).toBeInTheDocument();

    respondFresh();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await until(() => screen.queryByText(/Showing cached NVD data/) == null);
    expect(publicLookupMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('CVE-2026-0001')).toBeInTheDocument();
  });

  it('the hard-error banner offers a Retry that recovers when live answers', async () => {
    publicLookupMock.mockRejectedValue(new Error('nvd unavailable'));
    wrap(<SentinelCves />);
    await until(() => screen.queryByText(/NVD is unavailable right now/) != null);

    respondFresh();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await until(() => screen.queryByText('CVE-2026-0001') != null);
    expect(screen.queryByText(/NVD is unavailable right now/)).toBeNull();
  });
});
