/**
 * FIX-events-009 — a past event date (2020-01-01) was accepted without a
 * word. Past events are a modelled state in this domain (the status
 * engine derives "past" from the date), so the create form now warns in
 * place instead of refusing — and the warning clears for today/future.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { EventPlanner } from '@/components/events/EventPlanner';

describe('FIX-events-009 — a past event date warns', () => {
  it('shows the already-past note for a past date and clears it for a future one', async () => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'event-list') return Promise.resolve({ data: { ok: true, result: { events: [] } } });
      if (action === 'events-dashboard') return Promise.resolve({ data: { ok: true, result: { totalEvents: 0, upcoming: 0, totalBudget: 0, openTasks: 0 } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<EventPlanner />);
    const date = await screen.findByLabelText('Event date');
    expect(screen.queryByRole('note')).toBeNull();

    fireEvent.change(date, { target: { value: '2020-01-01' } });
    expect(screen.getByRole('note').textContent).toMatch(/already past/i);

    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    fireEvent.change(date, { target: { value: future } });
    expect(screen.queryByRole('note')).toBeNull();
  });
});
