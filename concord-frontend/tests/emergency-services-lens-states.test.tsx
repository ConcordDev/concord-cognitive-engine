import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
const persist = vi.fn();
const restore = vi.fn(() => null);

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore, persist }),
}));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ramaj' } }) }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div data-testid="lens-shell">{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/emergency-services/CADConsole', () => ({ CADConsole: () => <div data-testid="cad-console" /> }));
vi.mock('@/components/emergency-services/AgencyMutualAidPanel', () => ({ AgencyMutualAidPanel: () => <div data-testid="agency-panel" /> }));
vi.mock('@/components/emergency-services/EmergencyServicesActionPanel', () => ({ EmergencyServicesActionPanel: () => <div data-testid="field-panel" /> }));
vi.mock('@/components/emergency-services/QuakeFeed', () => ({ QuakeFeed: () => <div data-testid="quake-feed" /> }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>,
  }),
}));

import EmergencyServicesLensPage from '@/app/lenses/emergency-services/page';

const EMPTY_DASHBOARD = {
  incidents: 0,
  openIncidents: 0,
  units: 0,
  availableUnits: 0,
  byKind: {},
};
const ACTIVE_DASHBOARD = {
  incidents: 3,
  openIncidents: 1,
  units: 4,
  availableUnits: 2,
  byKind: { fire: 1, medical: 2 },
};

function response(result = EMPTY_DASHBOARD, ok = true, error?: string) {
  return Promise.resolve({ data: { ok, result, error } });
}

beforeEach(() => {
  lensRun.mockReset();
  persist.mockReset();
  restore.mockReset();
  restore.mockReturnValue(null);
});

describe('Emergency Services north-star workspace', () => {
  it('loads the real CAD summary and renders the concept empty board', async () => {
    lensRun.mockReturnValue(response());
    const { getByText } = render(<EmergencyServicesLensPage />);

    expect(getByText('The call, Ramaj')).toBeInTheDocument();
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('emergency-services', 'ems-dashboard', {}));
    expect(getByText('No call on the board.')).toBeInTheDocument();
    expect(getByText('Open the board')).toBeInTheDocument();
  });

  it('shows loading and a retryable board error instead of an empty success state', async () => {
    let fail = true;
    lensRun.mockImplementation(() => fail
      ? response(EMPTY_DASHBOARD, false, 'CAD store offline')
      : response());
    const { container, getByText } = render(<EmergencyServicesLensPage />);

    expect(container.querySelector('[role="status"]')).toBeTruthy();
    await waitFor(() => expect(getByText('CAD store offline')).toBeInTheDocument());
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(() => getByText('No call on the board.')).toThrow();

    fail = false;
    fireEvent.click(getByText('Retry'));
    await waitFor(() => expect(getByText('No call on the board.')).toBeInTheDocument());
  });

  it('opens the call board from the one primary action and persists presentation state', async () => {
    lensRun.mockReturnValue(response());
    const { getByText, getByTestId } = render(<EmergencyServicesLensPage />);
    await waitFor(() => expect(getByText('Open the board')).toBeInTheDocument());

    fireEvent.click(getByText('Open the board'));
    expect(getByTestId('cad-console')).toBeInTheDocument();
    expect(persist).toHaveBeenCalledWith({ tool: 'board', boardOpened: true });
  });

  it('opens immediately when the real backend reports an active call', async () => {
    lensRun.mockReturnValue(response(ACTIVE_DASHBOARD));
    const { getByTestId, getByText, queryByText } = render(<EmergencyServicesLensPage />);

    await waitFor(() => expect(getByTestId('cad-console')).toBeInTheDocument());
    expect(getByText('1 open · 2 available · 4 rostered')).toBeInTheDocument();
    expect(queryByText('No call on the board.')).toBeNull();
  });

  it('uses one board-tool navigation model for agency, field, and seismic work', async () => {
    restore.mockReturnValue({ boardOpened: true, tool: 'board' });
    lensRun.mockReturnValue(response());
    const { getByText, getByTestId } = render(<EmergencyServicesLensPage />);
    await waitFor(() => expect(getByTestId('cad-console')).toBeInTheDocument());

    fireEvent.click(getByText('Agency'));
    expect(getByTestId('agency-panel')).toBeInTheDocument();
    fireEvent.click(getByText('Field tools'));
    expect(getByTestId('field-panel')).toBeInTheDocument();
    fireEvent.click(getByText('Seismic'));
    expect(getByTestId('quake-feed')).toBeInTheDocument();
    expect(persist).toHaveBeenLastCalledWith({ tool: 'seismic', boardOpened: true });
  });
});
