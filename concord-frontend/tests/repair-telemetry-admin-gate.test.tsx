/**
 * /lenses/repair-telemetry — admin reads must not fire for a non-operator.
 *
 * A signed-in member used to mount the dashboard immediately and POST
 * /api/lens/run for repair.escalations, repair.health_log {limit:150}, and
 * repair.memory. requireOperatorRole (server/domains/repair.js) refuses
 * every repair.* macro unless ctx.actor.role is admin, owner, sovereign,
 * or founder. makeCtx copies that role from req.user.role (GET /api/auth/me).
 * Scopes are not consulted. The refusal is { ok:false, error:"admin_only" }
 * on HTTP 400, which is not a 403, so the page used to paint
 * "Couldn't load repair telemetry" and log three console errors.
 *
 * This pins that a member, a session still resolving, and any role outside
 * that allow-list issue zero of those calls and see the access gate, and
 * that an allowed role still loads the telemetry.
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
    const o = x as { status?: number; statusCode?: number; error?: string };
    return o.status === 403 || o.statusCode === 403 || o.error === 'forbidden';
  },
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

import RepairTelemetryPage from '@/app/lenses/repair-telemetry/page';

const ADMIN_READS = ['escalations', 'health_log', 'memory'] as const;

function user(role: string, scopes?: string[]): AuthUser {
  return { id: 'u1', username: 'tester', email: 'tester@test.local', role, scopes };
}

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result, error: ok ? null : 'lens_failed' } });
}

const ENTRY = {
  id: 'h1',
  pathology: 'negative_balance',
  category: 'economy',
  disposition: 'healed',
  subject_id: 'wallet_7',
  checked_at: 100,
};
const STATS = { totalPatterns: 4, totalRepairs: 9, avgSuccessRate: 0.75, deprecatedFixes: 1 };

function wireAdminReads() {
  lensRun.mockImplementation((_domain: string, name: string) => {
    if (name === 'health_log') return reply({ ok: true, entries: [ENTRY] });
    if (name === 'escalations') return reply({ ok: true, escalations: [] });
    if (name === 'memory') return reply({ ok: true, stats: STATS });
    return reply({ ok: true });
  });
}

function adminReadNames(): string[] {
  return lensRun.mock.calls
    .filter((call) => call[0] === 'repair' && ADMIN_READS.includes(call[1] as typeof ADMIN_READS[number]))
    .map((call) => String(call[1]));
}

beforeEach(() => {
  authState.user = null;
  authState.isLoading = true;
  lensRun.mockReset();
  wireAdminReads();
});

afterEach(() => {
  cleanup();
});

describe('repair-telemetry lens — skip admin reads without an operator role', () => {
  it('does not issue the repair reads while auth is still resolving', async () => {
    const { getByRole, queryByText } = render(<RepairTelemetryPage />);
    expect(getByRole('status').textContent).toMatch(/Checking access/i);
    expect(queryByText(/Admin access required/i)).toBeNull();
    expect(queryByText(/Couldn't load repair telemetry/i)).toBeNull();
    await waitFor(() => expect(getByRole('status')).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('shows the access gate and issues zero repair reads for a member', async () => {
    authState.isLoading = false;
    authState.user = user('member');
    const { findByText, queryByText } = render(<RepairTelemetryPage />);
    expect(await findByText(/Admin access required/i)).toBeInTheDocument();
    expect(await findByText(/admin, owner, sovereign, founder/i)).toBeInTheDocument();
    expect(queryByText(/Couldn't load repair telemetry/i)).toBeNull();
    expect(queryByText(/All quiet/i)).toBeNull();
    await waitFor(() => expect(lensRun).not.toHaveBeenCalled());
    expect(adminReadNames()).toEqual([]);
  });

  it('still withholds the reads when a member carries an admin or wildcard scope', async () => {
    authState.isLoading = false;
    authState.user = user('member', ['*', 'admin', 'operator']);
    const { findByText } = render(<RepairTelemetryPage />);
    expect(await findByText(/Admin access required/i)).toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('does not issue the reads for a signed-out viewer or a role the server would deny', async () => {
    for (const role of ['user', 'operator', 'guest'] as const) {
      cleanup();
      lensRun.mockClear();
      authState.isLoading = false;
      authState.user = role === 'guest' ? null : user(role);
      const { findByText, queryByText } = render(<RepairTelemetryPage />);
      expect(await findByText(/Admin access required/i)).toBeInTheDocument();
      expect(queryByText(/Couldn't load repair telemetry/i)).toBeNull();
      expect(lensRun, role).not.toHaveBeenCalled();
    }
  });

  it('loads the telemetry for an admin and does not show the access gate', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    const { findByText, queryByText } = render(<RepairTelemetryPage />);
    expect(await findByText('negative_balance')).toBeInTheDocument();
    expect(queryByText(/Admin access required/i)).toBeNull();
    expect(queryByText(/Couldn't load repair telemetry/i)).toBeNull();
    expect(lensRun).toHaveBeenCalledWith('repair', 'health_log', { limit: 150 });
    expect(lensRun).toHaveBeenCalledWith('repair', 'escalations', {});
    expect(lensRun).toHaveBeenCalledWith('repair', 'memory', {});
  });

  it.each(['owner', 'founder', 'sovereign'])('loads the telemetry for server-allowed role %s', async (role) => {
    authState.isLoading = false;
    authState.user = user(role);
    const { findByText } = render(<RepairTelemetryPage />);
    expect(await findByText('negative_balance')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('repair', 'escalations', {});
    expect(lensRun).toHaveBeenCalledWith('repair', 'health_log', { limit: 150 });
    expect(lensRun).toHaveBeenCalledWith('repair', 'memory', {});
  });

  it('starts the reads only after auth resolves to an admin', async () => {
    const { getByRole, rerender, findByText } = render(<RepairTelemetryPage />);
    expect(getByRole('status').textContent).toMatch(/Checking access/i);
    expect(lensRun).not.toHaveBeenCalled();

    authState.isLoading = false;
    authState.user = user('admin');
    rerender(<RepairTelemetryPage />);
    expect(await findByText('negative_balance')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('repair', 'health_log', { limit: 150 });
    expect(lensRun).toHaveBeenCalledWith('repair', 'escalations', {});
    expect(lensRun).toHaveBeenCalledWith('repair', 'memory', {});
  });

  it('shows the access gate, not a generic failure, when the server returns admin_only', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    lensRun.mockImplementation(() => Promise.resolve({
      data: { ok: false, result: null, error: 'admin_only' },
    }));
    const { findByText, queryByText } = render(<RepairTelemetryPage />);
    expect(await findByText(/Admin access required/i)).toBeInTheDocument();
    expect(queryByText(/Couldn't load repair telemetry/i)).toBeNull();
    expect(queryByText(/All quiet/i)).toBeNull();
    await waitFor(() => {
      expect(lensRun.mock.calls.some((call) => call[1] === 'health_log')).toBe(true);
    });
  });
});
