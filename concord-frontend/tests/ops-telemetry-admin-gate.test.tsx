/**
 * /lenses/ops-telemetry — admin reads must not fire for a non-operator.
 *
 * A signed-in member used to mount the dashboard immediately. The first
 * paint fetches GET /api/admin/liveness and GET /api/runtime/constellation
 * (child panels) and GET /api/admin/heartbeat-stats (the console probe;
 * a second mount/effect run issued it again). Each 403s for a non-operator.
 * /api/runtime/constellation is admin-only: the same
 * requireRole("owner", "admin", "sovereign", "founder") as the /api/admin/*
 * telemetry routes, plus requireRole's wildcard-scope ("*") pass.
 *
 * This pins that a non-operator, and a session still resolving /api/auth/me,
 * never issues those reads, and that an allowed role still does.
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
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({}) }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'ops-telemetry-frame' }, title, children),
}));

vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));

import OpsTelemetryPage from '@/app/lenses/ops-telemetry/page';

const BLOCKED = [
  '/api/admin/heartbeat-stats',
  '/api/admin/liveness',
  '/api/runtime/constellation',
] as const;

function user(role: string, scopes?: string[]): AuthUser {
  return { id: 'u1', username: 'tester', email: 'tester@test.local', role, scopes };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/api/admin/heartbeat-stats')) {
    return jsonResponse({ ok: true, modules: [] });
  }
  if (url.includes('/api/admin/liveness')) {
    return jsonResponse({ ok: true });
  }
  if (url.includes('/api/runtime/constellation')) {
    return jsonResponse({ ok: true, overall: 'HEALTHY', domains: {}, chain: [] });
  }
  // Other admin reads are not this test's subject. ok:false keeps the
  // console on its honest empty path instead of rendering a partial cost
  // payload (calls/tokens are required once ok is true).
  return jsonResponse({ ok: false });
});

function urls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0] ?? ''));
}

function hits(fragment: string): string[] {
  return urls().filter((url) => url.includes(fragment));
}

beforeEach(() => {
  authState.user = null;
  authState.isLoading = true;
  lensRun.mockReset();
  lensRun.mockImplementation(() => Promise.resolve({
    data: { ok: true, result: { ok: true }, error: null },
  }));
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ops-telemetry lens — skip admin queries without an operator role', () => {
  it('does not issue admin telemetry queries while auth is still resolving', async () => {
    const { getByRole, queryByText, queryByTestId } = render(<OpsTelemetryPage />);
    expect(getByRole('status').textContent).toMatch(/Checking access/i);
    expect(queryByText(/Admin access required/i)).toBeNull();
    expect(queryByTestId('ops-telemetry-frame')).toBeNull();
    await waitFor(() => expect(getByRole('status')).toBeInTheDocument());
    expect(urls()).toEqual([]);
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('shows the access gate and issues no admin telemetry queries for a non-admin', async () => {
    authState.isLoading = false;
    authState.user = user('member');
    const { findByText, queryByTestId } = render(<OpsTelemetryPage />);
    expect(await findByText(/Admin access required/i)).toBeInTheDocument();
    expect(await findByText(/owner, admin, sovereign, founder/i)).toBeInTheDocument();
    expect(queryByTestId('ops-telemetry-frame')).toBeNull();
    await waitFor(() => expect(urls()).toEqual([]));
    for (const fragment of BLOCKED) expect(hits(fragment), fragment).toEqual([]);
    expect(urls().some((url) => url.includes('/api/admin/') || url.includes('/api/runtime/'))).toBe(false);
    expect(lensRun).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still withholds the admin queries when a member carries an admin scope', async () => {
    authState.isLoading = false;
    authState.user = user('member', ['admin', 'operator']);
    const { findByText } = render(<OpsTelemetryPage />);
    expect(await findByText(/Admin access required/i)).toBeInTheDocument();
    expect(urls()).toEqual([]);
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('does not issue the reads for a signed-out viewer or a role the server would deny', async () => {
    for (const role of ['user', 'operator', 'guest']) {
      cleanup();
      fetchMock.mockClear();
      lensRun.mockClear();
      authState.isLoading = false;
      authState.user = role === 'guest' ? null : user(role);
      const { findByText } = render(<OpsTelemetryPage />);
      expect(await findByText(/Admin access required/i)).toBeInTheDocument();
      expect(hits('/api/admin/heartbeat-stats'), role).toEqual([]);
      expect(hits('/api/admin/liveness'), role).toEqual([]);
      expect(hits('/api/runtime/constellation'), role).toEqual([]);
      expect(lensRun, role).not.toHaveBeenCalled();
    }
  });

  it('issues the admin reads for an admin and renders the console', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    const { findByTestId, queryByText } = render(<OpsTelemetryPage />);
    expect(await findByTestId('ops-telemetry-frame')).toBeInTheDocument();
    expect(queryByText(/Admin access required/i)).toBeNull();
    await waitFor(() => {
      expect(hits('/api/admin/heartbeat-stats').length).toBeGreaterThan(0);
      expect(hits('/api/admin/liveness').length).toBeGreaterThan(0);
      expect(hits('/api/runtime/constellation').length).toBeGreaterThan(0);
    });
  });

  it.each(['owner', 'founder', 'sovereign'])('issues the admin reads for server-allowed role %s', async (role) => {
    authState.isLoading = false;
    authState.user = user(role);
    render(<OpsTelemetryPage />);
    await waitFor(() => {
      expect(hits('/api/admin/heartbeat-stats').length, role).toBeGreaterThan(0);
      expect(hits('/api/admin/liveness').length, role).toBeGreaterThan(0);
      expect(hits('/api/runtime/constellation').length, role).toBeGreaterThan(0);
    });
  });

  it('issues the admin reads for a wildcard scope, which requireRole admits', async () => {
    authState.isLoading = false;
    authState.user = user('member', ['*']);
    render(<OpsTelemetryPage />);
    await waitFor(() => {
      expect(hits('/api/admin/heartbeat-stats').length).toBeGreaterThan(0);
      expect(hits('/api/admin/liveness').length).toBeGreaterThan(0);
      expect(hits('/api/runtime/constellation').length).toBeGreaterThan(0);
    });
  });

  it('starts the reads only after auth resolves to an admin', async () => {
    const { getByRole, rerender, findByTestId } = render(<OpsTelemetryPage />);
    expect(getByRole('status').textContent).toMatch(/Checking access/i);
    expect(urls()).toEqual([]);

    authState.isLoading = false;
    authState.user = user('admin');
    rerender(<OpsTelemetryPage />);
    expect(await findByTestId('ops-telemetry-frame')).toBeInTheDocument();
    await waitFor(() => {
      expect(hits('/api/admin/heartbeat-stats').length).toBeGreaterThan(0);
      expect(hits('/api/admin/liveness').length).toBeGreaterThan(0);
      expect(hits('/api/runtime/constellation').length).toBeGreaterThan(0);
    });
  });

  it('still shows the access gate when an allowed role is denied by the server', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/heartbeat-stats')) return jsonResponse({ ok: false }, 403);
      if (url.includes('/api/admin/liveness')) return jsonResponse({ ok: true });
      if (url.includes('/api/runtime/constellation')) {
        return jsonResponse({ ok: true, overall: 'HEALTHY', domains: {}, chain: [] });
      }
      return jsonResponse({ ok: false });
    });
    const { findByText } = render(<OpsTelemetryPage />);
    expect(await findByText(/Admin access required/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(hits('/api/admin/heartbeat-stats').length).toBeGreaterThan(0);
    });
  });
});
