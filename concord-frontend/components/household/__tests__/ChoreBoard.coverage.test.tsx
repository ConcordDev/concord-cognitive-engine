// Behaviour coverage for the chore board: add room/chore, mark done, delete, vacation toggle,
// leaderboard, urgent/overdue rendering and the failed-load retry.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
let paused = false;
function resultFor(action: string): unknown {
  switch (action) {
    case 'room-list': return { rooms: [{ id: 'r1', name: 'Kitchen', taskCount: 2 }, { id: 'r2', name: 'Garage', taskCount: 0 }] };
    case 'chore-board': return { board: [
      { id: 't1', name: 'Mop floor', room: 'Kitchen', assignee: 'Sam', effort: 'heavy', condition: { ratio: 1.4, state: 'needs_attention', daysOverdue: 3 } },
      { id: 't2', name: 'Wipe counters', room: 'Kitchen', assignee: null, effort: 'light', condition: { ratio: 0.6, state: 'getting_dirty', daysOverdue: 0 } },
    ] };
    case 'assignee-leaderboard': return { leaderboard: [{ person: 'Sam', points: 12, choresDone: 3 }] };
    case 'household-dashboard': return { rooms: 2, tasks: 2, cleanlinessPct: 71.4, needsAttention: 1, paused };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const mount = async () => { const { ChoreBoard } = await import('../ChoreBoard'); const v = render(<ChoreBoard />); await settle(); return v; };
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 20)); }); };
afterEach(() => cleanup());
beforeEach(() => {
  paused = false;
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
});

describe('ChoreBoard', () => {
  it('renders the board and leaderboard, adds a room and a chore, completes and deletes', async () => {
    const view = await mount();
    expect(view.container.textContent).toMatch(/Mop floor.*3d overdue/);
    expect(view.container.textContent).toMatch(/Sam/);
    expect(view.container.textContent).toMatch(/71/);

    const room = screen.getByPlaceholderText('New room');
    await act(async () => { fireEvent.change(room, { target: { value: '  ' } }); });
    await click(screen.getAllByLabelText('Add')[0]);
    await act(async () => { fireEvent.change(room, { target: { value: 'Attic' } }); fireEvent.keyDown(room, { key: 'Enter' }); });
    await settle();
    expect(sent()).toContain('room-create');

    const selects = view.container.querySelectorAll('select');
    await act(async () => { fireEvent.change(selects[0], { target: { value: 'r1' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Chore name'), { target: { value: 'Dust shelves' } }); });
    await act(async () => { fireEvent.change(selects[1], { target: { value: '14' } }); });
    await act(async () => { fireEvent.change(selects[2], { target: { value: 'heavy' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Who'), { target: { value: 'Ana' } }); });
    await click(screen.getByText('Add chore'));
    expect(sent()).toContain('task-create');

    await click(screen.getAllByTitle('Mark done')[0]);
    expect(sent()).toContain('task-done');
    const dels = screen.getAllByLabelText('Delete');
    await click(dels[0]);
    expect(sent()).toContain('task-delete');
  });

  it('confirms before deleting a room and toggles vacation both ways', async () => {
    await mount();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const roomDeletes = screen.getAllByLabelText('Delete').slice(2);
    await click(roomDeletes[0]);
    expect(sent()).not.toContain('room-delete');
    await click(roomDeletes[0]);
    expect(sent()).toContain('room-delete');
    confirmSpy.mockRestore();
    await click(screen.getByText('Vacation'));
    expect(lensRunMock.mock.calls.find((c) => actionOf(c) === 'vacation-toggle')?.[2]).toEqual({ on: true });
    cleanup(); lensRunMock.mockClear(); paused = true;
    await mount();
    await click(screen.getByText('Resume'));
    expect(lensRunMock.mock.calls.find((c) => actionOf(c) === 'vacation-toggle')?.[2]).toEqual({ on: false });
  });

  it('shows empty states, and an error with retry on failure', async () => {
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: ['room-list', 'chore-board', 'assignee-leaderboard'].includes(actionOf(a)) ? {} : null } }));
    const empty = await mount();
    expect(empty.container.textContent).toMatch(/No chores yet/);
    expect(empty.container.textContent).toMatch(/No chores logged/);
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    await mount();
    expect(screen.getByRole('alert').textContent).toMatch(/offline/);
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
    await click(screen.getByText('Try again'));
    expect(document.body.textContent).toMatch(/Mop floor/);
  });
});
