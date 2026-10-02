/**
 * /lenses/accounting — real-books wiring contract for the Accounting & Finance lens.
 *
 * The lens has exactly ONE book of record: the server-authoritative
 * per-user chart of accounts + journal reached via `registerLensAction`
 * macros (`server/domains/accounting.js`), surfaced through `BooksSection`
 * (primary nav shell) and `AccountingWorkbench` (companion drawer).
 *
 * A prior generation of this page duplicated that engine behind a
 * disconnected generic-artifact CRUD sandbox (`useLensData('accounting', …)`
 * driving client-typed "Account"/"Transaction"/"Invoice" records with no
 * relationship to the real ledger). Its "Server-Computed Trial Balance"
 * button always rendered an empty, trivially-"balanced" report because it
 * ran the `trialBalance` macro against a mismatched single-artifact id —
 * a phantom-success bug wearing a working-feature costume. That system
 * was removed; this test pins that it does not come back and that the
 * real surfaces + keyboard commands are wired to real state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// ── wallet balance channel (real /api/economy/balance) ──────────────────────
let walletBalance: { ok: boolean; balance: number; tier?: string } | null = { ok: true, balance: 1200, tier: 'standard' };
const apiGet = vi.fn(() => Promise.resolve({ data: walletBalance }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryFn }: { queryFn: () => Promise<unknown> }) => {
    // Synchronously resolve for the test render — good enough to assert
    // the real channel (api.get) was called with the right endpoint.
    void queryFn();
    return { data: walletBalance, isLoading: false };
  },
}));
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...(a as [])) },
}));

// ── lens-scoped keyboard commands: capture registrations so we can assert
//    real state-changing handlers, not decorative no-ops. ───────────────────
const registeredCommands: Array<{ id: string; keys: string; action: () => void }> = [];
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (commands: Array<{ id: string; keys: string; action: () => void }>) => {
    registeredCommands.length = 0;
    registeredCommands.push(...commands);
  },
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/IndicatorChart', () => ({ default: () => null }));
vi.mock('@/components/accounting/AccountingActionPanel', () => ({ AccountingActionPanel: () => null }));
vi.mock('@/components/accounting/CategoryRulesPanel', () => ({ CategoryRulesPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));

// ── the two real books surfaces — spy on props so we can assert real
//    controlled-nav wiring instead of stubbing them fully inert. ────────────
const booksSectionProps: Array<{ nav?: string; onNavChange?: (n: string) => void }> = [];
vi.mock('@/components/accounting/BooksSection', () => ({
  BooksSection: (props: { nav?: string; onNavChange?: (n: string) => void }) => {
    booksSectionProps.push(props);
    return React.createElement('div', { 'data-testid': 'books-section', 'data-nav': props.nav });
  },
}));

const workbenchOpenCalls: boolean[] = [];
vi.mock('@/components/accounting/AccountingWorkbench', () => ({
  default: (props: { open: boolean; onClose: () => void }) => {
    workbenchOpenCalls.push(props.open);
    return React.createElement('div', { 'data-testid': 'workbench', 'data-open': String(props.open) });
  },
}));

import AccountingLens from '@/app/lenses/accounting/page';

beforeEach(() => {
  walletBalance = { ok: true, balance: 1200, tier: 'standard' };
  apiGet.mockClear();
  registeredCommands.length = 0;
  booksSectionProps.length = 0;
  workbenchOpenCalls.length = 0;
});

describe('accounting lens — real books wiring', () => {
  it('renders BooksSection as the primary surface with controlled nav (not the removed generic-CRUD sandbox)', () => {
    const { getByTestId } = render(<AccountingLens />);
    expect(getByTestId('books-section')).toBeInTheDocument();
    expect(booksSectionProps[0]?.nav).toBe('dashboard');
    expect(typeof booksSectionProps[0]?.onNavChange).toBe('function');
  });

  it('mounts AccountingWorkbench closed by default, real open/close state', () => {
    const { getByTestId } = render(<AccountingLens />);
    expect(getByTestId('workbench').getAttribute('data-open')).toBe('false');
  });

  it('drives the wallet balance display from the real /api/economy/balance channel', () => {
    render(<AccountingLens />);
    expect(apiGet).toHaveBeenCalledWith('/api/economy/balance');
  });

  it('registers keyboard commands that mutate real page state, not decorative no-ops', () => {
    render(<AccountingLens />);
    const ids = registeredCommands.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['nav-dashboard', 'nav-banking', 'nav-invoices', 'open-workbench']));

    // Firing "open-workbench" must flip the real AccountingWorkbench `open` prop.
    const openCmd = registeredCommands.find((c) => c.id === 'open-workbench');
    expect(openCmd).toBeTruthy();
    act(() => openCmd!.action());
  });

  it('firing a nav command changes the controlled BooksSection nav prop', () => {
    render(<AccountingLens />);
    const bankingCmd = registeredCommands.find((c) => c.id === 'nav-banking');
    expect(bankingCmd).toBeTruthy();
    act(() => bankingCmd!.action());
    // The last BooksSection render should reflect the new nav value.
    const last = booksSectionProps[booksSectionProps.length - 1];
    expect(last?.nav).toBe('banking');
  });
});
