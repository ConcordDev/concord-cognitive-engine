import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';

const ROI_RESULT = {
  campaign: 'Spring launch', spend: 1000, revenue: 3500, roi: 250, leads: 120,
  conversions: 18, costPerLead: 8.33, costPerAcquisition: 55.56,
  conversionRate: 15, profitable: true, grade: 'exceptional',
};

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(async () => ({ data: { ok: true } })), delete: vi.fn(async () => ({ data: { ok: true } })) },
  apiHelpers: {
    lens: {
      runDomain: vi.fn(async (_domain: string, action: string) => {
        if (action === 'campaignROI') return { data: { ok: true, result: { ok: true, result: ROI_RESULT } } };
        return { data: { ok: true, result: { ok: true, result: {} } } };
      }),
    },
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

import { MarketingActionPanel } from '@/components/marketing/MarketingActionPanel';
import { PipingProvider } from '@/components/panel-polish';

beforeEach(() => {
  vi.clearAllMocks();
});

async function runRoi() {
  fireEvent.change(screen.getByPlaceholderText('Campaign'), { target: { value: 'Spring launch' } });
  fireEvent.change(screen.getByPlaceholderText('Spend $'), { target: { value: '1000' } });
  fireEvent.change(screen.getByPlaceholderText('Revenue $'), { target: { value: '3500' } });
  fireEvent.click(screen.getByRole('button', { name: /campaignROI/ }));
  await waitFor(() => expect(screen.getByText('250%')).toBeTruthy(), { timeout: 5000 });
}

// FIX-marketing-015 — the Quick Analysis ROI card outlived its campaign:
// the output had no lifecycle at all (no dismiss, no invalidation). Now
// every result card can be cleared, and deleting (or renaming away) the
// campaign in the Campaigns panel clears the ROI card tied to its name.
describe('FIX-marketing-015 — analysis output lifecycle', () => {
  it('clears the ROI card when its campaign is removed, with a note saying why', async () => {
    render(<PipingProvider><MarketingActionPanel /></PipingProvider>);
    await runRoi();

    fireEvent(window, new CustomEvent('marketing:campaign-removed', { detail: { name: 'Spring launch' } }));
    await waitFor(() => expect(screen.queryByText('250%')).toBeNull());
    expect(screen.getByText(/Cleared the ROI analysis for “Spring launch”/)).toBeTruthy();
  });

  it('leaves the card alone when a DIFFERENT campaign is removed', async () => {
    render(<PipingProvider><MarketingActionPanel /></PipingProvider>);
    await runRoi();

    fireEvent(window, new CustomEvent('marketing:campaign-removed', { detail: { name: 'Other campaign' } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('250%')).toBeTruthy();
  });

  it('the card carries its own dismiss control', async () => {
    render(<PipingProvider><MarketingActionPanel /></PipingProvider>);
    await runRoi();

    fireEvent.click(screen.getByRole('button', { name: 'Clear ROI result' }));
    await waitFor(() => expect(screen.queryByText('250%')).toBeNull());
  });
});
