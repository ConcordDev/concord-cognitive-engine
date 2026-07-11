/**
 * /lenses/automotive — dashboard "upcoming renewals" widget.
 *
 * Wave 4 gap-closure: `automotive.renewals-upcoming` (server/domains/automotive.js)
 * was a real macro with zero frontend callers. Pins that the automotive lens page
 * now calls it on mount and renders a dashboard-level widget from its real return
 * shape (`{ ok, result: { renewals, count, withinDays } }`, each renewal carrying
 * `daysRemaining`/`milesRemaining`/`status`/`vehicleName` from `decorateRenewal`),
 * and that the widget stays honestly hidden when there is nothing upcoming.
 *
 * lensRun is mocked at the `@/lib/api/client` boundary — no fabricated data, the
 * mock reply shape is exactly what the backend handler returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/automotive/GarageSection', () => ({ GarageSection: () => null }));
vi.mock('@/components/automotive/AdvancedToolsPanel', () => ({ AdvancedToolsPanel: () => null }));
vi.mock('@/components/automotive/VinDecoder', () => ({ VinDecoder: () => null }));
vi.mock('@/components/automotive/FuelRepairPanel', () => ({ FuelRepairPanel: () => null }));
vi.mock('@/components/automotive/VehicleHistory', () => ({ VehicleHistory: () => null }));
vi.mock('@/components/automotive/AutomotiveActionPanel', () => ({ AutomotiveActionPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import AutomotiveLensPage from '@/app/lenses/automotive/page';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const EMPTY_SUMMARY = {
  vehicleCount: 0, spend12moUsd: 0, fuelEntryCount: 0, serviceEntryCount: 0,
  overdueServices: 0, dueSoonServices: 0, scheduleCount: 0,
};

const RENEWAL_DUE_SOON = {
  id: 'ren_1', kind: 'insurance', title: 'Progressive policy', provider: 'Progressive',
  renewalDate: '2026-08-01', premium: 620, daysRemaining: 21, milesRemaining: null,
  status: 'due_soon', vehicleName: 'Daily driver',
};
const RENEWAL_EXPIRED = {
  id: 'ren_2', kind: 'registration', title: 'DMV registration', provider: '',
  renewalDate: '2026-06-01', premium: null, daysRemaining: -40, milesRemaining: null,
  status: 'expired', vehicleName: 'Weekend car',
};

beforeEach(() => { lensRun.mockReset(); });

describe('automotive lens — dashboard upcoming-renewals widget (renewals-upcoming)', () => {
  it('calls automotive.renewals-upcoming on mount', async () => {
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'automotive-dashboard-summary') return reply(EMPTY_SUMMARY);
      if (name === 'renewals-upcoming') return reply({ renewals: [], count: 0, withinDays: 60 });
      return reply({});
    });
    render(<AutomotiveLensPage />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('automotive', 'renewals-upcoming', { withinDays: 60 }));
  });

  it('renders real renewals from the macro response, tagged with status + days remaining', async () => {
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'automotive-dashboard-summary') return reply(EMPTY_SUMMARY);
      if (name === 'renewals-upcoming') return reply({ renewals: [RENEWAL_DUE_SOON, RENEWAL_EXPIRED], count: 2, withinDays: 60 });
      return reply({});
    });
    const { getByText } = render(<AutomotiveLensPage />);

    await waitFor(() => expect(getByText('Upcoming renewals')).toBeInTheDocument());
    expect(getByText('Progressive policy')).toBeInTheDocument();
    expect(getByText('DMV registration')).toBeInTheDocument();
    // real derived fields from decorateRenewal, not fabricated
    expect(getByText('21d left')).toBeInTheDocument();
    expect(getByText('40d overdue')).toBeInTheDocument();
    expect(getByText(/Daily driver/)).toBeInTheDocument();
    expect(getByText(/\$620/)).toBeInTheDocument();
  });

  it('stays honestly hidden when there is nothing upcoming (no fabricated empty-state noise)', async () => {
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'automotive-dashboard-summary') return reply(EMPTY_SUMMARY);
      if (name === 'renewals-upcoming') return reply({ renewals: [], count: 0, withinDays: 60 });
      return reply({});
    });
    const { queryByText } = render(<AutomotiveLensPage />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('automotive', 'renewals-upcoming', { withinDays: 60 }));
    expect(queryByText('Upcoming renewals')).toBeNull();
  });
});
