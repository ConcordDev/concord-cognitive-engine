/**
 * /lenses/system — the lens must gate before its data hooks mount.
 *
 * The system domain is platform-internal (server/lib/platform-internal-
 * lens-gate.js): every system.* action 403s for a non-operator. A
 * signed-in member used to get sixteen telemetry tabs that each failed
 * with "Insufficient permissions", plus repeated gated polls. This pins
 * that a session still resolving /api/auth/me, and a viewer the server
 * would refuse, see the single lens-level gate and never mount the
 * inner page (so its cartograph / live-status hooks never fire), and
 * that an operator still gets the full lens.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: string;
  scopes?: string[];
}

const authState = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isLoading: true,
}));

const useSystemCartograph = vi.hoisted(() => vi.fn());
const useLiveStatus = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    isLoading: authState.isLoading,
    isAuthenticated: authState.user !== null,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/components/system/cartographShared', () => ({
  useSystemCartograph: (...args: unknown[]) => useSystemCartograph(...args),
}));
vi.mock('@/components/system/useLiveStatus', () => ({
  useLiveStatus: (...args: unknown[]) => useLiveStatus(...args),
}));
vi.mock('@/components/system/CartographPanels', () => ({
  OverviewPanel: () => null,
  HeartbeatsInventoryPanel: () => null,
  GapsPanel: () => null,
  CoveragePanel: () => null,
  DriftPanelView: () => null,
}));
vi.mock('@/components/system/ObservabilityTabPanels', () => ({
  MetricsTabPanel: () => null,
  AlertsTabPanel: () => null,
  LogsTabPanel: () => null,
  HbHealthTabPanel: () => null,
  TracesTabPanel: () => null,
  DashboardTabPanel: () => null,
  TrendTabPanel: () => null,
  HealthTabPanel: () => null,
  SubstrateTabPanel: () => null,
  AnalyticsTabPanel: () => null,
  PluginsTabPanel: () => null,
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'system-frame' }, children),
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));

import SystemLensPage from '@/app/lenses/system/page';

function user(role: string, scopes?: string[]): AuthUser {
  return { id: 'u1', username: 'tester', email: 'tester@test.local', role, scopes };
}

beforeEach(() => {
  authState.user = null;
  authState.isLoading = true;
  useSystemCartograph.mockReset();
  useSystemCartograph.mockImplementation(() => ({
    heartbeats: [],
    coveragePct: 0,
    data: null,
    handleRefresh: () => {},
    isFetching: false,
  }));
  useLiveStatus.mockReset();
  useLiveStatus.mockImplementation(() => ({
    live: true,
    setLive: () => {},
    status: null,
  }));
});

afterEach(() => {
  cleanup();
});

describe('system lens — gate before the data hooks mount', () => {
  it('mounts no data hooks while auth is still resolving', () => {
    const view = render(<SystemLensPage />);
    expect(view.getByRole('status').textContent).toMatch(/Checking access/i);
    expect(view.queryByText(/Admin access required/i)).toBeNull();
    expect(useSystemCartograph).not.toHaveBeenCalled();
    expect(useLiveStatus).not.toHaveBeenCalled();
  });

  it('shows the gate and mounts no data hooks for a non-operator', async () => {
    authState.isLoading = false;
    authState.user = user('member');
    const view = render(<SystemLensPage />);
    expect(await view.findByText(/Admin access required/i)).toBeInTheDocument();
    expect(view.queryByTestId('system-frame')).toBeNull();
    expect(useSystemCartograph).not.toHaveBeenCalled();
    expect(useLiveStatus).not.toHaveBeenCalled();
  });

  it('mounts the full lens for an operator role', async () => {
    authState.isLoading = false;
    authState.user = user('founder');
    const view = render(<SystemLensPage />);
    expect(await view.findByTestId('system-frame')).toBeInTheDocument();
    expect(view.queryByText(/Admin access required/i)).toBeNull();
    expect(useSystemCartograph).toHaveBeenCalled();
  });
});
