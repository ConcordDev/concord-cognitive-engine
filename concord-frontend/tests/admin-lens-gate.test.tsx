/**
 * /lenses/admin — dashboard, metrics, and logs must not fire for a non-admin.
 *
 * GET /api/admin/dashboard, /api/admin/metrics, and /api/admin/logs?limit=20
 * run admin.{dashboard,metrics,logs}, which requireAdminRole allows only for
 * owner, admin, and founder (server.js). Scopes do not grant them. A signed-in
 * member used to render "Admin access required" only after those reads (and
 * the overview panel's copies of them) came back 403. This pins that a session
 * still resolving /api/auth/me, and a viewer the server would refuse, never
 * issue the reads, and that an allowed role still loads them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { canViewAdminLens } from '@/components/admin/admin-access';

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

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    isLoading: authState.isLoading,
    isAuthenticated: authState.user !== null,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return {
    isForbidden: actual.isForbidden,
    api: {
      get: (...args: unknown[]) => apiGet(...args),
      post: vi.fn(async () => ({ data: { ok: true } })),
    },
    apiHelpers: {
      admin: {
        dashboard: () => apiGet('/api/admin/dashboard'),
        metrics: () => apiGet('/api/admin/metrics'),
        logs: (params?: { limit?: number; type?: string }) => apiGet('/api/admin/logs', { params }),
      },
    },
  };
});

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({
    latestData: null,
    alerts: [],
    insights: [],
    isConnected: false,
    isLive: false,
    hasReceivedData: false,
    lastUpdated: null,
    clearAlerts: () => {},
  }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'admin-frame' }, children),
}));

vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/admin/MonitoringPanel', () => ({ MonitoringPanel: () => null }));
vi.mock('@/components/admin/LiveSystemHealth', () => ({ LiveSystemHealth: () => null }));
vi.mock('@/components/nervous/NervousSystem', () => ({ NervousSystem: () => null }));

import AdminLensPage from '@/app/lenses/admin/page';

const DASHBOARD = {
  ok: true,
  system: {
    version: '9.9.9-test',
    uptime: { seconds: 60, formatted: '0h 1m' },
    memory: { heapUsed: '12MB', heapTotal: '40MB', rss: '80MB' },
    nodeVersion: 'v22.0.0',
  },
  dtus: { total: 4, regular: 4, mega: 0, hyper: 0, shadow: 0 },
  sessions: { total: 1, active: 1 },
  organs: { total: 2, healthy: 2 },
  llm: { ollamaReady: true, ollamaEnabled: true, defaultOn: true },
  queues: { maintenance: 0, synthesis: 0, hypotheses: 0 },
  plugins: { total: 1, enabled: 1 },
  searchIndex: { documents: 3, terms: 9, dirty: false },
};

const METRICS = {
  ok: true,
  chicken2: {
    continuityAvg: 0.5,
    homeostasis: 0.8,
    contradictionLoad: 0.1,
    suffering: 0.05,
    accepts: 3,
    rejects: 1,
  },
  growth: { bioAge: 1.2, telomere: 0.9, homeostasis: 0.7, stress: { acute: 0.1, chronic: 0.2 } },
  abstraction: { load: 0.1, margin: 0.2, enabled: true },
};

const LOGS = {
  ok: true,
  logs: [{ type: 'boot', message: 'kernel up', at: '2026-10-11T12:00:00.000Z' }],
  count: 1,
};

const ADMIN_PATHS = ['/api/admin/dashboard', '/api/admin/metrics', '/api/admin/logs'] as const;

function user(role: string, scopes?: string[]): AuthUser {
  return { id: 'u1', username: 'tester', email: 'tester@test.local', role, scopes };
}

function adminCalls(): unknown[][] {
  return apiGet.mock.calls.filter((call) => String(call[0]).startsWith('/api/admin/'));
}

function adminPaths(): string[] {
  return adminCalls().map((call) => String(call[0])).sort();
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AdminLensPage />
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderPage() {
      view.rerender(
        <QueryClientProvider client={client}>
          <AdminLensPage />
        </QueryClientProvider>,
      );
    },
  };
}

function okPayload(url: string) {
  if (url === '/api/admin/dashboard') return { data: DASHBOARD };
  if (url === '/api/admin/metrics') return { data: METRICS };
  if (url === '/api/admin/logs') return { data: LOGS };
  return { data: { ok: true } };
}

beforeEach(() => {
  authState.user = null;
  authState.isLoading = true;
  apiGet.mockReset();
  apiGet.mockImplementation(async (url: string) => okPayload(String(url)));
});

afterEach(() => {
  cleanup();
});

describe('canViewAdminLens — requireAdminRole', () => {
  it('allows owner, admin, and founder, and ignores scopes', () => {
    expect(canViewAdminLens(null)).toBe(false);
    expect(canViewAdminLens({ role: 'admin' })).toBe(true);
    expect(canViewAdminLens({ role: 'owner' })).toBe(true);
    expect(canViewAdminLens({ role: 'founder' })).toBe(true);
    expect(canViewAdminLens({ role: 'member' })).toBe(false);
    expect(canViewAdminLens({ role: 'sovereign' })).toBe(false);
    expect(canViewAdminLens({ role: 'member', scopes: ['*', 'admin', 'economy:admin'] } as AuthUser)).toBe(false);
  });
});

describe('admin lens — skip admin reads until the server role matches', () => {
  it('does not issue admin reads while auth is still resolving', async () => {
    const view = mount();
    expect(view.getByRole('status').textContent).toMatch(/Checking access/i);
    expect(view.queryByText(/Admin access required/i)).toBeNull();
    expect(view.queryByTestId('admin-frame')).toBeNull();
    await waitFor(() => expect(view.getByRole('status')).toBeInTheDocument());
    expect(adminCalls()).toEqual([]);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('shows the access gate and issues no admin reads for a member', async () => {
    authState.isLoading = false;
    authState.user = user('member', ['read', 'write']);
    apiGet.mockImplementation(async () => {
      throw new Error('admin routes must not be requested');
    });
    const view = mount();
    expect(await view.findByText(/Admin access required/i)).toBeInTheDocument();
    expect(view.getByText(/needs one of: admin/i)).toBeInTheDocument();
    expect(view.queryByTestId('admin-frame')).toBeNull();
    expect(view.queryByText(/System health/i)).toBeNull();
    expect(view.queryByText(/Something went wrong/i)).toBeNull();
    await waitFor(() => expect(adminCalls()).toEqual([]));
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('still withholds the reads when a member carries an admin scope', async () => {
    authState.isLoading = false;
    authState.user = user('member', ['*', 'admin', 'economy:admin']);
    const view = mount();
    expect(await view.findByText(/Admin access required/i)).toBeInTheDocument();
    expect(adminCalls()).toEqual([]);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it.each(['user', 'operator', 'sovereign'])(
    'does not issue the reads for server-denied role %s',
    async (role) => {
      authState.isLoading = false;
      authState.user = user(role, ['admin']);
      const view = mount();
      expect(await view.findByText(/Admin access required/i)).toBeInTheDocument();
      expect(adminCalls(), role).toEqual([]);
    },
  );

  it('issues dashboard, metrics, and logs for an admin and renders them', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    const view = mount();
    expect(await view.findByTestId('admin-frame')).toBeInTheDocument();
    expect(view.queryByText(/Admin access required/i)).toBeNull();
    expect(await view.findByText(/9\.9\.9-test/)).toBeInTheDocument();
    expect(view.getByText('kernel up')).toBeInTheDocument();
    await waitFor(() => {
      expect(adminPaths()).toEqual([...ADMIN_PATHS].sort());
    });
    const logsCall = adminCalls().find((call) => call[0] === '/api/admin/logs');
    expect(logsCall?.[1]).toEqual({ params: { limit: 20 } });
    expect(view.queryByText(/Something went wrong/i)).toBeNull();
  });

  it.each(['owner', 'founder'])('issues the admin reads for server-allowed role %s', async (role) => {
    authState.isLoading = false;
    authState.user = user(role);
    const view = mount();
    expect(await view.findByText(/9\.9\.9-test/)).toBeInTheDocument();
    await waitFor(() => {
      expect(adminPaths()).toEqual([...ADMIN_PATHS].sort());
    });
  });

  it('starts the reads only after auth resolves to an admin', async () => {
    const view = mount();
    expect(view.getByRole('status').textContent).toMatch(/Checking access/i);
    expect(adminCalls()).toEqual([]);

    authState.isLoading = false;
    authState.user = user('admin');
    view.rerenderPage();
    expect(await view.findByText(/9\.9\.9-test/)).toBeInTheDocument();
    await waitFor(() => {
      expect(adminPaths()).toEqual([...ADMIN_PATHS].sort());
    });
  });

  it('shows an honest error when an allowed admin read fails, not an empty console', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    apiGet.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/admin/')) {
        throw new Error('admin dashboard unavailable');
      }
      return { data: { ok: true } };
    });
    const view = mount();
    expect(await view.findByRole('alert')).toHaveTextContent(/Something went wrong/i);
    expect(view.getByText(/admin dashboard unavailable/i)).toBeInTheDocument();
    expect(view.queryByText(/Admin access required/i)).toBeNull();
    expect(view.queryByText(/System health/i)).toBeNull();
    expect(view.queryByText(/9\.9\.9-test/)).toBeNull();
    expect(view.queryByText('kernel up')).toBeNull();
    await waitFor(() => {
      expect(adminPaths()).toEqual([...ADMIN_PATHS].sort());
    });
  });

  it('still shows the access gate when an allowed role is denied by the server', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    apiGet.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/admin/')) {
        const err = new Error('unauthorized: admin role required') as Error & { statusCode?: number };
        err.statusCode = 403;
        throw err;
      }
      return { data: { ok: true } };
    });
    const view = mount();
    expect(await view.findByText(/Admin access required/i)).toBeInTheDocument();
    expect(view.queryByText(/System health/i)).toBeNull();
    expect(view.queryByText(/9\.9\.9-test/)).toBeNull();
    await waitFor(() => {
      expect(adminPaths()).toEqual([...ADMIN_PATHS].sort());
    });
  });
});
