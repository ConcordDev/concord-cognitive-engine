/**
 * /lenses/analytics — DTUs tab drill-in (Review 4 finding F5, slice S1).
 *
 * The tab used to render a "Top Performing DTUs" slice(0,5) of a list the
 * panel had already fetched in full, with the ranking basis stated nowhere
 * and rows that did nothing on click. These tests pin the fixed behaviour:
 *   FULL LIST  — every DTU the endpoint returns renders as a row (a 23-item
 *                fixture, matching the review account's real count).
 *   BASIS      — the header states the ranking rule exactly as implemented
 *                (citations desc, newest first on ties, then title).
 *   DRILL-IN   — activating a row opens a detail carrying the DTU's real
 *                fields (id, citations, tier, lens, tags, rank derivation);
 *                a DTU with no lens recorded says so instead of inventing one.
 *   PAGING     — when the account total exceeds the fetched page, a
 *                "Show more" control fetches the next page size.
 *   EMPTY      — zero DTUs keeps the honest "No DTUs yet" state.
 *
 * Backend channel is mocked at '@/lib/api/client' in the exact envelope the
 * component consumes ({ data: { dtus, total } } from GET /api/dtus/mine);
 * no fabricated server behaviour beyond that contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── backend channels ────────────────────────────────────────────────────────
const myDtus = vi.fn();
const apiGet = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a) },
  apiHelpers: { dtus: { myDtus: (...a: unknown[]) => myDtus(...a) } },
}));

// Surfaces the desk mounts in other modes — inert here (dtus mode only).
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

// ── fixtures ────────────────────────────────────────────────────────────────
type DtuFixture = {
  id: string; title: string; citationCount: number; tier: string;
  tags: string[]; domain?: string; timestamp: string; summary?: string;
};

function makeDtu(i: number, overrides: Partial<DtuFixture> = {}): DtuFixture {
  return {
    id: `dtu_fixture_${String(i).padStart(2, '0')}`,
    title: `Fixture DTU ${String(i).padStart(2, '0')}`,
    // Deterministic spread so the ranking is known: DTU 01 cites most.
    citationCount: 24 - i,
    tier: i % 5 === 0 ? 'mega' : 'regular',
    tags: ['fixture'],
    timestamp: `2026-10-${String(10 + (i % 15)).padStart(2, '0')}T00:00:00.000Z`,
    ...overrides,
  };
}

const reviewFixture = makeDtu(1, {
  id: 'dtu_projects_fixture',
  title: 'PR4 PR4 Projects Review 2026-10-28',
  citationCount: 41,
  tags: ['projects', 'project'],
  domain: 'projects',
  summary: 'The Projects review fixture from the first pass.',
});

function accountDtus(): DtuFixture[] {
  const rest = Array.from({ length: 22 }, (_, k) => makeDtu(k + 2));
  // Deliberately unordered input: the panel's ranking must sort it.
  return [...rest.reverse(), reviewFixture];
}

function renderDesk() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyticsDeskPanel mode="dtus" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  myDtus.mockReset();
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/social/profile') {
      return Promise.resolve({
        data: { profile: { userId: 'qa-user', displayName: 'QA', stats: {} } },
      });
    }
    if (url === '/api/economy/transactions') {
      return Promise.resolve({
        data: { transactions: [], summary: { royaltyTotal: 0, salesTotal: 0, total: 0 } },
      });
    }
    if (url.startsWith('/api/social/followers/')) {
      return Promise.resolve({ data: { followers: [], count: 0 } });
    }
    return Promise.resolve({ data: {} });
  });
  myDtus.mockImplementation(() =>
    Promise.resolve({ data: { dtus: accountDtus(), total: 23 } }),
  );
});

describe('analytics DTUs tab — full list + stated basis (F5)', () => {
  it('renders every DTU the account owns, not a top-5 slice', async () => {
    renderDesk();
    await waitFor(() => expect(screen.getByText('Fixture DTU 23')).toBeTruthy());
    const rows = screen.getAllByRole('button', { name: /Fixture DTU|PR4 PR4 Projects/ });
    expect(rows.length).toBe(23);
    expect(screen.getByText(/Showing 23 of 23/)).toBeTruthy();
  });

  it('states the ranking basis in the header, exactly as implemented', async () => {
    renderDesk();
    await waitFor(() => expect(screen.getByText(/Ranked by citations/)).toBeTruthy());
    expect(screen.getByText(/ties go to the newest DTU/)).toBeTruthy();
  });

  it('ranks by citations: the highest-cited DTU is row 1', async () => {
    renderDesk();
    const first = await screen.findByRole('button', { name: /PR4 PR4 Projects Review/ });
    const rows = screen.getAllByRole('button', { name: /Fixture DTU|PR4 PR4 Projects/ });
    expect(rows[0]).toBe(first);
  });
});

describe('analytics DTUs tab — drill-in detail (F5)', () => {
  it('clicking the rank-#1 row opens a detail with its real fields', async () => {
    renderDesk();
    const row = await screen.findByRole('button', { name: /PR4 PR4 Projects Review/ });
    fireEvent.click(row);
    const detail = await screen.findByTestId('dtu-detail');
    expect(detail.textContent).toContain('dtu_projects_fixture');
    expect(detail.textContent).toContain('#1 of 23 by citations');
    expect(detail.textContent).toContain('projects'); // lens, from the payload's domain
    expect(detail.textContent).toContain('#projects');
    expect(detail.textContent).toContain('The Projects review fixture');
  });

  it('a DTU with no lens recorded says so in its detail — nothing invented', async () => {
    renderDesk();
    const row = await screen.findByRole('button', { name: /Fixture DTU 10/ });
    fireEvent.click(row);
    const detail = await screen.findByTestId('dtu-detail');
    expect(detail.textContent).toContain('Not recorded on this DTU');
  });

  it('clicking the open row again closes the detail', async () => {
    renderDesk();
    const row = await screen.findByRole('button', { name: /PR4 PR4 Projects Review/ });
    fireEvent.click(row);
    await screen.findByTestId('dtu-detail');
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByTestId('dtu-detail')).toBeNull());
  });
});

describe('analytics DTUs tab — paging + empty state (F5)', () => {
  it('offers Show more when the account total exceeds the fetched page', async () => {
    const page = Array.from({ length: 100 }, (_, k) => makeDtu(k + 1));
    myDtus.mockImplementation(({ limit }: { limit: number }) =>
      Promise.resolve({
        data: { dtus: page.slice(0, limit), total: 150 },
      }),
    );
    renderDesk();
    const more = await screen.findByRole('button', { name: /Show more DTUs/ });
    fireEvent.click(more);
    await waitFor(() =>
      expect(myDtus).toHaveBeenCalledWith({ limit: 200, offset: 0 }),
    );
  });

  it('zero DTUs keeps the honest empty state and renders no rows', async () => {
    myDtus.mockImplementation(() =>
      Promise.resolve({ data: { dtus: [], total: 0 } }),
    );
    renderDesk();
    await waitFor(() => expect(screen.getByText('No DTUs yet')).toBeTruthy());
    expect(screen.queryByTestId('dtu-detail')).toBeNull();
  });
});
