// Audit fix sweep (PR #2356) — FIX-lattice-010: the lattice Overview
// showed platform-wide consent corpus counts with no scope label, so
// a regular user could read 562k rows as their own corpus. The
// endpoint is deliberately public aggregate (anonymized counts), so
// the surface now labels the scope in words: platform-wide, not
// yours, with a pointer to the Consent tab for the viewer's own.
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/components/lattice/latticeShared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/lattice/latticeShared')>();
  return {
    ...actual,
    fetchJSON: vi.fn((url: string) => {
      if (url === '/api/lattice/corpus/stats') {
        return Promise.resolve({
          ok: true,
          tables: [{ name: 'dtus', regime: 'consent', total: 562259, consented: 2868, ratio: 0.0051 }],
          totals: { total: 562259, consented: 2868, ratio: 0.0051 },
        });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    }),
  };
});
vi.mock('@/components/lens/KeepRecordActions', () => ({ KeepRecordActions: () => null }));
vi.mock('@/components/lattice/latticeKeep', () => ({ latticeKeptRecord: () => null }));

import { OverviewPanel } from '@/components/lattice/OverviewPanel';

describe('lattice overview — corpus scope is labelled', () => {
  it('states platform-wide scope beside the totals and per-table heading', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}><OverviewPanel /></QueryClientProvider>,
    );
    await waitFor(() => expect(view.container.textContent).toContain('562259'));
    expect(view.container.textContent).toContain('Platform-wide totals across every creator on this instance');
    expect(view.container.textContent).toContain('Total rows (platform-wide)');
    expect(view.container.textContent).toContain('Per-table consent (platform-wide)');
  });
});
