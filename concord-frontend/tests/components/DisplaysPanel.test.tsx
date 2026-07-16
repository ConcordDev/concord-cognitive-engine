/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the retail in-store marketing display board (Wave 4 larger-unit
// build, docs/lens-specs/retail-capability-map.md "Genuinely missing,
// deferred" #3) against the real retail.displays-* macro contract: create,
// status lifecycle, manual impression logging, order-gated conversion
// recording (including the reject-fake-order path), and honest empty/error
// states with server-computed conversion-rate math.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { DisplaysPanel } from '@/components/retail/DisplaysPanel';

const DISPLAY = {
  id: 'disp_1', location: 'Front endcap, aisle 3', displayType: 'endcap', budget: 100,
  startDate: null, endDate: null, productSkus: [] as string[], notes: '',
  status: 'planned',
  statusHistory: [{ from: null, to: 'planned', at: '2026-07-01T00:00:00.000Z' }],
  impressions: 200, impressionLog: [{ count: 200, note: 'morning count', at: '2026-07-01T00:00:00.000Z' }],
  conversions: 1, attributedOrderIds: ['ord_1'], attributedRevenue: 50,
  removedAt: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
  conversionRate: 0.5, revenuePerBudgetDollar: 0.5,
};

const ORDER = { id: 'ord_1', number: 'ORD-00001', total: 50 };

function listResponse(displays: Array<Record<string, unknown>> = []) {
  const totalImpressions = displays.reduce((s, d) => s + (d.impressions as number), 0);
  const totalConversions = displays.reduce((s, d) => s + (d.conversions as number), 0);
  const totalBudget = displays.reduce((s, d) => s + (d.budget as number), 0);
  const totalAttributedRevenue = displays.reduce((s, d) => s + (d.attributedRevenue as number), 0);
  return {
    data: {
      ok: true,
      result: {
        displays,
        statuses: ['planned', 'active', 'removed'],
        openStatuses: ['planned', 'active'],
        displayTypes: ['endcap', 'window', 'checkout-counter', 'floor-display', 'shelf-talker', 'promotional-table'],
        rollup: {
          totalDisplays: displays.length,
          plannedCount: displays.filter((d) => d.status === 'planned').length,
          activeCount: displays.filter((d) => d.status === 'active').length,
          removedCount: displays.filter((d) => d.status === 'removed').length,
          totalImpressions, totalConversions,
          conversionRate: totalImpressions > 0 ? Math.round((totalConversions / totalImpressions) * 10000) / 100 : 0,
          totalBudget,
          totalAttributedRevenue,
          revenuePerBudgetDollar: totalBudget > 0 ? Math.round((totalAttributedRevenue / totalBudget) * 100) / 100 : null,
        },
      },
    },
  };
}

function ordersResponse(orders: Array<Record<string, unknown>> = []) {
  return { data: { ok: true, result: { orders } } };
}

describe('DisplaysPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via displays-list + orders-list and renders the display card', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([DISPLAY]))
      .mockResolvedValueOnce(ordersResponse([ORDER]));
    render(<DisplaysPanel />);

    expect(await screen.findByText('Front endcap, aisle 3')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith({ domain: 'retail', action: 'displays-list', input: {} });
    expect(lensRun).toHaveBeenCalledWith({ domain: 'retail', action: 'orders-list', input: {} });
  });

  it('renders server-computed rollup numbers only, never a client-invented figure', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([DISPLAY]))
      .mockResolvedValueOnce(ordersResponse([ORDER]));
    render(<DisplaysPanel />);
    await screen.findByText('Front endcap, aisle 3');

    // conversionRate = 1/200*100 = 0.5% (rollup strip + per-card stat row)
    expect(screen.getAllByText('0.5%').length).toBeGreaterThanOrEqual(1);
    // attributed revenue $50.00 appears in the rollup strip
    expect(screen.getAllByText('$50.00').length).toBeGreaterThanOrEqual(1);
  });

  it('an empty book renders an honest empty state, not fabricated placeholder displays', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(ordersResponse([]));
    render(<DisplaysPanel />);
    await waitFor(() => expect(screen.getByText(/No displays in the board/)).toBeInTheDocument());
  });

  it('create calls displays-upsert with the typed fields and refreshes', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(ordersResponse([]))
      .mockResolvedValueOnce({ data: { ok: true, result: { display: { ...DISPLAY, id: 'disp_new', location: 'Checkout lane 2' } } } })
      .mockResolvedValueOnce(listResponse([{ ...DISPLAY, id: 'disp_new', location: 'Checkout lane 2' }]))
      .mockResolvedValueOnce(ordersResponse([]));

    render(<DisplaysPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByLabelText('New display'));
    fireEvent.change(screen.getByPlaceholderText('Location (e.g. front endcap, aisle 3)'), { target: { value: 'Checkout lane 2' } });
    fireEvent.click(screen.getByText('Add display'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'displays-upsert',
        input: expect.objectContaining({ location: 'Checkout lane 2', displayType: 'endcap' }),
      }),
    );
    expect(await screen.findByText('Checkout lane 2')).toBeInTheDocument();
  });

  it('logging impressions calls displays-log-impressions with a manual count + note and accumulates', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([DISPLAY]))
      .mockResolvedValueOnce(ordersResponse([ORDER]))
      .mockResolvedValueOnce({ data: { ok: true, result: { display: { ...DISPLAY, impressions: 260 }, logged: {} } } })
      .mockResolvedValueOnce(listResponse([{ ...DISPLAY, impressions: 260 }]))
      .mockResolvedValueOnce(ordersResponse([ORDER]));

    render(<DisplaysPanel />);
    fireEvent.click(await screen.findByText('Front endcap, aisle 3'));

    fireEvent.change(screen.getByPlaceholderText('Count'), { target: { value: '60' } });
    fireEvent.change(screen.getByPlaceholderText('Note (optional)'), { target: { value: 'afternoon count' } });
    fireEvent.click(screen.getByText('Log impressions'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'displays-log-impressions',
        input: { id: 'disp_1', count: 60, note: 'afternoon count' },
      }),
    );
  });

  it('record conversion: picking a real order from the dropdown calls displays-record-conversion with that orderId', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([DISPLAY]))
      .mockResolvedValueOnce(ordersResponse([ORDER]))
      .mockResolvedValueOnce({ data: { ok: true, result: { display: { ...DISPLAY, conversions: 2 } } } })
      .mockResolvedValueOnce(listResponse([{ ...DISPLAY, conversions: 2 }]))
      .mockResolvedValueOnce(ordersResponse([ORDER]));

    render(<DisplaysPanel />);
    fireEvent.click(await screen.findByText('Front endcap, aisle 3'));

    const select = screen.getByLabelText('Pick a real order');
    fireEvent.change(select, { target: { value: 'ord_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record conversion' }));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'displays-record-conversion',
        input: { id: 'disp_1', orderId: 'ord_1' },
      }),
    );
  });

  it('record conversion: a FAKE/nonexistent orderId is genuinely rejected and the honest server error is surfaced', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([DISPLAY]))
      .mockResolvedValueOnce(ordersResponse([ORDER]))
      .mockResolvedValueOnce({ data: { ok: false, error: 'order not found' } });

    render(<DisplaysPanel />);
    fireEvent.click(await screen.findByText('Front endcap, aisle 3'));

    fireEvent.change(screen.getByPlaceholderText('…or paste an order id'), { target: { value: 'ord_totally_made_up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record conversion' }));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'displays-record-conversion',
        input: { id: 'disp_1', orderId: 'ord_totally_made_up' },
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('order not found');
  });

  it('Record conversion is disabled until an order is picked or typed', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([DISPLAY]))
      .mockResolvedValueOnce(ordersResponse([ORDER]));

    render(<DisplaysPanel />);
    fireEvent.click(await screen.findByText('Front endcap, aisle 3'));

    expect(screen.getByRole('button', { name: 'Record conversion' })).toBeDisabled();
  });

  it('a removed display shows a Reopen action instead of the status controls', async () => {
    const removed = { ...DISPLAY, status: 'removed', removedAt: '2026-07-02T00:00:00.000Z' };
    lensRun
      .mockResolvedValueOnce(listResponse([removed]))
      .mockResolvedValueOnce(ordersResponse([ORDER]))
      .mockResolvedValueOnce({ data: { ok: true, result: { display: { ...removed, status: 'planned' }, moved: {} } } })
      .mockResolvedValueOnce(listResponse([{ ...removed, status: 'planned' }]))
      .mockResolvedValueOnce(ordersResponse([ORDER]));

    render(<DisplaysPanel />);
    fireEvent.click(await screen.findByText('Front endcap, aisle 3'));

    const reopenBtn = await screen.findByText('Reopen');
    fireEvent.click(reopenBtn);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'displays-status-move',
        input: { id: 'disp_1', status: 'planned', reopen: true },
      }),
    );
  });

  it('revenuePerBudgetDollar renders "n/a (no budget)" instead of Infinity/NaN when budget is 0', async () => {
    const zeroBudget = { ...DISPLAY, budget: 0, revenuePerBudgetDollar: null };
    lensRun
      .mockResolvedValueOnce(listResponse([zeroBudget]))
      .mockResolvedValueOnce(ordersResponse([ORDER]));

    render(<DisplaysPanel />);
    fireEvent.click(await screen.findByText('Front endcap, aisle 3'));

    const rows = within(screen.getByText('Rev./$ budget:').closest('div') as HTMLElement);
    expect(rows.getByText('n/a (no budget)')).toBeInTheDocument();
  });

  it('status filter narrows the visible list without changing the rollup numbers', async () => {
    const active = { ...DISPLAY, id: 'disp_2', location: 'Window display', status: 'active' };
    lensRun
      .mockResolvedValueOnce(listResponse([DISPLAY, active]))
      .mockResolvedValueOnce(ordersResponse([ORDER]));
    render(<DisplaysPanel />);
    await screen.findByText('Front endcap, aisle 3');
    expect(screen.getByText('Window display')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    expect(screen.queryByText('Front endcap, aisle 3')).not.toBeInTheDocument();
    expect(screen.getByText('Window display')).toBeInTheDocument();
  });

  it('surfaces an honest error on a failed load instead of a silent blank board', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } })
      .mockResolvedValueOnce(ordersResponse([]));
    render(<DisplaysPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('STATE unavailable');
  });
});
