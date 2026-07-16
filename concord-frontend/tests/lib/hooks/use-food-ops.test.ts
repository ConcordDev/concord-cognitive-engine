// tests/lib/hooks/use-food-ops.test.ts
//
// Covers lib/hooks/use-food-ops.ts — the hooks that back the food lens's
// Waste Log / Floor Plan & Tables / Prep List panels with the real
// food.waste-log-*, food.floorplan-table-*, food.floorplan-waitlist-*, and
// food.prep-list-* macros (server/domains/food.js), closing the gap where
// those panels were pure useState scratch pads that never touched a macro
// (docs/lens-specs/food-capability-map.md lines 181-198).
//
// Special focus (per the gap-closure task): the Prep List generate -> save
// -> checklist-renders-real-tasks flow, and the toggle-task persistence
// call — this is the actual historical bug (the Auto-Generate button's real
// generatePrepList result was discarded into a generic display instead of
// landing in the checklist / being persisted).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

import { useWasteLog, useFloorPlan, usePrepList } from '@/lib/hooks/use-food-ops';
import { lensRun } from '@/lib/api/client';

const mockedLensRun = lensRun as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedLensRun.mockReset();
  mockedLensRun.mockResolvedValue({ data: { ok: true, result: {} } });
});

describe('useWasteLog', () => {
  it('fetches the waste log on mount via food.waste-log-list', async () => {
    mockedLensRun.mockResolvedValueOnce({
      data: { ok: true, result: { items: [{ id: 'w1', itemName: 'Lettuce', qty: 2, unit: 'lb', reason: 'spoilage', estimatedCostImpact: 4, date: '2026-01-01' }] } },
    });
    const { result } = renderHook(() => useWasteLog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedLensRun).toHaveBeenCalledWith('food', 'waste-log-list', {});
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].itemName).toBe('Lettuce');
  });

  it('addEntry calls food.waste-log-add with the given input and prepends the real returned entry', async () => {
    mockedLensRun.mockResolvedValueOnce({ data: { ok: true, result: { items: [] } } }); // initial list
    const { result } = renderHook(() => useWasteLog());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newEntry = { id: 'w2', itemName: 'Steak', qty: 1, unit: 'lb', reason: 'overproduction' as const, estimatedCostImpact: 12, date: '2026-01-02' };
    mockedLensRun.mockResolvedValueOnce({ data: { ok: true, result: { entry: newEntry } } });

    await act(async () => {
      await result.current.addEntry({ itemName: 'Steak', qty: 1, unit: 'lb', reason: 'overproduction', estimatedCostImpact: 12 });
    });

    expect(mockedLensRun).toHaveBeenCalledWith('food', 'waste-log-add', { itemName: 'Steak', qty: 1, unit: 'lb', reason: 'overproduction', estimatedCostImpact: 12 });
    expect(result.current.entries.some(e => e.id === 'w2')).toBe(true);
  });

  it('removeEntry calls food.waste-log-delete and optimistically removes, rolling back on failure', async () => {
    mockedLensRun.mockResolvedValueOnce({
      data: { ok: true, result: { items: [{ id: 'w3', itemName: 'Bread', qty: 1, unit: 'ea', reason: 'other', estimatedCostImpact: 2, date: '2026-01-03' }] } },
    });
    const { result } = renderHook(() => useWasteLog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);

    // Success path: real delete call removes it and stays removed.
    mockedLensRun.mockResolvedValueOnce({ data: { ok: true, result: { id: 'w3', deleted: true } } });
    await act(async () => { await result.current.removeEntry('w3'); });
    expect(mockedLensRun).toHaveBeenCalledWith('food', 'waste-log-delete', { id: 'w3' });
    expect(result.current.entries).toHaveLength(0);
  });

  it('removeEntry rolls back the optimistic removal when the backend rejects it', async () => {
    mockedLensRun.mockResolvedValueOnce({
      data: { ok: true, result: { items: [{ id: 'w4', itemName: 'Cheese', qty: 1, unit: 'ea', reason: 'other', estimatedCostImpact: 3, date: '2026-01-04' }] } },
    });
    const { result } = renderHook(() => useWasteLog());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockedLensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'item not found' } });
    await act(async () => { await result.current.removeEntry('w4'); });
    // rolled back — the entry is still present since the backend rejected the delete
    expect(result.current.entries.some(e => e.id === 'w4')).toBe(true);
  });
});

describe('useFloorPlan — tables', () => {
  it('fetches tables and waitlist on mount via floorplan-table-list + floorplan-waitlist-list', async () => {
    mockedLensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'floorplan-table-list') return Promise.resolve({ data: { ok: true, result: { tables: [{ id: 't1', label: 'Table 1', seats: 4, section: null, status: 'available' }] } } });
      if (action === 'floorplan-waitlist-list') return Promise.resolve({ data: { ok: true, result: { entries: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { result } = renderHook(() => useFloorPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tables).toHaveLength(1);
    expect(result.current.tables[0].label).toBe('Table 1');
  });

  it('updateTableStatus calls food.floorplan-table-update with the new status (table status change)', async () => {
    mockedLensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'floorplan-table-list') return Promise.resolve({ data: { ok: true, result: { tables: [{ id: 't1', label: 'Table 1', seats: 4, section: null, status: 'available' }] } } });
      if (action === 'floorplan-waitlist-list') return Promise.resolve({ data: { ok: true, result: { entries: [] } } });
      if (action === 'floorplan-table-update') return Promise.resolve({ data: { ok: true, result: { table: { id: 't1', label: 'Table 1', seats: 4, section: null, status: 'occupied' } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { result } = renderHook(() => useFloorPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.updateTableStatus('t1', 'occupied'); });

    expect(mockedLensRun).toHaveBeenCalledWith('food', 'floorplan-table-update', { id: 't1', status: 'occupied' });
    expect(result.current.tables[0].status).toBe('occupied');
  });

  it('updateTableStatus rolls back the optimistic status change on rejection', async () => {
    mockedLensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'floorplan-table-list') return Promise.resolve({ data: { ok: true, result: { tables: [{ id: 't1', label: 'Table 1', seats: 4, section: null, status: 'available' }] } } });
      if (action === 'floorplan-waitlist-list') return Promise.resolve({ data: { ok: true, result: { entries: [] } } });
      if (action === 'floorplan-table-update') return Promise.resolve({ data: { ok: false, result: null, error: 'status must be one of available/occupied/reserved/dirty' } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { result } = renderHook(() => useFloorPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.updateTableStatus('t1', 'occupied'); });
    expect(result.current.tables[0].status).toBe('available'); // rolled back
  });

  it('addTable calls food.floorplan-table-add and appends the real returned table', async () => {
    mockedLensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'floorplan-table-list') return Promise.resolve({ data: { ok: true, result: { tables: [] } } });
      if (action === 'floorplan-waitlist-list') return Promise.resolve({ data: { ok: true, result: { entries: [] } } });
      if (action === 'floorplan-table-add') return Promise.resolve({ data: { ok: true, result: { table: { id: 't2', label: 'Booth 2', seats: 6, section: 'patio', status: 'available' } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { result } = renderHook(() => useFloorPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.addTable({ label: 'Booth 2', seats: 6, section: 'patio' }); });
    expect(mockedLensRun).toHaveBeenCalledWith('food', 'floorplan-table-add', { label: 'Booth 2', seats: 6, section: 'patio' });
    expect(result.current.tables.some(t => t.id === 't2')).toBe(true);
  });

  it('deleteTable calls food.floorplan-table-delete and removes the table', async () => {
    mockedLensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'floorplan-table-list') return Promise.resolve({ data: { ok: true, result: { tables: [{ id: 't3', label: 'Table 3', seats: 2, section: null, status: 'available' }] } } });
      if (action === 'floorplan-waitlist-list') return Promise.resolve({ data: { ok: true, result: { entries: [] } } });
      if (action === 'floorplan-table-delete') return Promise.resolve({ data: { ok: true, result: { id: 't3', deleted: true } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { result } = renderHook(() => useFloorPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.deleteTable('t3'); });
    expect(mockedLensRun).toHaveBeenCalledWith('food', 'floorplan-table-delete', { id: 't3' });
    expect(result.current.tables).toHaveLength(0);
  });
});

describe('useFloorPlan — walk-in waitlist', () => {
  it('addWaitlistEntry calls food.floorplan-waitlist-add and appends the real returned entry', async () => {
    mockedLensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'floorplan-table-list') return Promise.resolve({ data: { ok: true, result: { tables: [] } } });
      if (action === 'floorplan-waitlist-list') return Promise.resolve({ data: { ok: true, result: { entries: [] } } });
      if (action === 'floorplan-waitlist-add') return Promise.resolve({ data: { ok: true, result: { entry: { id: 'wk1', partyName: 'Smith', partySize: 4, phone: null, position: 1, estimatedWaitMin: 10, status: 'waiting', addedAt: '2026-01-01T12:00:00.000Z' } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { result } = renderHook(() => useFloorPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.addWaitlistEntry({ partyName: 'Smith', partySize: 4 }); });
    expect(mockedLensRun).toHaveBeenCalledWith('food', 'floorplan-waitlist-add', { partyName: 'Smith', partySize: 4 });
    expect(result.current.waitlist.some(w => w.id === 'wk1')).toBe(true);
  });

  it('removeWaitlistEntry(id, true) calls food.floorplan-waitlist-remove with seated:true (walk-in removal / seating)', async () => {
    mockedLensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'floorplan-table-list') return Promise.resolve({ data: { ok: true, result: { tables: [] } } });
      if (action === 'floorplan-waitlist-list') return Promise.resolve({ data: { ok: true, result: { entries: [{ id: 'wk2', partyName: 'Lee', partySize: 2, phone: null, position: 1, estimatedWaitMin: 10, status: 'waiting', addedAt: '2026-01-01T12:00:00.000Z' }] } } });
      if (action === 'floorplan-waitlist-remove') return Promise.resolve({ data: { ok: true, result: { entry: { id: 'wk2', status: 'seated' } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { result } = renderHook(() => useFloorPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.waitlist).toHaveLength(1);

    await act(async () => { await result.current.removeWaitlistEntry('wk2', true); });
    expect(mockedLensRun).toHaveBeenCalledWith('food', 'floorplan-waitlist-remove', { id: 'wk2', seated: true });
    expect(result.current.waitlist).toHaveLength(0); // optimistically removed from the local waiting-only view
  });

  it('removeWaitlistEntry rolls back on rejection (unknown entry)', async () => {
    mockedLensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'floorplan-table-list') return Promise.resolve({ data: { ok: true, result: { tables: [] } } });
      if (action === 'floorplan-waitlist-list') return Promise.resolve({ data: { ok: true, result: { entries: [{ id: 'wk3', partyName: 'Chen', partySize: 3, phone: null, position: 1, estimatedWaitMin: 10, status: 'waiting', addedAt: '2026-01-01T12:00:00.000Z' }] } } });
      if (action === 'floorplan-waitlist-remove') return Promise.resolve({ data: { ok: false, result: null, error: 'entry not found' } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { result } = renderHook(() => useFloorPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.removeWaitlistEntry('wk3', false); });
    expect(result.current.waitlist.some(w => w.id === 'wk3')).toBe(true); // rolled back
  });
});

describe('usePrepList — generate -> save -> checklist round-trip (the actual bug fix)', () => {
  it('restores a previously-generated list on mount via food.prep-list-get (instead of always starting empty)', async () => {
    mockedLensRun.mockResolvedValueOnce({
      data: { ok: true, result: { list: { date: '2026-01-01', tasks: [{ task: 'Dice onions', station: 'garde-manger', done: true }], generatedAt: '2026-01-01T08:00:00.000Z' } } },
    });
    const { result } = renderHook(() => usePrepList('2026-01-01'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedLensRun).toHaveBeenCalledWith('food', 'prep-list-get', { date: '2026-01-01' });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].done).toBe(true);
  });

  it('when nothing was saved yet, mounts with an empty (honest) checklist rather than fabricating tasks', async () => {
    mockedLensRun.mockResolvedValueOnce({ data: { ok: true, result: { list: null } } });
    const { result } = renderHook(() => usePrepList('2026-01-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks).toEqual([]);
  });

  it('saveTasks (the Auto-Generate wiring fix): a real generatePrepList-shaped result lands in checklist state AND is persisted via food.prep-list-save — not discarded into a generic display', async () => {
    mockedLensRun.mockResolvedValueOnce({ data: { ok: true, result: { list: null } } }); // initial mount fetch
    const { result } = renderHook(() => usePrepList('2026-01-03'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks).toEqual([]);

    // This is exactly the shape server/domains/food.js's generatePrepList
    // macro returns per task: menuItem/task/quantity/unit/prepTimeMinutes/station.
    const rawMacroTasks = [
      { menuItem: 'Soup', task: 'Dice onions', quantity: 20, unit: 'lb', prepTimeMinutes: 15, station: 'garde-manger' },
      { menuItem: 'Soup', task: 'Make stock', quantity: 1, unit: 'gal', prepTimeMinutes: 45, station: 'hot-line' },
    ];
    const persistedTasks = rawMacroTasks.map(t => ({ ...t, done: false }));
    mockedLensRun.mockResolvedValueOnce({
      data: { ok: true, result: { list: { date: '2026-01-03', tasks: persistedTasks, generatedAt: '2026-01-03T08:00:00.000Z' } } },
    });

    await act(async () => { await result.current.saveTasks(rawMacroTasks); });

    // Persisted via the real macro (not a generic actionResult display).
    expect(mockedLensRun).toHaveBeenCalledWith('food', 'prep-list-save', { date: '2026-01-03', tasks: persistedTasks });
    // Landed in the checklist state with done defaulted to false.
    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks[0].task).toBe('Dice onions');
    expect(result.current.tasks[0].done).toBe(false);
    expect(result.current.tasks[1].task).toBe('Make stock');
  });

  it('saveTasks preserves an explicit done:true on an incoming task instead of forcing it false', async () => {
    mockedLensRun.mockResolvedValueOnce({ data: { ok: true, result: { list: null } } });
    const { result } = renderHook(() => usePrepList('2026-01-04'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const tasks = [{ task: 'Already done', done: true }];
    mockedLensRun.mockResolvedValueOnce({ data: { ok: true, result: { list: { date: '2026-01-04', tasks, generatedAt: 'x' } } } });
    await act(async () => { await result.current.saveTasks(tasks); });
    expect(result.current.tasks[0].done).toBe(true);
  });

  it('toggleTask calls food.prep-list-toggle-task with the taskIndex and flips done optimistically (persistence call)', async () => {
    mockedLensRun.mockResolvedValueOnce({
      data: { ok: true, result: { list: { date: '2026-01-05', tasks: [{ task: 'A', done: false }, { task: 'B', done: false }], generatedAt: 'x' } } },
    });
    const { result } = renderHook(() => usePrepList('2026-01-05'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockedLensRun.mockResolvedValueOnce({ data: { ok: true, result: { done: true, taskIndex: 0 } } });
    await act(async () => { await result.current.toggleTask(0); });

    expect(mockedLensRun).toHaveBeenCalledWith('food', 'prep-list-toggle-task', { date: '2026-01-05', taskIndex: 0 });
    expect(result.current.tasks[0].done).toBe(true);
    expect(result.current.tasks[1].done).toBe(false); // untouched
  });

  it('toggleTask rolls back the optimistic flip when the backend rejects it', async () => {
    mockedLensRun.mockResolvedValueOnce({
      data: { ok: true, result: { list: { date: '2026-01-06', tasks: [{ task: 'First', done: false }, { task: 'Second', done: false }], generatedAt: 'x' } } },
    });
    const { result } = renderHook(() => usePrepList('2026-01-06'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Backend rejects (e.g. the list was deleted/replaced concurrently) —
    // the optimistic flip on index 1 must be rolled back, not left standing.
    mockedLensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'prep list not found for that date' } });
    await act(async () => { await result.current.toggleTask(1); });
    expect(result.current.tasks[1].done).toBe(false); // rolled back
    expect(result.current.tasks[0].done).toBe(false); // untouched throughout
  });
});
