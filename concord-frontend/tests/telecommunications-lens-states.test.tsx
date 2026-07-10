/**
 * /lenses/telecommunications — real-backend contract for the Telecommunications lens.
 *
 * The lens previously ran a fabricated parallel CRUD system (useLensData /
 * useRunArtifact against 'Network'/'Tower'/'Spectrum'/'Subscriber'/'Outage'/
 * 'Fiber' artifact types with zero backing macro) alongside the real,
 * macro-backed RFPlanner + TelecommunicationsActionPanel components. That
 * fabricated system has been removed (see
 * docs/lens-specs/telecommunications-capability-map.md); this test pins the
 * honest replacement instead of the removed architecture:
 *   - the page's own overview stat strip is driven by REAL macro calls
 *     (telecommunications.towerList / spectrumList / outageList) via lensRun,
 *     not a generic artifact store;
 *   - a failed fetch surfaces an honest role=alert, not a silently-empty page;
 *   - the real workbenches (RFPlanner / TelecommunicationsActionPanel /
 *     TelcoRepos) are mounted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  isForbidden: () => false,
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/LensPageShell', () => ({
  LensPageShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-page-shell' }, children),
}));
const lensCommandSpy = vi.fn();
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (...args: unknown[]) => lensCommandSpy(...args),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: vi.fn() }),
  RecallSlot: () => null,
}));
vi.mock('@/components/telecommunications/TelcoRepos', () => ({ TelcoRepos: () => React.createElement('div', { 'data-testid': 'telco-repos' }) }));
vi.mock('@/components/telecommunications/RFPlanner', () => ({
  RFPlanner: () => React.createElement('div', { 'data-testid': 'rf-planner' }),
  RF_PLANNER_TABS: [
    { key: 'sites', label: 'Sites' },
    { key: 'propagation', label: 'RF Coverage' },
    { key: 'interference', label: 'Interference' },
    { key: 'capacity', label: 'Capacity Plan' },
    { key: 'topology', label: 'Topology' },
    { key: 'spectrum', label: 'Spectrum' },
    { key: 'outages', label: 'Outages / SLA' },
    { key: 'drivetest', label: 'Drive Test' },
  ],
}));
vi.mock('@/components/telecommunications/TelecommunicationsActionPanel', () => ({
  TelecommunicationsActionPanel: () => React.createElement('div', { 'data-testid': 'telecom-action-panel' }),
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

import TelecommunicationsLensPage from '@/app/lenses/telecommunications/page';

beforeEach(() => {
  lensRunMock.mockReset();
  lensCommandSpy.mockClear();
});

describe('telecommunications lens — real-backend overview contract', () => {
  it('WIRING: overview stats are pulled via real telecommunications.* macros (towerList/spectrumList/outageList)', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      expect(domain).toBe('telecommunications');
      if (action === 'towerList') return Promise.resolve({ data: { ok: true, result: { towers: [{ status: 'active' }, { status: 'planned' }] } } });
      if (action === 'spectrumList') return Promise.resolve({ data: { ok: true, result: { allocations: [{ widthMhz: 20 }, { widthMhz: 40 }] } } });
      if (action === 'outageList') return Promise.resolve({ data: { ok: true, result: { outages: [{ status: 'open' }] } } });
      return Promise.resolve({ data: { ok: false, result: null, error: 'unknown action' } });
    });

    render(<TelecommunicationsLensPage />);

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('telecommunications', 'towerList', {});
      expect(lensRunMock).toHaveBeenCalledWith('telecommunications', 'spectrumList', {});
      expect(lensRunMock).toHaveBeenCalledWith('telecommunications', 'outageList', {});
    });
    // 2 towers, 60 MHz allocated, 1 open outage — rendered from the real result shapes.
    await waitFor(() => expect(document.body.textContent).toMatch(/60/));
    expect(document.body.textContent).toMatch(/MHz allocated/i);
  });

  it('ERROR: a failed overview fetch surfaces role=alert instead of silently staying blank', async () => {
    lensRunMock.mockRejectedValue(new Error('telecom store offline'));
    const { container, getByText } = render(<TelecommunicationsLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/telecom store offline/i)).toBeInTheDocument();
  });

  it('MOUNT: the real workbenches (RFPlanner / TelecommunicationsActionPanel / TelcoRepos) are mounted, not a fabricated CRUD list', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { towers: [], allocations: [], outages: [] } } });
    const { getByTestId } = render(<TelecommunicationsLensPage />);
    await waitFor(() => {
      expect(getByTestId('rf-planner')).toBeInTheDocument();
      expect(getByTestId('telecom-action-panel')).toBeInTheDocument();
      expect(getByTestId('telco-repos')).toBeInTheDocument();
    });
  });

  it('DISCOVERABLE SHORTCUTS: RF Planner tab-jump commands are registered under the telecommunications lens', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { towers: [], allocations: [], outages: [] } } });
    render(<TelecommunicationsLensPage />);
    await waitFor(() => expect(lensCommandSpy).toHaveBeenCalled());
    const [commands, options] = lensCommandSpy.mock.calls[0];
    expect(options).toEqual({ lensId: 'telecommunications' });
    expect(commands.length).toBe(8);
    expect(commands[0]).toMatchObject({ keys: '1', description: expect.stringContaining('Sites') });
  });
});
