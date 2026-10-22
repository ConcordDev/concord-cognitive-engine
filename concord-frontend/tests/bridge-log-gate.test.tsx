/**
 * /lenses/bridge — GET /api/bridge/log must not fire for a non-operator.
 *
 * projectBridgeLog (server/lib/log-access.js) refuses anyone who is not
 * owner, admin, founder, or sovereign. Organisms, debates, births, and
 * emergents are member catalogs. A member used to request the log on
 * every load; the 403 failed the shared batch, the console logged
 * ForbiddenError, and the page drew zeros plus "No bridge activity yet".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
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

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
  },
  lensRun: vi.fn(),
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({
    latestData: null,
    alerts: [],
    insights: [],
    isLive: false,
    lastUpdated: null,
  }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({
    children, cta, tabs, onTab,
  }: {
    children?: React.ReactNode;
    cta?: { label: string; onClick: () => void; disabled?: boolean };
    tabs?: { id: string; label: string }[];
    onTab?: (id: string) => void;
  }) => React.createElement(
    'div',
    null,
    cta ? React.createElement('button', { type: 'button', onClick: cta.onClick, disabled: cta.disabled }, cta.label) : null,
    (tabs || []).map((tab) => React.createElement(
      'button',
      { type: 'button', key: tab.id, onClick: () => onTab?.(tab.id) },
      tab.label,
    )),
    children,
  ),
}));

vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/bridge/ConcordLinkWalkers', () => ({ ConcordLinkWalkers: () => null }));

import BridgePage from '@/app/lenses/bridge/page';
import { canReadBridgeLog } from '@/components/bridge/useBridgeData';

const ORGANISM = {
  id: 'org-1',
  name: 'Moss Choir',
  size: 12,
  isOrganism: true,
  persona: { name: 'Moss' },
  awakenedAt: null,
  topTags: ['lichen'],
  lastUpdated: '2026-10-11T12:00:00.000Z',
};

const DEBATE = {
  id: 'deb-1',
  dtuId: 'dtu-1',
  challengerRole: 'critic',
  challenge: 'The claim overreaches.',
  transcript: [],
  verdict: 'modify',
  resolution: 'narrowed',
  at: '2026-10-11T12:00:00.000Z',
};

const EMERGENT = {
  role: 'critic',
  capabilities: { canQuery: true, canValidate: true, canDebate: true, canVote: true },
};

const LOG_ENTRY = {
  id: 'log-1',
  action: 'bridge.validation.result',
  at: '2026-10-11T12:00:00.000Z',
  dtuId: 'dtu-9',
};

function user(role: string, scopes?: string[]): AuthUser {
  return { id: 'u1', username: 'tester', email: 'tester@test.local', role, scopes };
}

function urls(): string[] {
  return apiGet.mock.calls.map((call) => String(call[0]));
}

function logUrls(): string[] {
  return urls().filter((url) => url.includes('/api/bridge/log'));
}

function ok(body: unknown) {
  return Promise.resolve({ data: body });
}

function catalogPayload(overrides: { organisms?: unknown; debates?: unknown; births?: unknown; emergents?: unknown } = {}) {
  return {
    organisms: overrides.organisms ?? [ORGANISM],
    debates: overrides.debates ?? [DEBATE],
    births: overrides.births ?? [],
    emergents: overrides.emergents ?? [EMERGENT],
  };
}

function installApi(opts: { log?: 'ok' | 'throw'; organisms?: 'ok' | 'throw'; catalogs?: ReturnType<typeof catalogPayload> } = {}) {
  const catalogs = opts.catalogs ?? catalogPayload();
  apiGet.mockImplementation((path: unknown) => {
    const url = String(path);
    if (url.includes('/api/bridge/log')) {
      if (opts.log === 'throw') return Promise.reject(Object.assign(new Error('forbidden'), { name: 'ForbiddenError' }));
      return ok({ ok: true, log: [LOG_ENTRY, { ...LOG_ENTRY, id: 'log-2', action: 'bridge.organism.birth' }] });
    }
    if (url.includes('/api/bridge/organisms')) {
      if (opts.organisms === 'throw') return Promise.reject(new Error('organisms down'));
      return ok({ ok: true, organisms: catalogs.organisms });
    }
    if (url.includes('/api/bridge/debates')) return ok({ ok: true, debates: catalogs.debates });
    if (url.includes('/api/bridge/births')) return ok({ ok: true, births: catalogs.births });
    if (url.includes('/api/bridge/emergents')) return ok({ ok: true, emergents: catalogs.emergents });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;

function bridgeConsoleNoise(): unknown[][] {
  return consoleError.mock.calls.filter((args) => {
    const text = args.map((part) => String(part)).join(' ');
    return /Bridge data load failed|ForbiddenError|\/api\/bridge\/log/.test(text);
  });
}

beforeEach(() => {
  authState.user = null;
  authState.isLoading = true;
  apiGet.mockReset();
  installApi();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe('bridge lens — skip the operator log until the role is allowed', () => {
  it('does not request the log while auth is still resolving', async () => {
    const view = render(<BridgePage />);
    await waitFor(() => expect(urls().some((url) => url.includes('/api/bridge/organisms'))).toBe(true));
    expect(logUrls()).toEqual([]);
    expect(view.queryByText(/No bridge activity yet/)).toBeNull();
    expect(view.getByTestId('bridge-stat-events').textContent).not.toBe('0');
    expect(bridgeConsoleNoise()).toEqual([]);
  });

  it('shows member catalog counts and an operator-only event state, and never requests the log', async () => {
    authState.isLoading = false;
    authState.user = user('member');
    const view = render(<BridgePage />);

    await waitFor(() => expect(view.getByTestId('bridge-stat-organisms').textContent).toBe('1'));
    expect(view.getByTestId('bridge-stat-debates').textContent).toBe('1');
    expect(view.getByTestId('bridge-stat-emergents').textContent).toBe('1');
    expect(view.getByTestId('bridge-stat-events').textContent).toBe('operator-only');
    expect(view.getByText('Bridge event log is operator-only')).toBeInTheDocument();
    expect(view.getByText(/Members cannot read this dump/)).toBeInTheDocument();
    expect(view.queryByText(/No bridge activity yet/)).toBeNull();
    expect(logUrls()).toEqual([]);
    expect(urls().some((url) => url.includes('/api/bridge/organisms'))).toBe(true);
    expect(urls().some((url) => url.includes('/api/bridge/debates'))).toBe(true);
    expect(urls().some((url) => url.includes('/api/bridge/births'))).toBe(true);
    expect(urls().some((url) => url.includes('/api/bridge/emergents'))).toBe(true);
    expect(bridgeConsoleNoise()).toEqual([]);

    const before = urls().length;
    fireEvent.click(view.getByRole('button', { name: 'Refresh bridge' }));
    await waitFor(() => expect(urls().length).toBeGreaterThan(before));
    expect(logUrls()).toEqual([]);
  });

  it('still withholds the log when a member carries admin scopes', async () => {
    authState.isLoading = false;
    authState.user = user('member', ['*', 'admin', 'operator', 'economy:admin']);
    const view = render(<BridgePage />);
    await waitFor(() => expect(view.getByText('Bridge event log is operator-only')).toBeInTheDocument());
    expect(logUrls()).toEqual([]);
    expect(canReadBridgeLog(authState.user)).toBe(false);
  });

  it('keeps the log unread for a role the server would still refuse', async () => {
    authState.isLoading = false;
    authState.user = user('operator');
    const view = render(<BridgePage />);
    await waitFor(() => expect(view.getByTestId('bridge-stat-events').textContent).toBe('operator-only'));
    expect(logUrls()).toEqual([]);
  });

  it('does not request the log when auth resolves from loading to a member', async () => {
    const view = render(<BridgePage />);
    await waitFor(() => expect(view.getByText('Event log not loaded yet')).toBeInTheDocument());
    expect(logUrls()).toEqual([]);

    authState.isLoading = false;
    authState.user = user('member');
    view.rerender(<BridgePage />);

    await waitFor(() => expect(view.getByText('Bridge event log is operator-only')).toBeInTheDocument());
    expect(view.getByTestId('bridge-stat-organisms').textContent).toBe('1');
    expect(view.getByTestId('bridge-stat-events').textContent).toBe('operator-only');
    expect(view.queryByText(/No bridge activity yet/)).toBeNull();
    expect(logUrls()).toEqual([]);
    expect(bridgeConsoleNoise()).toEqual([]);
  });

  it.each(['admin', 'owner', 'founder', 'sovereign'])('loads the log for server-allowed role %s', async (role) => {
    authState.isLoading = false;
    authState.user = user(role);
    const view = render(<BridgePage />);
    await waitFor(() => expect(logUrls()).toEqual(['/api/bridge/log?limit=50']));
    await waitFor(() => expect(view.getByText(/bridge → validation → result/)).toBeInTheDocument());
    expect(view.getByTestId('bridge-stat-events').textContent).toBe('2');
    expect(view.getByTestId('bridge-stat-organisms').textContent).toBe('1');
    expect(view.queryByText('Bridge event log is operator-only')).toBeNull();
    expect(view.queryByText(/No bridge activity yet/)).toBeNull();
    expect(canReadBridgeLog(authState.user)).toBe(true);
  });

  it('shows the log as unavailable when an operator read fails, without zeroing the catalogs', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    installApi({ log: 'throw' });
    const view = render(<BridgePage />);
    await waitFor(() => expect(view.getByText('Bridge event log unavailable')).toBeInTheDocument());
    expect(view.getByTestId('bridge-stat-events').textContent).toBe('unavailable');
    expect(view.getByTestId('bridge-stat-organisms').textContent).toBe('1');
    expect(view.getByTestId('bridge-stat-debates').textContent).toBe('1');
    expect(view.queryByText(/No bridge activity yet/)).toBeNull();
    expect(logUrls()).toEqual(['/api/bridge/log?limit=50']);
  });

  it('marks a failed member catalog unavailable and still skips the log', async () => {
    authState.isLoading = false;
    authState.user = user('member');
    installApi({ organisms: 'throw' });
    const view = render(<BridgePage />);
    await waitFor(() => expect(view.getByTestId('bridge-stat-organisms').textContent).toBe('unavailable'));
    expect(view.getByTestId('bridge-stat-debates').textContent).toBe('1');
    expect(view.getByTestId('bridge-stat-events').textContent).toBe('operator-only');
    expect(logUrls()).toEqual([]);

    fireEvent.click(view.getByRole('button', { name: 'Organisms' }));
    expect(view.getByText('Organisms unavailable')).toBeInTheDocument();
    expect(view.queryByText(/No organisms detected/)).toBeNull();
  });

  it('shows a real zero only after a member catalog succeeds empty', async () => {
    authState.isLoading = false;
    authState.user = user('member');
    installApi({ catalogs: catalogPayload({ organisms: [], debates: [], emergents: [] }) });
    const view = render(<BridgePage />);
    await waitFor(() => expect(view.getByTestId('bridge-stat-organisms').textContent).toBe('0'));
    expect(view.getByTestId('bridge-stat-debates').textContent).toBe('0');
    expect(view.getByTestId('bridge-stat-emergents').textContent).toBe('0');
    expect(view.getByTestId('bridge-stat-events').textContent).toBe('operator-only');
    expect(view.queryByText(/No bridge activity yet/)).toBeNull();
    expect(logUrls()).toEqual([]);
  });
});
