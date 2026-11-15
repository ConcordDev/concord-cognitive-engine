/**
 * RESIDUE B7 — FIX-geology-004: the USGS 24h panel carried an unconditional
 * 'REAL data' badge — including over a failed fetch ('USGS unreachable
 * (fetch_failed)', 0 events). The badge now follows the fetch state:
 * a failed feed reads FEED UNAVAILABLE; REAL data is claimed only when
 * the feed actually answered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { post: (...args: unknown[]) => postMock(...args) } }));

import { UsgsQuakePanel } from '@/components/geology/UsgsQuakePanel';

beforeEach(() => { postMock.mockReset(); });

describe('FIX-geology-004 — the provenance badge follows the feed state', () => {
  it('failed fetch: FEED UNAVAILABLE, never REAL data', async () => {
    postMock.mockResolvedValue({ data: { ok: false, reason: 'fetch_failed' } });
    render(<UsgsQuakePanel />);
    await waitFor(() => expect(screen.getByText('FEED UNAVAILABLE')).toBeTruthy());
    expect(screen.queryByText('REAL data')).toBeNull();
    expect(screen.getByText(/USGS unreachable/)).toBeTruthy();
  });

  it('live fetch: REAL data with the events listed', async () => {
    postMock.mockResolvedValue({
      data: {
        ok: true,
        total: 1,
        fetchedAt: 1700000000,
        quakes: [{
          id: 'q1', magnitude: 5.1, place: 'Testville', timeMs: Date.now() - 60000,
          depthKm: 10, latitude: 1, longitude: 2, tsunami: false, url: 'https://example.com/q1',
        }],
      },
    });
    render(<UsgsQuakePanel />);
    await waitFor(() => expect(screen.getByText('REAL data')).toBeTruthy());
    expect(screen.queryByText('FEED UNAVAILABLE')).toBeNull();
    expect(screen.getByText('Testville')).toBeTruthy();
  });
});
