/// <reference types="@testing-library/jest-dom/vitest" />
// ConflictMergePanel — multi-device conflict provenance (Wave-4 gap closure,
// docs/lens-specs/offline-capability-map.md "Multi-device conflict provenance
// (which device wrote which revision) ... GENUINELY MISSING" item). Pins:
// each side of a conflict renders "written by device X" from the real
// serverDeviceId/clientDeviceId fields (honest "unknown device" when absent,
// never a fabricated label), and resolving a conflict sends this browser's
// real persisted device id through `offline.mergeResolve` and reconciles the
// local store with it — the same real dispatch path the sibling
// ReplicationPanelFilters.test.tsx exercises for the filtered-replication
// feature.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Real IndexedDB isn't available in jsdom by default — mock the local-store
// write-through layer, same pattern as ReplicationPanelFilters.test.tsx.
// getDeviceId is mocked here (not the real localStorage-backed one) so tests
// can assert the exact id sent through the resolve flow deterministically.
const markCleanMock = vi.fn(async () => undefined);
const getDeviceIdMock = vi.fn(() => 'device-under-test-1234');
vi.mock('@/components/offline/local-store', () => ({
  markClean: (...args: unknown[]) => markCleanMock(...args),
  getDeviceId: () => getDeviceIdMock(),
}));

import { ConflictMergePanel, type Conflict } from '@/components/offline/ConflictMergePanel';

function ok<T>(result: T) {
  return { data: { ok: true, result, error: null } };
}
function fail(error: string) {
  return { data: { ok: false, result: null, error } };
}

// deviceLabel() renders the last 8 characters of the real id — pick ids of
// exactly 8 chars here so the expected rendered label is unambiguous instead
// of hand-computing a slice(-8) result.
const BASE_CONFLICT: Conflict = {
  id: 'note:conflict1',
  serverRev: '2-aaaa1111',
  serverBody: { title: 'server version' },
  serverDeviceId: 'laptopAA',
  clientRev: '1-bbbb2222',
  clientBody: { title: 'client version' },
  clientDeviceId: 'phoneBBB',
  reason: 'rev_mismatch',
};

describe('ConflictMergePanel — device provenance rendering', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    markCleanMock.mockClear();
    getDeviceIdMock.mockClear();
  });

  it('renders "written by device X" for both the server and client side using the real ids', () => {
    render(<ConflictMergePanel conflicts={[BASE_CONFLICT]} onResolved={vi.fn()} />);
    expect(screen.getByText(/written by device laptopaa/i)).toBeInTheDocument();
    expect(screen.getByText(/written by device phonebbb/i)).toBeInTheDocument();
  });

  it('renders an honest "unknown device" label — never a fabricated id — when deviceId is absent', () => {
    const conflict: Conflict = {
      ...BASE_CONFLICT,
      id: 'note:conflict-nodev',
      serverDeviceId: null,
      clientDeviceId: undefined,
    };
    render(<ConflictMergePanel conflicts={[conflict]} onResolved={vi.fn()} />);
    const unknownLabels = screen.getAllByText(/written by unknown device/i);
    expect(unknownLabels.length).toBe(2);
  });

  it('renders a shortened, non-fabricated tail of a long device id', () => {
    const conflict: Conflict = {
      ...BASE_CONFLICT,
      id: 'note:conflict-longid',
      serverDeviceId: '3f9a7c21-8b44-4e2d-9c11-abcdef123456',
    };
    render(<ConflictMergePanel conflicts={[conflict]} onResolved={vi.fn()} />);
    // Real tail of the real id (last 8 chars), not an invented label.
    expect(screen.getByText(/written by device ef123456/i)).toBeInTheDocument();
  });
});

describe('ConflictMergePanel — resolving sends this device\'s real id', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    markCleanMock.mockClear();
    getDeviceIdMock.mockClear();
  });

  it('sends the persisted device id through offline.mergeResolve on "Keep server"', async () => {
    lensRunMock.mockResolvedValue(
      ok({ id: 'note:conflict1', rev: '3-cccc3333', seq: 5, winner: 'server', resolvedBody: { title: 'server version' }, deviceId: 'device-under-test-1234' }),
    );
    render(<ConflictMergePanel conflicts={[BASE_CONFLICT]} onResolved={vi.fn()} />);

    fireEvent.click(screen.getByText('Keep server'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'offline', 'mergeResolve',
      expect.objectContaining({ id: 'note:conflict1', winner: 'server', deviceId: 'device-under-test-1234' }),
    ));
  });

  it('reconciles the local store via markClean with the RESOLVER device id the server echoed back', async () => {
    lensRunMock.mockResolvedValue(
      ok({ id: 'note:conflict1', rev: '3-dddd4444', seq: 6, winner: 'client', resolvedBody: { title: 'client version' }, deviceId: 'device-under-test-1234' }),
    );
    const onResolved = vi.fn();
    render(<ConflictMergePanel conflicts={[BASE_CONFLICT]} onResolved={onResolved} />);

    fireEvent.click(screen.getByText('Keep client'));

    await waitFor(() => expect(markCleanMock).toHaveBeenCalledWith(
      'note:conflict1', '3-dddd4444', false, 'device-under-test-1234',
    ));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('note:conflict1'));
  });

  it('falls back to the locally-known device id when the server response omits deviceId (older-server backward compat)', async () => {
    lensRunMock.mockResolvedValue(
      // Simulates a server that hasn't been upgraded yet — no deviceId field at all.
      ok({ id: 'note:conflict1', rev: '3-eeee5555', seq: 7, winner: 'server', resolvedBody: { title: 'server version' } }),
    );
    render(<ConflictMergePanel conflicts={[BASE_CONFLICT]} onResolved={vi.fn()} />);

    fireEvent.click(screen.getByText('Keep server'));

    await waitFor(() => expect(markCleanMock).toHaveBeenCalledWith(
      'note:conflict1', '3-eeee5555', false, 'device-under-test-1234',
    ));
  });

  it('surfaces a real server error and does not call markClean when mergeResolve fails', async () => {
    lensRunMock.mockResolvedValue(fail('doc id required'));
    render(<ConflictMergePanel conflicts={[BASE_CONFLICT]} onResolved={vi.fn()} />);

    fireEvent.click(screen.getByText('Keep server'));

    expect(await screen.findByText('doc id required')).toBeInTheDocument();
    expect(markCleanMock).not.toHaveBeenCalled();
  });

  it('commits a hand-merged body and still sends this device\'s id', async () => {
    lensRunMock.mockResolvedValue(
      ok({ id: 'note:conflict1', rev: '3-ffff6666', seq: 8, winner: 'merged', resolvedBody: { title: 'merged version' }, deviceId: 'device-under-test-1234' }),
    );
    render(<ConflictMergePanel conflicts={[BASE_CONFLICT]} onResolved={vi.fn()} />);

    fireEvent.click(screen.getByText('Commit merge'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'offline', 'mergeResolve',
      expect.objectContaining({ id: 'note:conflict1', winner: 'merged', deviceId: 'device-under-test-1234' }),
    ));
  });
});
