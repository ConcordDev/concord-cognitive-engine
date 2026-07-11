/**
 * /lenses/world-creator/anomalies — resolve/dismiss error-handling contract
 * (Wave-3 audit fix).
 *
 * Before this fix, `resolve()` never inspected the response: a failed
 * resolve/dismiss (expired session, stale worldId, a race where someone
 * else already closed the anomaly, a genuine 403 from the server's
 * `worlds.created_by` ownership gate) was swallowed silently — the button
 * appeared to do nothing, with zero feedback. This pins the fixed
 * behavior: success refetches and the row disappears; failure surfaces the
 * server's `error` string via the page's existing `error` banner instead
 * of vanishing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: [], isLoading: false }),
  useCreateArtifact: () => ({ mutate: () => {} }),
}));

import AnomaliesPage from '@/app/lenses/world-creator/anomalies/page';

function jsonRes(body: Record<string, unknown>, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

const ANOMALY = {
  id: 'anom_1', detected_at: 1735689600, kind: 'negative_quantity',
  user_id: 'u1', item_id: 'item_sword', inventory_id: null, details_json: null, status: 'open',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('world-creator/anomalies — resolve/dismiss honesty', () => {
  it('a failed resolve (403 not_world_creator) surfaces the server error instead of silently doing nothing', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === '/api/anomalies/public') return jsonRes({ ok: true, byKind: [], recent7d: [] });
      if (url.includes('/world/world_a') && (!opts || opts.method === undefined)) return jsonRes({ ok: true, anomalies: [ANOMALY] });
      if (url.endsWith('/resolve')) return jsonRes({ ok: false, error: 'not_world_creator' }, false, 403);
      return jsonRes({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByPlaceholderText, getByText } = render(<AnomaliesPage />);
    fireEvent.change(getByPlaceholderText('World ID you own…'), { target: { value: 'world_a' } });
    fireEvent.click(getByText('Load'));
    await waitFor(() => expect(getByText('negative_quantity')).toBeInTheDocument());

    fireEvent.click(getByText('Resolve'));
    await waitFor(() => expect(getByText('not_world_creator')).toBeInTheDocument());
    // the row is still there — a failed resolve must not optimistically vanish
    expect(getByText('negative_quantity')).toBeInTheDocument();
  });

  it('a successful resolve refetches and the row disappears', async () => {
    let resolved = false;
    const fetchMock = vi.fn((url: string, _opts?: RequestInit) => {
      if (url === '/api/anomalies/public') return jsonRes({ ok: true, byKind: [], recent7d: [] });
      if (url.endsWith('/resolve')) { resolved = true; return jsonRes({ ok: true }); }
      if (url.includes('/world/world_a')) return jsonRes({ ok: true, anomalies: resolved ? [] : [ANOMALY] });
      return jsonRes({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByPlaceholderText, getByText, queryByText } = render(<AnomaliesPage />);
    fireEvent.change(getByPlaceholderText('World ID you own…'), { target: { value: 'world_a' } });
    fireEvent.click(getByText('Load'));
    await waitFor(() => expect(getByText('negative_quantity')).toBeInTheDocument());

    fireEvent.click(getByText('Resolve'));
    await waitFor(() => expect(queryByText('negative_quantity')).not.toBeInTheDocument());
    await waitFor(() => expect(getByText(/No open anomalies/i)).toBeInTheDocument());
  });
});
