/**
 * /lenses/docs — delete safety (S1; Review 2 finding F1, the
 * `unconfirmed-destructive` class).
 *
 * Every Docs delete used to execute instantly: no confirmation, no
 * undo, no receipt. S1's three safeguards, pinned here:
 *   CONFIRM — the delete control swaps inline to a step NAMING the
 *     item ("Delete “X”?") with Confirm / Cancel; the first click
 *     alone deletes nothing, Cancel deletes nothing.
 *   UNDO WINDOW — a confirmed delete registers with the registry and
 *     the item leaves the view, but the macro does NOT run until the
 *     window lapses; Undo inside the window cancels it outright
 *     (the item reappears; the macro is never called).
 *   RECEIPT — the toast announces the pending deletion (with Undo),
 *     then the completed deletion; a refused commit surfaces the
 *     server's error and the item is restored.
 *
 * The DatabaseViews half runs the real component against mocked
 * lensRun envelopes; the registry and the confirm button are pinned
 * directly. Fake timers drive the window.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { get: vi.fn() },
  apiHelpers: { dtus: { myDtus: vi.fn() } },
}));

import {
  requestDelete, undoDelete, isDeletePending, getDeleteSafetySnapshot,
  resetDeleteSafetyForTests, DELETE_UNDO_WINDOW_MS,
} from '@/components/docs/delete-safety-store';
import { ConfirmDeleteButton, DeleteReceiptToast } from '@/components/docs/DeleteSafety';
import { DatabaseViews } from '@/components/docs/DatabaseViews';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  resetDeleteSafetyForTests();
});
afterEach(() => { vi.useRealTimers(); });

describe('delete-safety registry — the undo window', () => {
  it('a registered delete does not commit until the window lapses, then commits once', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    requestDelete({ key: 'page:p1', label: 'Spec', commit });
    expect(isDeletePending('page:p1')).toBe(true);
    expect(getDeleteSafetySnapshot().receipt).toMatchObject({ phase: 'pending', label: 'Spec' });
    expect(commit).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(isDeletePending('page:p1')).toBe(false);
    expect(getDeleteSafetySnapshot().receipt).toMatchObject({ phase: 'done', label: 'Spec' });
  });

  it('undo inside the window cancels the commit outright', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    requestDelete({ key: 'page:p1', label: 'Spec', commit });
    undoDelete('page:p1');
    expect(isDeletePending('page:p1')).toBe(false);
    expect(getDeleteSafetySnapshot().receipt).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS * 2); });
    expect(commit).not.toHaveBeenCalled();
  });

  it('a refused commit surfaces the error as the receipt', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('page not found'));
    requestDelete({ key: 'page:p9', label: 'Ghost', commit });
    await act(async () => { await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS); });
    expect(getDeleteSafetySnapshot().receipt).toMatchObject({
      phase: 'error', label: 'Ghost', message: 'page not found',
    });
  });
});

describe('ConfirmDeleteButton — inline confirmation naming the item', () => {
  it('first click deletes nothing; the confirm step names the item; Cancel resets', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteButton itemLabel="Quarterly Spec" deleteTitle="Delete page" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete “Quarterly Spec”\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete page' })).toBeTruthy();
  });

  it('the named Confirm fires onConfirm exactly once', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteButton itemLabel="Quarterly Spec" deleteTitle="Delete page" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Quarterly Spec' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

const DB = {
  id: 'db1', name: 'Budgets',
  columns: [{ id: 'c1', name: 'Item', type: 'text' }, { id: 'c2', name: 'Cost', type: 'number' }],
  rows: [{ id: 'r1', cells: { c1: 'Travel', c2: 42 } }],
};

function mockDbRun() {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'db-list') {
      return Promise.resolve({ data: { ok: true, result: { databases: [{ id: 'db1', name: 'Budgets', columnCount: 2, rowCount: 1, updatedAt: '' }] } } });
    }
    if (action === 'db-detail') {
      return Promise.resolve({ data: { ok: true, result: { database: DB } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('DatabaseViews — database + row deletes ride the safeguard', () => {
  it('database delete: confirm names it, Undo restores it, db-delete never runs', async () => {
    mockDbRun();
    render(<><DatabaseViews /><DeleteReceiptToast /></>);
    await flush();
    expect(screen.getByText('Budgets')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete database' }));
    expect(screen.getByText(/Delete “Budgets”\?/)).toBeTruthy();
    expect(lensRun.mock.calls.some((c) => c[1] === 'db-delete')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Budgets' }));
    // Gone from the list at once, announced with Undo, macro not yet run.
    expect(screen.queryByText('Budgets')).toBeNull();
    expect(screen.getByText(/Deleting “Budgets”…/)).toBeTruthy();
    expect(lensRun.mock.calls.some((c) => c[1] === 'db-delete')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await flush();
    expect(screen.getByText('Budgets')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS * 2); });
    expect(lensRun.mock.calls.some((c) => c[1] === 'db-delete')).toBe(false);
  });

  it('row delete: window lapses → db-row-delete runs once and the deletion is announced', async () => {
    mockDbRun();
    render(<><DatabaseViews /><DeleteReceiptToast /></>);
    await flush();
    fireEvent.click(screen.getByText(/Budgets/));
    await flush();
    // DbCell renders text cells as inputs — the row is present by value.
    expect(screen.getByDisplayValue('Travel')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete row' }));
    // The confirm step names the row by its first text cell.
    expect(screen.getByText(/Delete “Travel”\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Travel' }));
    expect(screen.queryByDisplayValue('Travel')).toBeNull();
    expect(lensRun.mock.calls.some((c) => c[1] === 'db-row-delete')).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS); });
    const rowDeletes = lensRun.mock.calls.filter((c) => c[1] === 'db-row-delete');
    expect(rowDeletes.length).toBe(1);
    expect(rowDeletes[0][2]).toMatchObject({ id: 'db1', rowId: 'r1' });
    expect(screen.getByText(/“Travel” deleted\./)).toBeTruthy();
  });
});
