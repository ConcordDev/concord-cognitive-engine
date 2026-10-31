/**
 * /lenses/analytics — a profile-less account reaches a terminal state
 * (Review 4 Addendum 5; remainder slice R7).
 *
 * A fresh account has no social profile (profiles are upsert-created,
 * never at signup). The own-profile read answers HTTP 200 with
 * { ok: false, error: "Profile not found" }, so DeskPanel's profile query
 * SUCCEEDS with profile = null and userId stays undefined. The panel's
 * old gate — `if (profileLoading || !userId)` → spinner — conflated
 * "still loading" with "loaded, no profile", and spun forever: Overview,
 * Revenue and Actions never rendered for a fresh account while Events /
 * Funnels / Advanced (other components) worked.
 *
 * These tests pin the split gate:
 *   NO PROFILE — the resolved-no-profile state renders its honest empty
 *     state (terminal), not a spinner.
 *   CONTROL    — an account WITH a profile renders the cards as before
 *     (the loading spinner resolves into content, no empty state).
 *
 * Backend mocked at '@/lib/api/client' in the exact envelopes served.
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

import { AnalyticsDeskPanel } from '@/components/analytics/AnalyticsDeskPanel';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  myDtus.mockResolvedValue({ data: { dtus: [], total: 0 } });
});

describe('DeskPanel profile states (R7)', () => {
  it('a profile-less account renders the terminal empty state, not a spinner', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/social/profile') {
        // The served shape for a fresh account: 200 + ok:false body.
        return Promise.resolve({ data: { ok: false, error: 'Profile not found' } });
      }
      return Promise.resolve({ data: {} });
    });
    wrap(<AnalyticsDeskPanel mode="overview" />);
    await waitFor(() => expect(screen.getByText('No social profile yet')).toBeTruthy());
    expect(screen.queryByText('Total DTUs')).toBeNull();
  });

  it('an account with a profile renders the cards (no empty state)', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/social/profile') {
        return Promise.resolve({
          data: { profile: { userId: 'u1', displayName: 'Tester', stats: { followers: 3, citations: 1 } } },
        });
      }
      if (path === '/api/social/analytics/creator') {
        return Promise.resolve({ data: { overview: { engagementRate: 0 }, totalPosts: 0 } });
      }
      if (path === '/api/economy/transactions') {
        return Promise.resolve({ data: { transactions: [], summary: { total: 0 } } });
      }
      if (path.startsWith('/api/social/followers/')) {
        return Promise.resolve({ data: { followers: [], total: 0 } });
      }
      return Promise.resolve({ data: {} });
    });
    wrap(<AnalyticsDeskPanel mode="overview" />);
    await waitFor(() => expect(screen.getByText('Total DTUs')).toBeTruthy());
    expect(screen.queryByText('No social profile yet')).toBeNull();
  });
});
