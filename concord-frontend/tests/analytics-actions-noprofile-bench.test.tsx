/**
 * /lenses/analytics — a profile-less account reaches the Actions bench
 * (Review 4 Addendum 7, finding F15).
 *
 * R7's no-profile terminal state was scoped, in its own text, to
 * "follower and creator analytics" / "profile-based stats" — but as an
 * early return it replaced the ENTIRE DeskPanel, including the Actions
 * view, whose bench (AnalyticsActionPanel) is profile-independent: no
 * profile props, no profile reads, actor taken from the session
 * server-side on every call. A13 could not close: no bench ever
 * rendered for a profile-less account.
 *
 * These tests pin the narrowed gate, coexisting with
 * analytics-no-profile-state.test.tsx by mode:
 *   ACTIONS, NO PROFILE — the bench renders; no terminal state.
 *   OVERVIEW, NO PROFILE — the terminal state still renders (the
 *     profile-based modes keep their honest empty state).
 *
 * Backend mocked at '@/lib/api/client' in the exact envelopes served;
 * the ActionPanel is mocked to a marker so the pin is about REACHING
 * the bench through the gate, not the bench's own internals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

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
  AnalyticsActionPanel: () => React.createElement('div', null, 'bench-marker'),
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

import { AnalyticsDeskPanel } from '@/components/analytics/AnalyticsDeskPanel';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  myDtus.mockResolvedValue({ data: { dtus: [], total: 0 } });
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/social/profile') {
      // The served shape for a fresh account: 200 + ok:false body.
      return Promise.resolve({ data: { ok: false, error: 'Profile not found' } });
    }
    return Promise.resolve({ data: {} });
  });
});

describe('DeskPanel F15 — the bench is not behind the profile gate', () => {
  it('a profile-less account reaches the bench in Actions mode', async () => {
    wrap(<AnalyticsDeskPanel mode="actions" />);
    await waitFor(() => expect(screen.getByText('bench-marker')).toBeTruthy());
    expect(screen.queryByText('No social profile yet')).toBeNull();
  });

  it('a profile-less account still gets the terminal state in a profile-based mode', async () => {
    wrap(<AnalyticsDeskPanel mode="overview" />);
    await waitFor(() => expect(screen.getByText('No social profile yet')).toBeTruthy());
    expect(screen.queryByText('bench-marker')).toBeNull();
  });
});
