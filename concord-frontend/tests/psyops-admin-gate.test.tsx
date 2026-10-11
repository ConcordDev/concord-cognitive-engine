/**
 * /lenses/psyops — admin reads must not fire for a non-operator.
 *
 * A signed-in member used to mount the access gate only after six
 * POST /api/lens/run calls returned 403. Those calls are admin-only
 * (requireOperatorRole / _psyopsRequireOperatorRole: owner, admin, founder).
 * This pins that a non-operator, and a session still resolving /api/auth/me,
 * never issues them, and that an allowed role still does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
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

const lensRun = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    isLoading: authState.isLoading,
    isAuthenticated: authState.user !== null,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  isForbidden: (x: unknown) => {
    if (!x || typeof x !== 'object') return false;
    const o = x as { ok?: boolean; error?: unknown };
    return o.ok === false && typeof o.error === 'string' && /insufficient permission|forbidden|403/i.test(o.error);
  },
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'psyops-frame' }, title, children),
}));

vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/psyops/PsyopsReference', () => ({ PsyopsReference: () => null }));
vi.mock('@/components/psyops/DetectionRules', () => ({ DetectionRules: () => null }));
vi.mock('@/components/psyops/SignalScanner', () => ({ SignalScanner: () => null }));
vi.mock('@/components/psyops/AlertBoard', () => ({ AlertBoard: () => null }));
vi.mock('@/components/psyops/IncidentPanel', () => ({ IncidentPanel: () => null }));
vi.mock('@/components/psyops/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/psyops/QuarantineLog', () => ({ QuarantineLog: () => null }));

import PsyopsPage from '@/app/lenses/psyops/page';

const CONSOLE_MACROS = ['rules_list', 'alerts_list', 'incident_list', 'notifications_list', 'quarantine_log'] as const;

function user(role: string, scopes?: string[]): AuthUser {
  return { id: 'u1', username: 'tester', email: 'tester@test.local', role, scopes };
}

function lensCalls(): { domain: string; name: string; input: unknown }[] {
  return lensRun.mock.calls.map((call) => ({
    domain: String(call[0]),
    name: String(call[1]),
    input: call[2],
  }));
}

function psyopsLensCalls() {
  return lensCalls().filter((c) => c.domain === 'psyops');
}

function skillCalls(): { name: string; input: unknown }[] {
  return fetchMock.mock.calls.flatMap((call) => {
    const url = String(call[0] ?? '');
    if (!url.includes('/api/lens/run')) return [];
    const init = call[1] as RequestInit | undefined;
    let body: { domain?: string; name?: string; input?: unknown } = {};
    try { body = JSON.parse(String(init?.body ?? '{}')); } catch { return []; }
    if (body.domain !== 'psyops') return [];
    return [{ name: String(body.name), input: body.input }];
  });
}

const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ result: { ok: true, alerts: [] } }),
}));

function okPayload() {
  return Promise.resolve({
    data: {
      ok: true,
      result: {
        rules: [],
        alerts: [],
        counts: null,
        incidents: [],
        notifications: [],
        unacknowledged: 0,
        log: [],
      },
      error: null,
    },
  });
}

beforeEach(() => {
  authState.user = null;
  authState.isLoading = true;
  lensRun.mockReset();
  lensRun.mockImplementation(okPayload);
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('psyops lens — skip admin queries without an operator role', () => {
  it('does not issue psyops admin queries while auth is still resolving', async () => {
    const { getByRole, queryByText } = render(<PsyopsPage />);
    expect(getByRole('status').textContent).toMatch(/Checking access/i);
    expect(queryByText(/Admin access required/i)).toBeNull();
    await waitFor(() => expect(getByRole('status')).toBeInTheDocument());
    expect(psyopsLensCalls()).toEqual([]);
    expect(skillCalls()).toEqual([]);
  });

  it('shows the access gate and issues no psyops admin queries for a non-admin', async () => {
    authState.isLoading = false;
    authState.user = user('member');
    const { findByText, queryByTestId } = render(<PsyopsPage />);
    expect(await findByText(/Admin access required/i)).toBeInTheDocument();
    expect(await findByText(/admin, operator/i)).toBeInTheDocument();
    expect(queryByTestId('psyops-frame')).toBeNull();
    await waitFor(() => expect(psyopsLensCalls()).toEqual([]));
    expect(skillCalls()).toEqual([]);
    expect(lensRun).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still withholds the admin queries when a member carries an admin scope', async () => {
    authState.isLoading = false;
    authState.user = user('member', ['admin', 'operator']);
    const { findByText } = render(<PsyopsPage />);
    expect(await findByText(/Admin access required/i)).toBeInTheDocument();
    expect(psyopsLensCalls()).toEqual([]);
    expect(skillCalls()).toEqual([]);
  });

  it('issues the six admin reads for an admin and renders the console', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    const { findByTestId, queryByText } = render(<PsyopsPage />);
    expect(await findByTestId('psyops-frame')).toBeInTheDocument();
    expect(queryByText(/Admin access required/i)).toBeNull();
    await waitFor(() => {
      const names = psyopsLensCalls().map((c) => c.name).sort();
      expect(names).toEqual([...CONSOLE_MACROS].sort());
    });
    const byName = Object.fromEntries(psyopsLensCalls().map((c) => [c.name, c.input]));
    expect(byName.alerts_list).toEqual({ limit: 200 });
    expect(byName.rules_list).toEqual({});
    expect(byName.incident_list).toEqual({});
    expect(byName.notifications_list).toEqual({});
    expect(byName.quarantine_log).toEqual({});
    await waitFor(() => {
      expect(skillCalls()).toEqual([
        { name: 'list_alerts', input: { includeQuarantined: true } },
      ]);
    });
  });

  it.each(['owner', 'founder'])('issues the admin reads for server-allowed role %s', async (role) => {
    authState.isLoading = false;
    authState.user = user(role);
    render(<PsyopsPage />);
    await waitFor(() => {
      expect(psyopsLensCalls().map((c) => c.name).sort()).toEqual([...CONSOLE_MACROS].sort());
    });
    await waitFor(() => {
      expect(skillCalls().map((c) => c.name)).toEqual(['list_alerts']);
    });
  });

  it('does not issue the reads for a sovereign or operator role the server would deny', async () => {
    for (const role of ['sovereign', 'operator', 'user']) {
      cleanup();
      lensRun.mockClear();
      fetchMock.mockClear();
      authState.isLoading = false;
      authState.user = user(role);
      const { findByText } = render(<PsyopsPage />);
      expect(await findByText(/Admin access required/i)).toBeInTheDocument();
      expect(psyopsLensCalls(), role).toEqual([]);
      expect(skillCalls(), role).toEqual([]);
    }
  });

  it('starts the reads only after auth resolves to an admin', async () => {
    const { getByRole, rerender, findByTestId } = render(<PsyopsPage />);
    expect(getByRole('status').textContent).toMatch(/Checking access/i);
    expect(psyopsLensCalls()).toEqual([]);

    authState.isLoading = false;
    authState.user = user('admin');
    rerender(<PsyopsPage />);
    expect(await findByTestId('psyops-frame')).toBeInTheDocument();
    await waitFor(() => {
      expect(psyopsLensCalls().map((c) => c.name).sort()).toEqual([...CONSOLE_MACROS].sort());
    });
    await waitFor(() => expect(skillCalls().map((c) => c.name)).toEqual(['list_alerts']));
  });

  it('still shows the access gate when an allowed role is denied by the server', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    lensRun.mockImplementation(async () => ({
      data: { ok: false, result: null, error: 'Insufficient permissions: admin role required' },
    }));
    const { findByText } = render(<PsyopsPage />);
    expect(await findByText(/Admin access required/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(psyopsLensCalls().map((c) => c.name).sort()).toEqual([...CONSOLE_MACROS].sort());
    });
  });
});
