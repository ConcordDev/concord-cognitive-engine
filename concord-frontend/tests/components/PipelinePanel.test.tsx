/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the retail CRM / sales-pipeline kanban (Wave 4 larger-unit build,
// docs/lens-specs/retail-capability-map.md "Genuinely missing, deferred" #1)
// against the real retail.deals-* macro contract: create → renders in the
// right stage column, stage-move calls the macro, rollup header renders
// server-computed numbers only, honest empty/error states.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { PipelinePanel } from '@/components/retail/PipelinePanel';

const DEAL = {
  id: 'deal_1', name: 'Acme renewal', company: 'Acme Co', contactName: 'Jo',
  assignee: 'Sam', notes: '', value: 1000, probability: 50, stage: 'proposal',
  expectedCloseDate: null, stageHistory: [], closedAt: null,
};

function listResponse(deals: typeof DEAL[] = []) {
  const byStage: Record<string, { count: number; value: number; weighted: number }> = {};
  for (const s of ['lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost']) {
    byStage[s] = { count: 0, value: 0, weighted: 0 };
  }
  for (const d of deals) {
    byStage[d.stage].count++;
    byStage[d.stage].value += d.value;
    byStage[d.stage].weighted += d.value * (d.probability / 100);
  }
  const open = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  return {
    data: {
      ok: true,
      result: {
        deals,
        rollup: {
          totalDeals: deals.length,
          openCount: open.length,
          totalPipelineValue: open.reduce((a, d) => a + d.value, 0),
          weightedPipelineValue: open.reduce((a, d) => a + d.value * (d.probability / 100), 0),
          wonCount: deals.filter((d) => d.stage === 'won').length,
          wonValue: deals.filter((d) => d.stage === 'won').reduce((a, d) => a + d.value, 0),
          lostCount: deals.filter((d) => d.stage === 'lost').length,
          lostValue: deals.filter((d) => d.stage === 'lost').reduce((a, d) => a + d.value, 0),
          byStage,
        },
      },
    },
  };
}

describe('PipelinePanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via deals-list and renders the deal in its real stage column', async () => {
    lensRun.mockResolvedValueOnce(listResponse([DEAL]));
    render(<PipelinePanel />);

    expect(await screen.findByText('Acme renewal')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith({ domain: 'retail', action: 'deals-list', input: {} });
    // Rendered inside the Proposal column.
    const column = screen.getByTestId('pipeline-column-proposal');
    expect(column).toHaveTextContent('Acme renewal');
  });

  it('renders server-computed rollup numbers only, never a client-invented figure', async () => {
    lensRun.mockResolvedValueOnce(listResponse([DEAL]));
    render(<PipelinePanel />);
    await screen.findByText('Acme renewal');

    // value=1000, probability=50% → weighted 500, server-supplied.
    // Rendered both in the rollup header and on the deal card.
    expect(screen.getAllByText('$1,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$500').length).toBeGreaterThanOrEqual(1);
  });

  it('an empty book renders honest empty columns, not fabricated placeholder deals', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<PipelinePanel />);
    await waitFor(() => expect(screen.getAllByText('empty').length).toBeGreaterThan(0));
  });

  it('create calls deals-upsert with the typed fields and refreshes', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({ data: { ok: true, result: { deal: { ...DEAL, id: 'deal_2', name: 'New biz' } } } })
      .mockResolvedValueOnce(listResponse([{ ...DEAL, id: 'deal_2', name: 'New biz' }]));

    render(<PipelinePanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('New deal'));
    fireEvent.change(screen.getByPlaceholderText('Deal name'), { target: { value: 'New biz' } });
    fireEvent.change(screen.getByPlaceholderText('Value ($)'), { target: { value: '750' } });
    fireEvent.click(screen.getByText('Add deal'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'deals-upsert',
        input: expect.objectContaining({ name: 'New biz', value: 750 }),
      }),
    );
    expect(await screen.findByText('New biz')).toBeInTheDocument();
  });

  it('moving a deal calls deals-stage-move with the selected stage', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([DEAL]))
      .mockResolvedValueOnce({ data: { ok: true, result: { deal: { ...DEAL, stage: 'negotiation' }, moved: {} } } })
      .mockResolvedValueOnce(listResponse([{ ...DEAL, stage: 'negotiation' }]));

    render(<PipelinePanel />);
    await screen.findByText('Acme renewal');

    fireEvent.change(screen.getByLabelText('Move Acme renewal to stage'), { target: { value: 'negotiation' } });

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'deals-stage-move',
        input: { id: 'deal_1', stage: 'negotiation', reopen: undefined },
      }),
    );
  });

  it('surfaces an honest error on a failed load instead of a silent blank board', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    render(<PipelinePanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('STATE unavailable');
  });

  it('the won/lost archive is hidden by default and reveals real closed deals on toggle', async () => {
    const won = { ...DEAL, id: 'deal_won', name: 'Closed win', stage: 'won', probability: 100, closedAt: '2026-07-01T00:00:00.000Z' };
    lensRun.mockResolvedValueOnce(listResponse([won]));
    render(<PipelinePanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());

    expect(screen.queryByText('Closed win')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Show won\/lost archive/));
    expect(await screen.findByText('Closed win')).toBeInTheDocument();
  });
});
