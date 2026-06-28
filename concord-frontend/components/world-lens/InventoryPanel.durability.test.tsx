// Behavior test for InventoryPanel gear durability bars + Repair All button.
// Mocks the player-inventory fetch + the gear.durability / gear.repair_all
// macro calls (lensRun). Verifies: durability fill renders at the right width
// + colour (broken=red, low=amber, healthy=emerald), the Repair All button
// surfaces the total cost, clicking it calls gear.repair_all then refreshes,
// and the insufficient-funds error renders honestly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
// The socket subscribe is a no-op in jsdom; return an unsubscribe fn.
vi.mock('@/lib/realtime/socket', () => ({ subscribe: () => () => {} }));

import InventoryPanel from '@/components/world-lens/InventoryPanel';

// Mock the /api/player-inventory fetch.
function mockInventoryFetch(items: Record<string, unknown>[]) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, items }),
  })) as unknown as typeof fetch;
}

// gear.durability + gear.repair_all responses, keyed by action.
function mockGearMacros(opts: {
  durability: { items: Record<string, unknown>[]; repairCostTotal: number };
  repairResult?: { ok: boolean; reason?: string };
}) {
  lensRun.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'gear' && action === 'durability') {
      return { data: { ok: true, result: opts.durability, error: null } };
    }
    if (domain === 'gear' && action === 'repair_all') {
      const r = opts.repairResult ?? { ok: true };
      return { data: { ok: r.ok !== false, result: r, error: null } };
    }
    return { data: { ok: true, result: {}, error: null } };
  });
}

const INV = [
  { id: 'sword1', item_name: 'Broken Sword', item_type: 'equipment', quantity: 1 },
  { id: 'helm1', item_name: 'Low Helm', item_type: 'equipment', quantity: 1 },
  { id: 'ore1', item_name: 'Iron Ore', item_type: 'materials', quantity: 5 },
];

describe('InventoryPanel gear durability', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders a red durability fill for a broken item and amber for low', async () => {
    mockInventoryFetch(INV);
    mockGearMacros({
      durability: {
        items: [
          { itemId: 'sword1', current: 0, max: 100, broken: true, lowDurability: false },
          { itemId: 'helm1', current: 15, max: 100, broken: false, lowDurability: true },
        ],
        repairCostTotal: 42,
      },
    });

    render(<InventoryPanel />);

    const brokenFill = await screen.findByTestId('durability-fill-sword1');
    expect(brokenFill.className).toContain('bg-red-500');
    expect(brokenFill.style.width).toBe('0%');

    const lowFill = await screen.findByTestId('durability-fill-helm1');
    expect(lowFill.className).toContain('bg-amber-400');
    expect(lowFill.style.width).toBe('15%');

    // The material (NULL durability — not in the gear.durability map) renders
    // no fill bar.
    expect(screen.queryByTestId('durability-fill-ore1')).toBeNull();
  });

  it('shows Repair All with the total cost and calls the macro on click', async () => {
    mockInventoryFetch(INV);
    mockGearMacros({
      durability: {
        items: [{ itemId: 'sword1', current: 0, max: 100, broken: true, lowDurability: false }],
        repairCostTotal: 42,
      },
      repairResult: { ok: true },
    });

    render(<InventoryPanel />);

    const btn = await screen.findByTestId('repair-all-button');
    expect(btn.textContent).toMatch(/Repair All \(42 cc\)/);

    fireEvent.click(btn);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('gear', 'repair_all', {}),
    );
    // After repair it refreshes durability (durability called twice: mount + post-repair).
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[0] === 'gear' && c[1] === 'durability').length).toBeGreaterThanOrEqual(2),
    );
  });

  it('surfaces an honest insufficient-funds error', async () => {
    mockInventoryFetch(INV);
    mockGearMacros({
      durability: {
        items: [{ itemId: 'sword1', current: 0, max: 100, broken: true, lowDurability: false }],
        repairCostTotal: 9999,
      },
      repairResult: { ok: false, reason: 'insufficient_funds' },
    });

    render(<InventoryPanel />);
    const btn = await screen.findByTestId('repair-all-button');
    fireEvent.click(btn);

    expect(await screen.findByText(/Not enough Concord Coin/i)).toBeInTheDocument();
  });

  it('hides the Repair All button when nothing needs repair', async () => {
    mockInventoryFetch(INV);
    mockGearMacros({
      durability: {
        items: [{ itemId: 'sword1', current: 100, max: 100, broken: false, lowDurability: false }],
        repairCostTotal: 0,
      },
    });

    render(<InventoryPanel />);
    // wait for the durability load to settle
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(screen.queryByTestId('repair-all-button')).toBeNull();
  });
});
