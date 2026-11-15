// FIX-creative-007 (FE half) — ProductionSuite gains edit controls:
// call sheet rows edit inline through callsheet-update-row, and
// calendar events edit through the existing calendar-update macro.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));
vi.mock('@/components/viz', () => ({
  TimelineView: () => null,
  ChartKit: () => null,
}));
vi.mock('@/lib/creative/dashboard-bus', () => ({ notifyCreativeDashboardDirty: () => {} }));

import { ProductionSuite } from '@/components/creative/ProductionSuite';

const SHEET = {
  id: 'cs1', project: 'Night Shoot', shootDate: '2026-12-01', dayNumber: 1, generalCall: '07:30',
  cast: [{ id: 'row1', name: 'Ada', role: 'Lead', callTime: '07:30' }],
  crew: [], locations: [], schedule: [], notes: '',
};
const EVENT = {
  id: 'cal1', title: 'Shoot day', date: '2026-12-01', kind: 'shoot_day',
  project: null, endDate: null, notes: '', done: false,
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, name: string) => {
    switch (name) {
      case 'callsheet-list': return { data: { ok: true, result: { sheets: [SHEET], count: 1 } } };
      case 'callsheet-get': return { data: { ok: true, result: { sheet: SHEET } } };
      case 'callsheet-update-row': return { data: { ok: true, result: { sheet: SHEET } } };
      case 'calendar-list': return { data: { ok: true, result: { events: [EVENT], upcoming: 1, overdue: 0 } } };
      case 'calendar-update': return { data: { ok: true, result: { event: EVENT } } };
      default: return { data: { ok: true, result: {} } };
    }
  });
});
afterEach(() => cleanup());

describe('ProductionSuite edit controls', () => {
  it('call sheet row edit saves through callsheet-update-row', async () => {
    render(<ProductionSuite />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Call Sheets/i })); });
    const card = await screen.findByText('Night Shoot');
    await act(async () => { fireEvent.click(card); });
    const editBtn = await screen.findByRole('button', { name: 'Edit row' });
    await act(async () => { fireEvent.click(editBtn); });
    const roleInput = await screen.findByLabelText('Edit role');
    await act(async () => { fireEvent.change(roleInput, { target: { value: 'Director' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save row' })); });
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'callsheet-update-row');
    expect(call?.[2]).toMatchObject({ id: 'cs1', section: 'cast', rowId: 'row1', role: 'Director' });
  });

  it('calendar event edit saves through calendar-update', async () => {
    render(<ProductionSuite />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Calendar/i })); });
    const editBtn = await screen.findByRole('button', { name: 'Edit event' });
    await act(async () => { fireEvent.click(editBtn); });
    const titleInput = await screen.findByLabelText('Edit event title');
    await act(async () => { fireEvent.change(titleInput, { target: { value: 'Shoot day 2' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'calendar-update');
    expect(call?.[2]).toMatchObject({ id: 'cal1', title: 'Shoot day 2' });
  });
});
