/// <reference types="@testing-library/jest-dom/vitest" />
// ReplicationPanel filtered/scoped replication — Wave-4 gap closure,
// docs/lens-specs/offline-capability-map.md "Filtered/scoped replication
// ... GENUINELY MISSING" item. Pins: a real saved-filter create/list/delete
// round trip through the offline.filter{Create,List,Delete} macros, that
// selecting a saved filter makes the next Pull call replicationPull with the
// real filterId (and that leaving "no filter" selected omits it, unchanged
// from before this feature existed), and honest empty/loading/error states
// — never a fabricated filter result and never a silently-ignored error.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Real IndexedDB isn't available in jsdom by default — mock the local-store
// write-through layer the same way the component's own header comment
// describes it (writes go to IndexedDB first, then replicate).
const localStoreMock = vi.hoisted(() => ({
  allDocs: vi.fn(async () => []),
  dirtyDocs: vi.fn(async () => []),
  putDoc: vi.fn(async () => ({})),
  deleteDocLocal: vi.fn(async () => undefined),
  markClean: vi.fn(async () => undefined),
  applyServerChange: vi.fn(async () => undefined),
  clearLocal: vi.fn(async () => undefined),
  localBytes: vi.fn(async () => 0),
}));
vi.mock('@/components/offline/local-store', () => localStoreMock);

import { ReplicationPanel } from '@/components/offline/ReplicationPanel';

interface SavedFilter {
  id: string;
  name: string;
  collection: string | null;
  fieldMatch: { field: string; op: string; value: unknown }[];
  createdAt: string;
}

function ok<T>(result: T) {
  return { data: { ok: true, result, error: null } };
}
function fail(error: string) {
  return { data: { ok: false, result: null, error } };
}

const STATUS_RESULT = { docCount: 0, updateSeq: 0, changeCount: 0, approxBytes: 0 };

/** Route lensRun calls by (domain, action) to keep each test's setup terse
 * and honest about exactly what the component asked the server for. */
function wireLensRun(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  lensRunMock.mockImplementation(async (domain: string, action: string, params: Record<string, unknown> = {}) => {
    const key = `${domain}.${action}`;
    if (handlers[key]) return handlers[key](params);
    // Sensible defaults so panels not under test don't explode.
    if (action === 'replicationStatus') return ok(STATUS_RESULT);
    if (action === 'syncCheckpoint') return ok({ seq: 0, at: null, saved: false });
    if (action === 'filterList') return ok({ filters: [] });
    return ok({});
  });
}

describe('ReplicationPanel — saved filter create/list/delete', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    Object.values(localStoreMock).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockClear());
  });

  it('shows an honest empty state when no filters are saved yet', async () => {
    wireLensRun({});
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    expect(await screen.findByText(/No saved filters yet/i)).toBeInTheDocument();
  });

  it('shows a loading state while filters are being fetched', async () => {
    let resolveFilters: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => { resolveFilters = resolve; });
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (action === 'filterList') return pending;
      if (action === 'replicationStatus') return ok(STATUS_RESULT);
      if (action === 'syncCheckpoint') return ok({ seq: 0, at: null, saved: false });
      return ok({});
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    expect(await screen.findByText(/Loading saved filters/i)).toBeInTheDocument();
    resolveFilters(ok({ filters: [] }));
    await waitFor(() => expect(screen.queryByText(/Loading saved filters/i)).not.toBeInTheDocument());
  });

  it('creates a filter and lists it back — a real round trip through filterCreate + filterList', async () => {
    const savedFilters: SavedFilter[] = [];
    wireLensRun({
      'offline.filterList': () => ok({ filters: [...savedFilters] }),
      'offline.filterCreate': (params) => {
        const filter: SavedFilter = {
          id: 'filter_test_1',
          name: String(params.name),
          collection: (params.collection as string) || null,
          fieldMatch: (params.fieldMatch as SavedFilter['fieldMatch']) || [],
          createdAt: new Date().toISOString(),
        };
        savedFilters.push(filter);
        return ok({ filter });
      },
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    await screen.findByText(/No saved filters yet/i);

    fireEvent.click(screen.getByText('New filter'));
    fireEvent.change(screen.getByPlaceholderText(/filter name/i), { target: { value: 'Notes only' } });
    fireEvent.change(screen.getByPlaceholderText(/collection prefix/i), { target: { value: 'note' } });
    fireEvent.click(screen.getByText('Save filter'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'offline', 'filterCreate',
      expect.objectContaining({ name: 'Notes only', collection: 'note' }),
    ));
    expect(await screen.findByText('Notes only')).toBeInTheDocument();
    expect(screen.getByText(/collection = "note"/)).toBeInTheDocument();
  });

  it('creates a filter with a real field-match condition', async () => {
    const savedFilters: SavedFilter[] = [];
    wireLensRun({
      'offline.filterList': () => ok({ filters: [...savedFilters] }),
      'offline.filterCreate': (params) => {
        const filter: SavedFilter = {
          id: 'filter_test_2',
          name: String(params.name),
          collection: (params.collection as string) || null,
          fieldMatch: (params.fieldMatch as SavedFilter['fieldMatch']) || [],
          createdAt: new Date().toISOString(),
        };
        savedFilters.push(filter);
        return ok({ filter });
      },
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    await screen.findByText(/No saved filters yet/i);

    fireEvent.click(screen.getByText('New filter'));
    fireEvent.change(screen.getByPlaceholderText(/filter name/i), { target: { value: 'Shopping items' } });
    fireEvent.click(screen.getByText('Add field condition'));
    fireEvent.change(screen.getByPlaceholderText('field'), { target: { value: 'tag' } });
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'shopping' } });
    fireEvent.click(screen.getByText('Save filter'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'offline', 'filterCreate',
      expect.objectContaining({
        name: 'Shopping items',
        fieldMatch: [{ field: 'tag', op: 'eq', value: 'shopping' }],
      }),
    ));
    expect(await screen.findByText(/tag eq "shopping"/)).toBeInTheDocument();
  });

  it('honestly rejects an empty filter (no collection, no conditions) without calling the macro', async () => {
    wireLensRun({});
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    await screen.findByText(/No saved filters yet/i);

    fireEvent.click(screen.getByText('New filter'));
    fireEvent.change(screen.getByPlaceholderText(/filter name/i), { target: { value: 'Nothing' } });
    fireEvent.click(screen.getByText('Save filter'));

    expect(await screen.findByText(/needs a collection and\/or at least one condition/i)).toBeInTheDocument();
    expect(lensRunMock).not.toHaveBeenCalledWith('offline', 'filterCreate', expect.anything());
  });

  it('surfaces the real server error when filterCreate fails', async () => {
    wireLensRun({
      'offline.filterCreate': () => fail('name required'),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    await screen.findByText(/No saved filters yet/i);

    fireEvent.click(screen.getByText('New filter'));
    fireEvent.change(screen.getByPlaceholderText(/filter name/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText(/collection prefix/i), { target: { value: 'note' } });
    fireEvent.click(screen.getByText('Save filter'));

    expect(await screen.findByText('name required')).toBeInTheDocument();
  });

  it('deletes a saved filter — a real round trip through filterDelete', async () => {
    const savedFilters: SavedFilter[] = [
      { id: 'filter_del_1', name: 'To delete', collection: 'note', fieldMatch: [], createdAt: new Date().toISOString() },
    ];
    wireLensRun({
      'offline.filterList': () => ok({ filters: [...savedFilters] }),
      'offline.filterDelete': (params) => {
        const idx = savedFilters.findIndex((f) => f.id === params.id);
        if (idx === -1) return fail('filter_not_found');
        savedFilters.splice(idx, 1);
        return ok({ id: params.id, deleted: true });
      },
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    expect(await screen.findByText('To delete')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Delete filter To delete'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('offline', 'filterDelete', { id: 'filter_del_1' }));
    await waitFor(() => expect(screen.queryByText('To delete')).not.toBeInTheDocument());
    expect(await screen.findByText(/No saved filters yet/i)).toBeInTheDocument();
  });

  it('honestly surfaces a bogus-delete error without pretending success', async () => {
    const savedFilters: SavedFilter[] = [
      { id: 'filter_x', name: 'Some filter', collection: 'note', fieldMatch: [], createdAt: new Date().toISOString() },
    ];
    wireLensRun({
      'offline.filterList': () => ok({ filters: [...savedFilters] }),
      'offline.filterDelete': () => fail('filter_not_found'),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    expect(await screen.findByText('Some filter')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Delete filter Some filter'));

    expect(await screen.findByText('filter_not_found')).toBeInTheDocument();
    // The filter must still be listed — a failed delete is not a silent no-op success.
    expect(screen.getByText('Some filter')).toBeInTheDocument();
  });
});

describe('ReplicationPanel — Pull with a selected filter', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    Object.values(localStoreMock).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockClear());
  });

  const SAVED_FILTER: SavedFilter = {
    id: 'filter_shopping',
    name: 'Shopping notes',
    collection: 'note',
    fieldMatch: [],
    createdAt: new Date().toISOString(),
  };

  it('calls replicationPull WITHOUT filterId when no filter is selected (unchanged default behavior)', async () => {
    wireLensRun({
      'offline.filterList': () => ok({ filters: [SAVED_FILTER] }),
      'offline.replicationPull': () => ok({ changes: [], lastSeq: 0, pending: 0, updateSeq: 0, filterId: null }),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    await screen.findByText('Shopping notes');

    fireEvent.click(screen.getByText('Pull'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'offline', 'replicationPull',
      expect.objectContaining({ since: 0, limit: 200 }),
    ));
    const pullCall = lensRunMock.mock.calls.find((c) => c[1] === 'replicationPull');
    expect(pullCall?.[2]).not.toHaveProperty('filterId');
  });

  it('calls replicationPull WITH the real selected filterId once a filter is chosen', async () => {
    wireLensRun({
      'offline.filterList': () => ok({ filters: [SAVED_FILTER] }),
      'offline.replicationPull': () => ok({
        changes: [{ seq: 1, id: 'note:1', rev: '1-abc', deleted: false, doc: { title: 'x' }, updatedAt: new Date().toISOString() }],
        lastSeq: 1, pending: 0, updateSeq: 1, filterId: SAVED_FILTER.id,
      }),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    await screen.findByText('Shopping notes');

    fireEvent.click(screen.getByLabelText('Use filter Shopping notes for pull'));
    expect(await screen.findByText(/Pull is scoped to/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Pull (filtered)'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'offline', 'replicationPull',
      expect.objectContaining({ since: 0, limit: 200, filterId: 'filter_shopping' }),
    ));
    // The filtered checkpoint is persisted on a DISTINCT replicationId from
    // the unfiltered stream so the two never clobber each other's `since`.
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'offline', 'syncCheckpoint',
      expect.objectContaining({ replicationId: 'offline-lens-replication:filter:filter_shopping', seq: 1 }),
    ));
  });

  it('surfaces an honest error and does not apply changes when the server rejects a bogus filterId', async () => {
    wireLensRun({
      'offline.filterList': () => ok({ filters: [SAVED_FILTER] }),
      'offline.replicationPull': () => fail('filter_not_found'),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    await screen.findByText('Shopping notes');

    fireEvent.click(screen.getByLabelText('Use filter Shopping notes for pull'));
    fireEvent.click(screen.getByText('Pull (filtered)'));

    expect(await screen.findByText('filter_not_found')).toBeInTheDocument();
    expect(localStoreMock.applyServerChange).not.toHaveBeenCalled();
  });

  it('switching back to "no filter" reverts Pull to unfiltered calls', async () => {
    wireLensRun({
      'offline.filterList': () => ok({ filters: [SAVED_FILTER] }),
      'offline.replicationPull': () => ok({ changes: [], lastSeq: 0, pending: 0, updateSeq: 0, filterId: null }),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    await screen.findByText('Shopping notes');

    fireEvent.click(screen.getByLabelText('Use filter Shopping notes for pull'));
    expect(await screen.findByText(/Pull is scoped to/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('No filter (pull everything)'));
    await waitFor(() => expect(screen.queryByText(/Pull is scoped to/)).not.toBeInTheDocument());
    // Let the unfiltered checkpoint reload (triggered by the selection
    // change) fully settle before driving another action.
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'offline', 'syncCheckpoint',
      expect.objectContaining({ replicationId: 'offline-lens-replication' }),
    ));

    fireEvent.click(screen.getByText('Pull'));
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'replicationPull')).toBe(true));
    const pullCall = lensRunMock.mock.calls.filter((c) => c[1] === 'replicationPull').at(-1);
    expect(pullCall?.[2]).not.toHaveProperty('filterId');
  });
});
