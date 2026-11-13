// FIX-global-009 — a failed Run's error outlived the action it belonged
// to: after the Indicator Catalog refused a 320-char query ('Input too
// long'), fixing the query and pressing Save view SUCCEEDED — share
// link issued, view listed — while the refusal stayed on screen,
// claiming failure beside the proof of success. saveCurrentView (and,
// same rule, deleteView and applyView) never cleared the error on
// success; only Run and mode switches did. Successful actions now
// clear the error they supersede.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TOO_LONG = 'Input too long: input.query: 320 chars (max 200)';
const lensRunMock = vi.fn(async (_domain: string, action: string, input: Record<string, unknown>) => {
  if (action === 'listViews') return { data: { ok: true, result: { views: [] } } };
  if (action === 'searchIndicators') {
    if (String(input.query || '').length > 200) return { data: { ok: false, error: TOO_LONG } };
    return { data: { ok: true, result: { query: String(input.query), totalMatches: 0, indicators: [], source: 'worldbank' } } };
  }
  if (action === 'saveView') return { data: { ok: true, result: { shareLink: '/share/abc' } } };
  return { data: { ok: true, result: {} } };
});
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...(a as [string, string, Record<string, unknown>])) }));
vi.mock('@/components/global/ChoroplethMap', () => ({ ChoroplethMap: () => null }));
vi.mock('@/components/global/IndicatorPicker', () => ({ IndicatorPicker: () => null }));
vi.mock('@/components/global/CountryPicker', () => ({ CountryPicker: () => null }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/components/common/StickyDeleteConfirm', () => ({ StickyDeleteConfirm: () => null }));

import { DataExplorer } from '@/components/global/DataExplorer';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DataExplorer />
    </QueryClientProvider>,
  );
}

describe('FIX-global-009 stale error clears on later success', () => {
  beforeEach(() => lensRunMock.mockClear());

  it('a successful Save view clears the refused Run’s error', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Indicator Catalog/ }));
    const input = screen.getByPlaceholderText(/e\.g\. carbon/);
    fireEvent.change(input, { target: { value: 'x'.repeat(320) } });
    fireEvent.click(screen.getByRole('button', { name: /Run query/ }));
    expect(await screen.findByText(TOO_LONG)).toBeTruthy();

    fireEvent.change(input, { target: { value: 'carbon' } });
    fireEvent.click(screen.getByRole('button', { name: /Save view/ }));
    expect(await screen.findByRole('button', { name: /Copy share link/ })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(TOO_LONG)).toBeNull());
  });
});
