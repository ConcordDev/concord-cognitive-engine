/**
 * Work-destination north stars. Rows, totals, and charts come from the
 * mocked macro envelope. Nothing is painted as a number before that answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'ramaj', email: 'r@x', role: 'owner' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(), post: vi.fn() },
}));

import { FinanceBook } from '@/components/finance/FinanceBook';
import { AccountingStatement } from '@/components/accounting/AccountingStatement';
import { OpenChart } from '@/components/healthcare/OpenChart';
import { MatterFront } from '@/components/legal/MatterFront';
import { FlightList } from '@/components/projects/FlightList';
import { OneChart } from '@/components/analytics/OneChart';
import { ForSale } from '@/components/marketplace/ForSale';
import { JobOnBoard } from '@/components/trades/JobOnBoard';

function actionOf(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return String(args[1] || '');
  return String((first as { action?: string })?.action || '');
}

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function renderInShell(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeyboardProvider>{ui}</KeyboardProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('work family north stars', () => {
  it('finance keeps the book blank until the feed answers, then shows cash', async () => {
    const pending: Array<(value: unknown) => void> = [];
    lensRunMock.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    renderInShell(<FinanceBook onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'What you hold, Ramaj' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Markets' }).getAttribute('href')).toBe('/lenses/markets');
    expect(screen.getByRole('link', { name: 'Wallet' }).getAttribute('href')).toBe('/lenses/wallet');
    expect(screen.queryByText(/\$/)).toBeNull();

    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    const summary = ok({ breakdown: { cash: 12.5 }, positionCount: 1 });
    const holdings = ok({ holdings: [{ id: 'h1', symbol: 'AAPL', shares: 2, value: 40 }] });
    pending[0](actionOf(lensRunMock.mock.calls[0]) === 'holdings-list' ? holdings : summary);
    pending[1](actionOf(lensRunMock.mock.calls[1]) === 'holdings-list' ? holdings : summary);

    expect(await screen.findByText('$12.50')).toBeTruthy();
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.queryByText('FINANCE TERMINAL')).toBeNull();
  });

  it('accounting shows the statement the engine returned', async () => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      const action = actionOf(args);
      if (action === 'pl-compute') {
        return Promise.resolve(ok({
          period: { start: '2026-01-01', end: '2026-10-02' },
          revenue: { total: 100, lines: [] },
          operatingExpenses: { total: 60, lines: [] },
          netIncome: 40,
        }));
      }
      if (action === 'coa-list') return Promise.resolve(ok({ accounts: [{ id: 'a1', code: '1000', name: 'Cash' }, { id: 'a2', code: '4000', name: 'Revenue' }] }));
      if (action === 'je-post') return Promise.resolve(ok({ entry: { id: 'je1' } }));
      return Promise.resolve(ok({}));
    });
    renderInShell(<AccountingStatement onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'The books, Ramaj' })).toBeTruthy();
    expect(await screen.findByText('$40.00')).toBeTruthy();
    expect(screen.getByText('$100.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Entry' }));
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => actionOf(c) === 'coa-list')).toBe(true));
  });

  it('healthcare does not invent a patient', async () => {
    lensRunMock.mockResolvedValue(ok({ patients: [] }));
    renderInShell(<OpenChart onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Who is in front of you, Ramaj' })).toBeTruthy();
    expect(await screen.findByText('No chart open')).toBeTruthy();
    expect(screen.getByText(/Not a substitute for professional medical advice/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pharmacy' }).getAttribute('href')).toBe('/lenses/pharmacy');
  });

  it('legal opens on no matter, and keeps the disclaimer', async () => {
    lensRunMock.mockResolvedValue(ok({ matters: [] }));
    renderInShell(<MatterFront onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'The matter in front of you, Ramaj' })).toBeTruthy();
    expect(await screen.findByText('No matter open')).toBeTruthy();
    expect(screen.getByText(/does not constitute legal advice/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Disputes' }).getAttribute('href')).toBe('/lenses/disputes');
  });

  it('projects lists only rows the substrate returned', async () => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      if (actionOf(args) === 'project-create') return Promise.resolve(ok({ project: { id: 'p1', name: 'Bridge' } }));
      return Promise.resolve(ok({ projects: [] }));
    });
    renderInShell(<FlightList onOpenDesk={() => {}} />);
    expect(await screen.findByText('Nothing in the substrate')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Bridge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => actionOf(c) === 'project-create')).toBe(true));
    const call = lensRunMock.mock.calls.find((c) => actionOf(c) === 'project-create');
    expect((call?.[2] as { name?: string })?.name).toBe('Bridge');
  });

  it('analytics draws a chart only after a stream is chosen', async () => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      if (actionOf(args) === 'event-list') {
        return Promise.resolve(ok({ events: [{ id: 'e1', name: 'signup', at: '2026-10-01T00:00:00.000Z' }] }));
      }
      return Promise.resolve(ok({ topEvents: [{ name: 'signup', count: 1 }] }));
    });
    renderInShell(<OneChart onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'The one chart, Ramaj' })).toBeTruthy();
    expect(screen.queryByTestId('analytics-chart')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a stream' }));
    fireEvent.click(await screen.findByRole('button', { name: /signup/ }));
    expect(await screen.findByTestId('analytics-chart')).toBeTruthy();
  });

  it('marketplace shows published works only', async () => {
    lensRunMock.mockResolvedValue(ok({ listings: [] }));
    renderInShell(<ForSale onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: "What's for sale, Ramaj" })).toBeTruthy();
    expect(await screen.findByText('Nothing published.')).toBeTruthy();
    expect(screen.queryByTestId('listing-tile')).toBeNull();
    const listCall = lensRunMock.mock.calls.find((c) => actionOf(c) === 'listings-list');
    expect((listCall?.[2] as { status?: string })?.status).toBe('published');
  });

  it('trades stays empty until dispatch returns a job', async () => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      if (actionOf(args) === 'customer-list') return Promise.resolve(ok({ customers: [] }));
      return Promise.resolve(ok({ date: '2026-10-02', rows: [], unassigned: [], totalJobs: 0 }));
    });
    renderInShell(<JobOnBoard onOpenDesk={() => {}} />);
    expect(screen.getByRole('heading', { name: 'The job on the board, Ramaj' })).toBeTruthy();
    expect(await screen.findByText("Nothing on today's board.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Carpentry' }).getAttribute('href')).toBe('/lenses/carpentry');
  });
});
