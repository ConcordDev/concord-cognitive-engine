/**
 * /lenses/analytics — first-paint honesty (Review 4 finding F7, slice S3).
 *
 * The desk gates its render on the profile query, but the four data queries
 * (DTUs, transactions, followers, creator analytics) start only after the
 * profile lands — and every derivation used to fall back to a numeric zero
 * while they were in flight, so the cards painted a false 0 (Total DTUs
 * painted 0 before resolving to the real count, confirmed on three loads in
 * the review) and the tabs painted their empty states during load.
 *
 * These tests pin the fixed behaviour with deferred-promise mocks that hold
 * the data queries in the exact F7 window (profile resolved, data pending):
 *   PENDING  — guarded cards render Platform's dash ('—'), never a number;
 *              blocks render a loading row, never their empty-state text.
 *   RESOLVED — real values paint, formatted as before.
 *   ZERO     — a RESOLVED zero paints as 0. The dash means "not known yet",
 *              never "zero" — the distinction F6/A20 honesty depends on.
 *
 * Backend channels are mocked at '@/lib/api/client' in the envelopes the
 * component consumes; nothing else about the server is fabricated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── backend channels ────────────────────────────────────────────────────────
const myDtus = vi.fn();
const apiGet = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a) },
  apiHelpers: { dtus: { myDtus: (...a: unknown[]) => myDtus(...a) } },
}));
vi.mock('@/components/social/CreatorAnalytics', () => ({
  CreatorAnalytics: () => null,
}));
vi.mock('@/components/analytics/AnalyticsActionPanel', () => ({
  AnalyticsActionPanel: () => null,
}));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) =>
      React.createElement('div', props, props.children as React.ReactNode),
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('recharts', () => {
  const stub = (props: Record<string, unknown>) =>
    React.createElement('div', null, props.children as React.ReactNode);
  return {
    BarChart: stub, Bar: stub, PieChart: stub, Pie: stub, Cell: stub,
    XAxis: stub, YAxis: stub, Tooltip: stub,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

import { AnalyticsDeskPanel } from '@/components/analytics/AnalyticsDeskPanel';

// ── deferred control over each data channel ─────────────────────────────────
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let dtusGate: ReturnType<typeof deferred>;
let txGate: ReturnType<typeof deferred>;
let followersGate: ReturnType<typeof deferred>;
let socialGate: ReturnType<typeof deferred>;

const PROFILE = {
  data: {
    profile: {
      userId: 'qa-user',
      displayName: 'QA',
      // Citations derive from the (gate-resolved) profile: a held value.
      stats: { citationCount: 7 },
    },
  },
};

function renderDesk(mode: 'overview' | 'revenue' | 'dtus') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyticsDeskPanel mode={mode} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  myDtus.mockReset();
  apiGet.mockReset();
  dtusGate = deferred();
  txGate = deferred();
  followersGate = deferred();
  socialGate = deferred();
  myDtus.mockImplementation(() => dtusGate.promise);
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/social/profile') return Promise.resolve(PROFILE);
    if (url === '/api/economy/transactions') return txGate.promise;
    if (url.startsWith('/api/social/followers/')) return followersGate.promise;
    if (url === '/api/social/analytics/creator') return socialGate.promise;
    return Promise.resolve({ data: {} });
  });
});

const DASH = '—';

describe('analytics first paint — pending window (F7)', () => {
  it('guarded cards dash while their queries are pending — no false 0', async () => {
    renderDesk('overview');
    // The profile gate resolves and the cards render; data queries hang.
    await waitFor(() => expect(screen.getByText('Total DTUs')).toBeTruthy());
    // Five guarded cards (DTUs, Followers, Total CC, Posts, Engagement) dash.
    expect(screen.getAllByText(DASH).length).toBe(5);
    // Citations holds a real profile value and paints it.
    expect(screen.getByText('7')).toBeTruthy();
    // No card paints a numeric zero it does not yet hold.
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('0.0%')).toBeNull();
  });

  it('DTUs tab shows a loading row while pending — not the empty state', async () => {
    renderDesk('dtus');
    await waitFor(() => expect(screen.getByText('Loading your DTUs…')).toBeTruthy());
    expect(screen.queryByText('No DTUs yet')).toBeNull();
    expect(screen.queryByText(/Showing 0 of 0/)).toBeNull();
  });

  it('revenue blocks load honestly — no 0 CC, no false empty states', async () => {
    renderDesk('revenue');
    await waitFor(() => expect(screen.getByText('Loading revenue…')).toBeTruthy());
    expect(screen.getByText('Loading transactions…')).toBeTruthy();
    expect(screen.getByText('Loading distribution…')).toBeTruthy();
    expect(screen.queryByText('No transaction data yet. Transaction history will appear here.')).toBeNull();
    expect(screen.queryByText(/No lens analytics data yet/)).toBeNull();
  });
});

describe('analytics first paint — resolution (F7)', () => {
  it('resolved values paint, formatted as before, with no dash left', async () => {
    renderDesk('overview');
    await waitFor(() => expect(screen.getByText('Total DTUs')).toBeTruthy());
    dtusGate.resolve({ data: { dtus: [], total: 23 } });
    txGate.resolve({ data: { transactions: [], summary: { royaltyTotal: 0, salesTotal: 12, total: 12 } } });
    followersGate.resolve({ data: { followers: [], count: 4 } });
    socialGate.resolve({ data: { totalPosts: 9, engagementRate: 2.5 } });
    await waitFor(() => expect(screen.getByText('23')).toBeTruthy());
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('2.5%')).toBeTruthy();
    expect(screen.queryByText(DASH)).toBeNull();
  });

  it('a resolved zero paints as 0 — the dash never means zero', async () => {
    renderDesk('overview');
    await waitFor(() => expect(screen.getByText('Total DTUs')).toBeTruthy());
    dtusGate.resolve({ data: { dtus: [], total: 0 } });
    txGate.resolve({ data: { transactions: [], summary: { royaltyTotal: 0, salesTotal: 0, total: 0 } } });
    followersGate.resolve({ data: { followers: [], count: 0 } });
    socialGate.resolve({ data: { totalPosts: 0, engagementRate: 0 } });
    // Total DTUs, Followers, Total CC and Posts all read a true 0.
    await waitFor(() => expect(screen.getAllByText('0').length).toBe(4));
    expect(screen.getByText('0.0%')).toBeTruthy();
    expect(screen.queryByText(DASH)).toBeNull();
  });

  it('resolved-empty DTUs tab keeps the honest "No DTUs yet" state', async () => {
    renderDesk('dtus');
    dtusGate.resolve({ data: { dtus: [], total: 0 } });
    txGate.resolve({ data: { transactions: [], summary: { royaltyTotal: 0, salesTotal: 0, total: 0 } } });
    followersGate.resolve({ data: { followers: [], count: 0 } });
    socialGate.resolve({ data: { totalPosts: 0, engagementRate: 0 } });
    await waitFor(() => expect(screen.getByText('No DTUs yet')).toBeTruthy());
    expect(screen.getByText(/Showing 0 of 0/)).toBeTruthy();
  });
});
