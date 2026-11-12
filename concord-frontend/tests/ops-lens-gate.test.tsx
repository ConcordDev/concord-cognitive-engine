/**
 * /lenses/ops — operator reads must not fire for a non-operator.
 *
 * The ops domain and its substrate domains (attention_alloc,
 * repair_network, physical, explore) are platform-internal: every call
 * is role-gated on the dispatch path (server/lib/platform-internal-lens-
 * gate.js → requireRole("owner", "admin", "sovereign", "founder"), plus
 * requireRole's wildcard-scope "*" pass). A signed-in member used to get
 * the full operator chrome — incident console mounted, substrate tabs
 * listed, every action failing 403 — with the gate arriving only as a
 * side effect of the substrate reads failing. This pins that a session
 * still resolving /api/auth/me, and a viewer the server would refuse,
 * never issue the reads or mount the console, and that an allowed role
 * (or a wildcard scope) still loads them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { canViewPlatformInternalLens } from '@/components/lens/platform-internal-access';

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

const runDomain = vi.hoisted(() => vi.fn());

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
  // The macro-denial branch of the real predicate — the only shape
  // runGatedDomain throws. isForbidden itself is covered by the admin /
  // audit gate suites; this file's subject is the page gate.
  isForbidden: (x: unknown) =>
    !!x &&
    typeof x === 'object' &&
    (x as { ok?: unknown }).ok === false &&
    /insufficient permission|forbidden|403/i.test(String((x as { error?: unknown }).error ?? '')),
  apiHelpers: {
    lens: {
      runDomain: (...args: unknown[]) => runDomain(...args),
    },
  },
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => ({}), {
    getState: () => ({ addToast: () => {} }),
  }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'ops-frame' }, children),
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/ops/IncidentConsole', () => ({
  IncidentConsole: () => React.createElement('div', { 'data-testid': 'incident-console' }),
}));
vi.mock('@/components/ops/OpsActionPanel', () => ({ OpsActionPanel: () => null }));
vi.mock('@/components/ops/OpsRepos', () => ({ OpsRepos: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import OpsLensPage from '@/app/lenses/ops/page';

function user(role: string, scopes?: string[]): AuthUser {
  return { id: 'u1', username: 'tester', email: 'tester@test.local', role, scopes };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpsLensPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  authState.user = null;
  authState.isLoading = true;
  runDomain.mockReset();
  runDomain.mockImplementation(async () => ({
    data: { result: { allocations: { ops: 1 }, explorations: [], types: [] } },
  }));
});

afterEach(() => {
  cleanup();
});

describe('canViewPlatformInternalLens — mirrors requireRole on the dispatch gate', () => {
  it('admits the platform-internal roles', () => {
    for (const role of ['owner', 'admin', 'sovereign', 'founder']) {
      expect(canViewPlatformInternalLens({ role })).toBe(true);
    }
  });

  it('refuses a plain member and a role named operator', () => {
    expect(canViewPlatformInternalLens({ role: 'member' })).toBe(false);
    expect(canViewPlatformInternalLens({ role: 'operator' })).toBe(false);
    expect(canViewPlatformInternalLens(null)).toBe(false);
    expect(canViewPlatformInternalLens(undefined)).toBe(false);
  });

  it('passes a wildcard scope but not a narrow one', () => {
    expect(canViewPlatformInternalLens({ role: 'member', scopes: ['*'] })).toBe(true);
    expect(canViewPlatformInternalLens({ role: 'member', scopes: ['admin'] })).toBe(false);
    expect(canViewPlatformInternalLens({ role: 'member', scopes: [] })).toBe(false);
  });
});

describe('ops lens — gate before chrome', () => {
  it('issues no substrate reads while auth is still resolving', async () => {
    const view = renderPage();
    expect(view.getByRole('status').textContent).toMatch(/Checking access/i);
    expect(view.queryByText(/Admin access required/i)).toBeNull();
    expect(view.queryByTestId('ops-frame')).toBeNull();
    await waitFor(() => expect(view.getByRole('status')).toBeInTheDocument());
    expect(runDomain).not.toHaveBeenCalled();
  });

  it('shows the gate and issues no reads or console for a non-operator', async () => {
    authState.isLoading = false;
    authState.user = user('member');
    const view = renderPage();
    expect(await view.findByText(/Admin access required/i)).toBeInTheDocument();
    expect(view.queryByTestId('ops-frame')).toBeNull();
    expect(view.queryByTestId('incident-console')).toBeNull();
    expect(runDomain).not.toHaveBeenCalled();
  });

  it('loads the substrate reads for an operator role', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    const view = renderPage();
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    expect(view.queryByText(/Admin access required/i)).toBeNull();
    const domains = runDomain.mock.calls.map((c) => c[0]);
    expect(domains).toContain('attention_alloc');
    expect(domains).toContain('repair_network');
    expect(domains).toContain('physical');
    expect(domains).toContain('explore');
  });

  it('loads for a wildcard-scope member, matching requireRole', async () => {
    authState.isLoading = false;
    authState.user = user('member', ['*']);
    const view = renderPage();
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    expect(view.queryByText(/Admin access required/i)).toBeNull();
  });
});
