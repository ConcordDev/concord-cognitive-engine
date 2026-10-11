/**
 * A failed GET /api/sovereignty/status must not render as a real lock
 * reading (0%, 100% enforcement, Sovereignty Unlocked, below threshold).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const use70LockMock = vi.fn();
vi.mock('@/hooks/use70Lock', () => ({
  use70Lock: () => use70LockMock(),
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
  apiHelpers: {
    sovereignty: { audit: vi.fn(() => Promise.resolve({ data: { ok: true } })) },
  },
  exportSubstrate: vi.fn(),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(() => Promise.resolve()),
  }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'member' } }) }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/ConnectiveTissueBar', () => ({ ConnectiveTissueBar: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

import LockLensPage from '@/app/lenses/lock/page';
import { SovereigntyDashboard } from '@/components/sovereignty/SovereigntyDashboard';
import { api } from '@/lib/api/client';

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;

function failedHook() {
  return {
    lockPercentage: 0,
    invariants: [],
    lastAudit: undefined,
    isHealthy: true,
    recentEnforcement: [],
    enforcementStats: undefined,
    isLocked: false,
    lockColor: 'sovereignty-danger',
    invariantSummary: { enforced: 0, warning: 0, violated: 0 },
    isLoading: false,
    error: Object.assign(new Error('Request failed with status code 403'), {
      response: { status: 403, data: { error: 'sovereign_only' } },
    }),
    refetchStatus: vi.fn(),
    runAudit: vi.fn(),
    isAuditing: false,
  };
}

describe('Lock lens failed status read', () => {
  beforeEach(() => {
    use70LockMock.mockReset();
    mockedGet.mockReset();
  });

  it('shows an unavailable state instead of 0% / 100% enforcement / Unlocked', () => {
    use70LockMock.mockReturnValue(failedHook());
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(LockLensPage),
      ),
    );

    expect(screen.getByTestId('sovereignty-status-unavailable')).toBeTruthy();
    expect(screen.getByText(/Sovereignty status is unavailable/)).toBeTruthy();
    expect(screen.queryByText('Sovereignty Unlocked')).toBeNull();
    expect(screen.queryByText('WARNING: Below Threshold')).toBeNull();
    expect(screen.queryByText(/Action required/)).toBeNull();
    expect(screen.queryByText('Enforcement Rate')).toBeNull();
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('SovereigntyDashboard does not paint empty counts when the read fails', async () => {
    mockedGet.mockRejectedValue(new Error('Request failed with status code 403'));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(SovereigntyDashboard),
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId('sovereignty-dashboard-unavailable')).toBeTruthy();
    });
    expect(screen.getByText(/Sovereignty status is unavailable/)).toBeTruthy();
    expect(screen.queryByText('Loading sovereignty status...')).toBeNull();
    expect(screen.queryByText('Personal DTUs')).toBeNull();
    expect(screen.queryByText('% sovereign')).toBeNull();
  });
});
