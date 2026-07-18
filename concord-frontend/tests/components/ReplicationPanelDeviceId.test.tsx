/// <reference types="@testing-library/jest-dom/vitest" />
// ReplicationPanel — multi-device conflict provenance wiring (Wave-4 gap
// closure, docs/lens-specs/offline-capability-map.md "Multi-device conflict
// provenance (which device wrote which revision) ... GENUINELY MISSING"
// item). Pins: Push sends this browser's real persisted device id through
// `offline.replicationPush`, the applied entries reconcile the local store
// via `markClean(..., deviceId)`, and Pull threads each pulled change's
// origin `deviceId` through to `applyServerChange` — all without touching or
// regressing the sibling filtered-replication feature
// (ReplicationPanelFilters.test.tsx), which this file deliberately leaves
// alone.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const DIRTY_DOC = {
  id: 'note:dirty1',
  body: { title: 'unsaved change' },
  rev: null,
  baseRev: null,
  updatedAt: new Date().toISOString(),
  dirty: true,
  deleted: false,
  deviceId: null,
};

const localStoreMock = vi.hoisted(() => ({
  allDocs: vi.fn(async () => []),
  dirtyDocs: vi.fn(async () => []),
  putDoc: vi.fn(async () => ({})),
  deleteDocLocal: vi.fn(async () => undefined),
  markClean: vi.fn(async () => undefined),
  applyServerChange: vi.fn(async () => undefined),
  clearLocal: vi.fn(async () => undefined),
  localBytes: vi.fn(async () => 0),
  getDeviceId: vi.fn(() => 'this-browser-device-id'),
}));
vi.mock('@/components/offline/local-store', () => localStoreMock);

import { ReplicationPanel } from '@/components/offline/ReplicationPanel';

function ok<T>(result: T) {
  return { data: { ok: true, result, error: null } };
}

const STATUS_RESULT = { docCount: 0, updateSeq: 0, changeCount: 0, approxBytes: 0 };

function wireLensRun(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  lensRunMock.mockImplementation(async (domain: string, action: string, params: Record<string, unknown> = {}) => {
    const key = `${domain}.${action}`;
    if (handlers[key]) return handlers[key](params);
    if (action === 'replicationStatus') return ok(STATUS_RESULT);
    if (action === 'syncCheckpoint') return ok({ seq: 0, at: null, saved: false });
    if (action === 'filterList') return ok({ filters: [] });
    return ok({});
  });
}

describe('ReplicationPanel — Push sends this browser\'s device id', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    Object.values(localStoreMock).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockClear());
    localStoreMock.dirtyDocs.mockResolvedValue([DIRTY_DOC]);
    // allDocs drives the rendered "Dirty (unpushed)" count / "Push (N)" label.
    localStoreMock.allDocs.mockResolvedValue([DIRTY_DOC]);
  });

  it('includes the real persisted deviceId in the replicationPush call', async () => {
    wireLensRun({
      'offline.replicationPush': () => ok({
        applied: [{ id: 'note:dirty1', rev: '1-abc', seq: 1, deleted: false, deviceId: 'this-browser-device-id' }],
        conflicts: [], appliedCount: 1, conflictCount: 0, updateSeq: 1,
      }),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    fireEvent.click(await screen.findByText(/Push \(1\)/));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'offline', 'replicationPush',
      expect.objectContaining({
        deviceId: 'this-browser-device-id',
        docs: [expect.objectContaining({ id: 'note:dirty1' })],
      }),
    ));
  });

  it('reconciles the local store via markClean using this device\'s id for each applied doc', async () => {
    wireLensRun({
      'offline.replicationPush': () => ok({
        applied: [{ id: 'note:dirty1', rev: '1-abc', seq: 1, deleted: false, deviceId: 'this-browser-device-id' }],
        conflicts: [], appliedCount: 1, conflictCount: 0, updateSeq: 1,
      }),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    fireEvent.click(await screen.findByText(/Push \(1\)/));

    await waitFor(() => expect(localStoreMock.markClean).toHaveBeenCalledWith(
      'note:dirty1', '1-abc', false, 'this-browser-device-id',
    ));
  });

  it('surfaces held conflicts (with both-sides device provenance) to the parent unmodified', async () => {
    const onConflicts = vi.fn();
    const conflict = {
      id: 'note:dirty1',
      serverRev: '2-xyz', serverBody: { title: 'server' }, serverDeviceId: 'device-other',
      clientRev: null, clientBody: { title: 'unsaved change' }, clientDeviceId: 'this-browser-device-id',
      reason: 'rev_mismatch',
    };
    wireLensRun({
      'offline.replicationPush': () => ok({
        applied: [], conflicts: [conflict], appliedCount: 0, conflictCount: 1, updateSeq: 1,
      }),
    });
    render(<ReplicationPanel onConflicts={onConflicts} />);
    fireEvent.click(await screen.findByText(/Push \(1\)/));

    await waitFor(() => expect(onConflicts).toHaveBeenCalledWith([conflict]));
  });
});

describe('ReplicationPanel — Pull threads pulled deviceId through to applyServerChange', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    Object.values(localStoreMock).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockClear());
    localStoreMock.dirtyDocs.mockResolvedValue([]);
    localStoreMock.allDocs.mockResolvedValue([]);
  });

  it('applies a pulled change with the ORIGIN device id the server reported (may differ from this browser)', async () => {
    wireLensRun({
      'offline.replicationPull': () => ok({
        changes: [{
          seq: 1, id: 'note:remote1', rev: '1-remote', deleted: false,
          doc: { title: 'from another device' }, updatedAt: new Date().toISOString(),
          deviceId: 'device-from-another-browser',
        }],
        lastSeq: 1, pending: 0, updateSeq: 1, filterId: null,
      }),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    fireEvent.click(await screen.findByText('Pull'));

    await waitFor(() => expect(localStoreMock.applyServerChange).toHaveBeenCalledWith(
      'note:remote1', '1-remote', { title: 'from another device' }, false, 'device-from-another-browser',
    ));
  });

  it('backward compatible: a pulled change with no deviceId field applies with null, not a crash', async () => {
    wireLensRun({
      'offline.replicationPull': () => ok({
        changes: [{
          seq: 1, id: 'note:legacy1', rev: '1-legacy', deleted: false,
          doc: { title: 'pre-existing feature revision' }, updatedAt: new Date().toISOString(),
          // no deviceId — simulates a revision written before this feature existed
        }],
        lastSeq: 1, pending: 0, updateSeq: 1, filterId: null,
      }),
    });
    render(<ReplicationPanel onConflicts={vi.fn()} />);
    fireEvent.click(await screen.findByText('Pull'));

    await waitFor(() => expect(localStoreMock.applyServerChange).toHaveBeenCalledWith(
      'note:legacy1', '1-legacy', { title: 'pre-existing feature revision' }, false, null,
    ));
  });
});
