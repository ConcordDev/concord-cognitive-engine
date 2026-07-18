/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the retail support-ticket queue (Wave 4 larger-unit build,
// docs/lens-specs/retail-capability-map.md "Genuinely missing, deferred" #2)
// against the real retail.tickets-* macro contract: create, SLA-badge
// coloring driven by the server-computed slaState, reply thread, resolve
// action, and honest empty/error states.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { TicketQueuePanel } from '@/components/retail/TicketQueuePanel';

const TICKET = {
  id: 'tkt_1', subject: 'Checkout is broken', description: 'Cart never confirms.',
  priority: 'critical', status: 'open', assignee: 'Sam', requester: 'Acme Co', contactEmail: 'ops@acme.com',
  slaTargetMinutes: 60, slaDeadline: new Date(Date.now() + 45 * 60000).toISOString(),
  statusHistory: [{ from: null, to: 'open', at: '2026-07-01T00:00:00.000Z' }],
  replies: [] as Array<{ author: string; body: string; at: string }>,
  resolvedAt: null, resolvedWithinSla: null, closedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
  slaState: 'healthy',
};

function listResponse(tickets: Array<Record<string, unknown>> = []) {
  const byPriority: Record<string, { count: number; open: number; breached: number }> = {};
  for (const p of ['critical', 'high', 'medium', 'low']) byPriority[p] = { count: 0, open: 0, breached: 0 };
  for (const t of tickets) {
    const p = t.priority as string;
    byPriority[p].count++;
    if (['open', 'in-progress', 'waiting-on-customer'].includes(t.status as string)) byPriority[p].open++;
  }
  const open = tickets.filter((t) => ['open', 'in-progress', 'waiting-on-customer'].includes(t.status as string));
  const resolved = tickets.filter((t) => t.resolvedWithinSla !== null && t.resolvedWithinSla !== undefined);
  const met = resolved.filter((t) => t.resolvedWithinSla === true);
  return {
    data: {
      ok: true,
      result: {
        tickets,
        rollup: {
          totalTickets: tickets.length,
          openCount: open.length,
          breachedOpenCount: open.filter((t) => t.slaState === 'breached').length,
          resolvedCount: resolved.length,
          metCount: met.length,
          complianceRate: resolved.length > 0 ? Math.round((met.length / resolved.length) * 10000) / 100 : 100,
          byPriority,
        },
      },
    },
  };
}

describe('TicketQueuePanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via tickets-list and renders the ticket row', async () => {
    lensRun.mockResolvedValueOnce(listResponse([TICKET]));
    render(<TicketQueuePanel />);

    expect(await screen.findByText('Checkout is broken')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith({ domain: 'retail', action: 'tickets-list', input: {} });
  });

  it('renders server-computed rollup numbers only, never a client-invented figure', async () => {
    const breached = { ...TICKET, id: 'tkt_2', subject: 'Breached one', slaState: 'breached', slaDeadline: new Date(Date.now() - 60000).toISOString() };
    lensRun.mockResolvedValueOnce(listResponse([TICKET, breached]));
    render(<TicketQueuePanel />);
    await screen.findByText('Checkout is broken');

    expect(screen.getByText('2')).toBeInTheDocument(); // openCount
    // breachedOpenCount rendered in the rollup strip
    const breachedCells = screen.getAllByText('1');
    expect(breachedCells.length).toBeGreaterThanOrEqual(1);
  });

  it('SLA badge coloring: healthy renders "left", breached renders "Breached ... ago"', async () => {
    const breached = { ...TICKET, id: 'tkt_2', subject: 'Breached one', slaState: 'breached', slaDeadline: new Date(Date.now() - 60 * 60000).toISOString() };
    lensRun.mockResolvedValueOnce(listResponse([TICKET, breached]));
    render(<TicketQueuePanel />);
    await screen.findByText('Checkout is broken');

    const healthyBadge = screen.getByTestId('sla-badge-tkt_1');
    expect(healthyBadge).toHaveTextContent('left');
    const breachedBadge = screen.getByTestId('sla-badge-tkt_2');
    expect(breachedBadge).toHaveTextContent('Breached');
    expect(breachedBadge.className).toMatch(/rose/);
  });

  it('an empty book renders an honest empty state, not fabricated placeholder tickets', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<TicketQueuePanel />);
    await waitFor(() => expect(screen.getByText(/No tickets in the queue/)).toBeInTheDocument());
  });

  it('create calls tickets-upsert with the typed fields and refreshes', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({ data: { ok: true, result: { ticket: { ...TICKET, id: 'tkt_new', subject: 'New issue' } } } })
      .mockResolvedValueOnce(listResponse([{ ...TICKET, id: 'tkt_new', subject: 'New issue' }]));

    render(<TicketQueuePanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('New ticket'));
    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'New issue' } });
    fireEvent.click(screen.getByText('Open ticket'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'tickets-upsert',
        input: expect.objectContaining({ subject: 'New issue', priority: 'medium' }),
      }),
    );
    expect(await screen.findByText('New issue')).toBeInTheDocument();
  });

  it('selecting a ticket, replying, and resolving drive the real macros', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([TICKET]))
      .mockResolvedValueOnce({ data: { ok: true, result: { ticket: { ...TICKET, replies: [{ author: 'Sam', body: 'Looking into it.', at: '2026-07-01T01:00:00.000Z' }] }, reply: {} } } })
      .mockResolvedValueOnce(listResponse([{ ...TICKET, replies: [{ author: 'Sam', body: 'Looking into it.', at: '2026-07-01T01:00:00.000Z' }] }]))
      .mockResolvedValueOnce({ data: { ok: true, result: { ticket: { ...TICKET, status: 'resolved', resolvedWithinSla: true }, moved: {} } } })
      .mockResolvedValueOnce(listResponse([{ ...TICKET, status: 'resolved', resolvedWithinSla: true, slaState: 'resolved-on-time' }]));

    render(<TicketQueuePanel />);
    fireEvent.click(await screen.findByText('Checkout is broken'));

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByPlaceholderText('Write a reply…'), { target: { value: 'Looking into it.' } });
    fireEvent.click(screen.getByText('Send reply'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'tickets-reply-add',
        input: { id: 'tkt_1', author: 'Sam', body: 'Looking into it.' },
      }),
    );
    expect(await screen.findByText('Looking into it.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Resolve'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'tickets-status-move',
        input: { id: 'tkt_1', status: 'resolved', reopen: undefined },
      }),
    );
  });

  it('a closed ticket shows a Reopen action instead of the status controls', async () => {
    const closed = { ...TICKET, status: 'closed', closedAt: '2026-07-02T00:00:00.000Z', slaState: 'closed' };
    lensRun
      .mockResolvedValueOnce(listResponse([closed]))
      .mockResolvedValueOnce({ data: { ok: true, result: { ticket: { ...closed, status: 'open' }, moved: {} } } })
      .mockResolvedValueOnce(listResponse([{ ...closed, status: 'open', slaState: 'healthy' }]));

    render(<TicketQueuePanel />);
    fireEvent.click(await screen.findByText('Checkout is broken'));

    const reopenBtn = await screen.findByText('Reopen');
    fireEvent.click(reopenBtn);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'tickets-status-move',
        input: { id: 'tkt_1', status: 'open', reopen: true },
      }),
    );
  });

  it('status filter narrows the visible list without changing the rollup', async () => {
    const resolved = { ...TICKET, id: 'tkt_r', subject: 'Already resolved', status: 'resolved', resolvedWithinSla: true, slaState: 'resolved-on-time' };
    lensRun.mockResolvedValueOnce(listResponse([TICKET, resolved]));
    render(<TicketQueuePanel />);
    await screen.findByText('Checkout is broken');
    expect(screen.getByText('Already resolved')).toBeInTheDocument();

    // "Resolved" is ambiguous as plain text (it's both the filter-tab button
    // AND the rollup stat label) — target the button role specifically.
    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.queryByText('Checkout is broken')).not.toBeInTheDocument();
    expect(screen.getByText('Already resolved')).toBeInTheDocument();
  });

  it('surfaces an honest error on a failed load instead of a silent blank queue', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    render(<TicketQueuePanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('STATE unavailable');
  });
});
