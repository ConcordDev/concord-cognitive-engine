/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the Wave 4 gap-closure of docs/WAVE4_INVENTORY.md line 324 /
// travel-capability-map.md entry #10 ("No loyalty-program/frequent-flyer
// points tracking"). LoyaltyProgramsPanel renders per-user loyalty
// accounts with a DERIVED points balance (never a value the component
// invents or caches) and an append-only points ledger per account.
// Every assertion checks the actual macro call the UI made — nothing
// renders as "added"/"logged" until the backend macro resolves ok:true.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { LoyaltyProgramsPanel } from '@/components/travel/LoyaltyProgramsPanel';

const ACCOUNT_A = {
  id: 'loy_1', program: 'United MileagePlus', accountNumber: 'MP123', tier: 'gold',
  notes: null, tripId: null, createdAt: '2026-01-01T00:00:00.000Z',
  balance: 4200, entries: 3, lastActivity: '2026-03-01T00:00:00.000Z',
};
const ACCOUNT_B = {
  id: 'loy_2', program: 'Marriott Bonvoy', accountNumber: null, tier: 'none',
  notes: null, tripId: null, createdAt: '2026-01-02T00:00:00.000Z',
  balance: 0, entries: 0, lastActivity: null,
};

function mockList(accounts: unknown[], totalBalance?: number) {
  return {
    data: {
      ok: true,
      result: {
        accounts, count: accounts.length,
        totalBalance: totalBalance ?? (accounts as { balance: number }[]).reduce((a, x) => a + x.balance, 0),
      },
    },
  };
}

describe('LoyaltyProgramsPanel — accounts + derived balance', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders an empty state when there are no accounts', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'loyalty-account-list') return mockList([]);
      return { data: { ok: true, result: {} } };
    });
    render(<LoyaltyProgramsPanel />);
    expect(await screen.findByText(/No loyalty accounts yet/i)).toBeInTheDocument();
  });

  it('renders accounts with their derived balance and a total across programs', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'loyalty-account-list') return mockList([ACCOUNT_A, ACCOUNT_B]);
      return { data: { ok: true, result: {} } };
    });
    render(<LoyaltyProgramsPanel />);
    await screen.findByText('United MileagePlus');
    expect(screen.getByText('Marriott Bonvoy')).toBeInTheDocument();
    // "4,200" appears twice: once as the total-points strip, once as
    // ACCOUNT_A's own row balance (ACCOUNT_B contributes 0).
    expect(screen.getAllByText('4,200')).toHaveLength(2);
  });

  it('adding an account calls loyalty-account-add with the form fields and refreshes', async () => {
    let listCallCount = 0;
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'loyalty-account-list') {
        listCallCount += 1;
        return mockList(listCallCount === 1 ? [] : [ACCOUNT_B]);
      }
      if (action === 'loyalty-account-add') {
        expect(params.program).toBe('Marriott Bonvoy');
        return { data: { ok: true, result: { account: { ...ACCOUNT_B } } } };
      }
      return { data: { ok: true, result: {} } };
    });
    render(<LoyaltyProgramsPanel />);
    await screen.findByText(/No loyalty accounts yet/i);

    fireEvent.change(screen.getByPlaceholderText(/Program \(e.g/i), { target: { value: 'Marriott Bonvoy' } });
    fireEvent.click(screen.getByText(/Add loyalty account/i));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('travel', 'loyalty-account-add',
        expect.objectContaining({ program: 'Marriott Bonvoy' })));
    await waitFor(() => expect(screen.getByText('Marriott Bonvoy')).toBeInTheDocument());
  });

  it('rejects adding an account without a program name, without calling the macro', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'loyalty-account-list') return mockList([]);
      return { data: { ok: true, result: {} } };
    });
    render(<LoyaltyProgramsPanel />);
    await screen.findByText(/No loyalty accounts yet/i);
    fireEvent.click(screen.getByText(/Add loyalty account/i));
    expect(await screen.findByText(/Program name is required/i)).toBeInTheDocument();
    expect(lensRun.mock.calls.some(([, action]) => action === 'loyalty-account-add')).toBe(false);
  });

  it('removing an account calls loyalty-account-remove and refreshes the list', async () => {
    let listCallCount = 0;
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'loyalty-account-list') {
        listCallCount += 1;
        return mockList(listCallCount === 1 ? [ACCOUNT_A] : []);
      }
      if (action === 'loyalty-account-remove') {
        expect(params.id).toBe('loy_1');
        return { data: { ok: true, result: { deleted: 'loy_1' } } };
      }
      return { data: { ok: true, result: {} } };
    });
    render(<LoyaltyProgramsPanel />);
    await screen.findByText('United MileagePlus');

    fireEvent.click(screen.getByLabelText('Remove loyalty account'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('travel', 'loyalty-account-remove', { id: 'loy_1' }));
    await waitFor(() => expect(screen.queryByText('United MileagePlus')).not.toBeInTheDocument());
  });
});

describe('LoyaltyProgramsPanel — points ledger', () => {
  beforeEach(() => lensRun.mockReset());

  it('expanding an account fetches and renders its points ledger', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'loyalty-account-list') return mockList([ACCOUNT_A]);
      if (action === 'loyalty-points-log-list') {
        expect(params.accountId).toBe('loy_1');
        return {
          data: {
            ok: true,
            result: {
              entries: [
                { id: 'lpe_2', accountId: 'loy_1', delta: -2000, kind: 'redeemed', bookingId: null, note: 'redeemed for upgrade', at: '2026-03-01T00:00:00.000Z' },
                { id: 'lpe_1', accountId: 'loy_1', delta: 5000, kind: 'earned', bookingId: null, note: 'signup bonus', at: '2026-01-01T00:00:00.000Z' },
              ],
              count: 2, balance: 3000,
            },
          },
        };
      }
      return { data: { ok: true, result: {} } };
    });
    render(<LoyaltyProgramsPanel />);
    await screen.findByText('United MileagePlus');

    fireEvent.click(screen.getByLabelText('Show ledger'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('travel', 'loyalty-points-log-list', { accountId: 'loy_1' }));
    expect(await screen.findByText(/redeemed for upgrade/i)).toBeInTheDocument();
    expect(screen.getByText(/signup bonus/i)).toBeInTheDocument();
    expect(screen.getByText('-2,000')).toBeInTheDocument();
    expect(screen.getByText('+5,000')).toBeInTheDocument();
  });

  it('logging a new points entry calls loyalty-points-log-add and reloads the ledger + balance', async () => {
    let logCallCount = 0;
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'loyalty-account-list') return mockList([{ ...ACCOUNT_A, balance: logCallCount >= 1 ? 5000 : 4200 }]);
      if (action === 'loyalty-points-log-list') {
        logCallCount += 1;
        return {
          data: {
            ok: true,
            result: {
              entries: logCallCount === 1
                ? []
                : [{ id: 'lpe_3', accountId: 'loy_1', delta: 800, kind: 'earned', bookingId: 'bkg_xyz', note: 'flight bonus', at: '2026-04-01T00:00:00.000Z' }],
              count: logCallCount === 1 ? 0 : 1,
              balance: logCallCount === 1 ? 0 : 800,
            },
          },
        };
      }
      if (action === 'loyalty-points-log-add') {
        expect(params.accountId).toBe('loy_1');
        expect(params.delta).toBe(800);
        return { data: { ok: true, result: { entry: { id: 'lpe_3', accountId: 'loy_1', delta: 800 }, balance: 800 } } };
      }
      return { data: { ok: true, result: {} } };
    });
    render(<LoyaltyProgramsPanel />);
    await screen.findByText('United MileagePlus');
    fireEvent.click(screen.getByLabelText('Show ledger'));
    await screen.findByText(/No points logged yet/i);

    fireEvent.change(screen.getByPlaceholderText(/\+earned \/ -redeemed/i), { target: { value: '800' } });
    fireEvent.change(screen.getByPlaceholderText(/Note \(e.g. flight/i), { target: { value: 'flight bonus' } });
    fireEvent.click(screen.getByText('Log'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('travel', 'loyalty-points-log-add',
        expect.objectContaining({ accountId: 'loy_1', delta: 800, note: 'flight bonus' })));
    await waitFor(() => expect(screen.getByText(/flight bonus/i)).toBeInTheDocument());
  });

  it('rejects logging a zero delta without calling the macro', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'loyalty-account-list') return mockList([ACCOUNT_A]);
      if (action === 'loyalty-points-log-list') return { data: { ok: true, result: { entries: [], count: 0, balance: 0 } } };
      return { data: { ok: true, result: {} } };
    });
    render(<LoyaltyProgramsPanel />);
    await screen.findByText('United MileagePlus');
    fireEvent.click(screen.getByLabelText('Show ledger'));
    await screen.findByText(/No points logged yet/i);

    fireEvent.click(screen.getByText('Log'));
    expect(await screen.findByText(/non-zero number/i)).toBeInTheDocument();
    expect(lensRun.mock.calls.some(([, action]) => action === 'loyalty-points-log-add')).toBe(false);
  });

  it('surfaces the server\'s honest rejection without fabricating a logged entry', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'loyalty-account-list') return mockList([ACCOUNT_A]);
      if (action === 'loyalty-points-log-list') return { data: { ok: true, result: { entries: [], count: 0, balance: 0 } } };
      if (action === 'loyalty-points-log-add') return { data: { ok: false, result: null, error: 'loyalty account not found' } };
      return { data: { ok: true, result: {} } };
    });
    render(<LoyaltyProgramsPanel />);
    await screen.findByText('United MileagePlus');
    fireEvent.click(screen.getByLabelText('Show ledger'));
    await screen.findByText(/No points logged yet/i);

    fireEvent.change(screen.getByPlaceholderText(/\+earned \/ -redeemed/i), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Log'));

    expect(await screen.findByText('loyalty account not found')).toBeInTheDocument();
    // Still shows the empty ledger — nothing fabricated into the list.
    expect(screen.getByText(/No points logged yet/i)).toBeInTheDocument();
  });
});
