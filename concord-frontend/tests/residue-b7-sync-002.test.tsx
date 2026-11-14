/**
 * RESIDUE B7 — FIX-sync-002: a quota (or auto-sync) change attempted
 * while offline died as a bare 'Failed: Network Error' — never saved,
 * never queued, and the dashboard later showed the old value with no
 * word the change was lost. Network-class failures now queue the change
 * in localStorage, the queue is banner-stated as NOT saved yet, and it
 * replays on reconnect / mount. Non-network refusals still fail loudly
 * and queue nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const { lensRunMock } = vi.hoisted(() => ({ lensRunMock: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRunMock(...args) }));
vi.mock('@/hooks/useSmartPolling', () => ({ useSmartPolling: () => {} }));

import { SyncDashboard } from '@/components/sync/SyncDashboard';

const GB = 1024 ** 3;
const device = {
  id: 'dev1', label: 'Laptop', autoSync: true, online: true,
  lastSeenAt: Date.now(), lastSyncAt: Date.now(), lastSyncStatus: 'synced',
  scopes: [], quotaBytes: 50 * GB, usedBytes: 1 * GB, quotaPct: 2,
  dtusSynced: 3, revoked: false,
};
const status = {
  deviceCount: 1, onlineCount: 1, lastSyncAt: Date.now(), dtusSynced: 3,
  usedBytes: 1 * GB, quotaBytes: 50 * GB, quotaPct: 2, openConflicts: 0, state: 'online',
};

let quotaFailsWithNetwork = true;
function wireLensRun() {
  lensRunMock.mockImplementation(async (_domain: string, action: string) => {
    switch (action) {
      case 'list_devices': return { data: { ok: true, result: { devices: [device] } } };
      case 'sync_status': return { data: { ok: true, result: status } };
      case 'list_conflicts': return { data: { ok: true, result: { conflicts: [] } } };
      case 'sync_history': return { data: { ok: true, result: { entries: [] } } };
      case 'available_scopes': return { data: { ok: true, result: { scopes: [] } } };
      case 'set_quota':
        return quotaFailsWithNetwork
          ? { data: { ok: false, error: 'Network Error', result: null } }
          : { data: { ok: true, result: {} } };
      default: return { data: { ok: true, result: {} } };
    }
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
  localStorage.clear();
  quotaFailsWithNetwork = true;
  wireLensRun();
});

describe('FIX-sync-002 — offline settings changes queue instead of vanishing', () => {
  it('a network-failed quota save queues, banners as unsaved, and replays on reconnect', async () => {
    render(<SyncDashboard />);
    await waitFor(() => expect(screen.getByText(/edit quota/)).toBeTruthy());

    fireEvent.click(screen.getByText(/edit quota/));
    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Queued + stated as not saved yet.
    await waitFor(() => expect(screen.getByText(/change queued — not saved yet/)).toBeTruthy());
    const stored = JSON.parse(localStorage.getItem('concord-sync-pending-settings') || '[]');
    expect(stored).toEqual([{ kind: 'quota', deviceId: 'dev1', quotaGb: 100 }]);

    // Reconnect: the queued change replays and the banner clears.
    quotaFailsWithNetwork = false;
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(screen.queryByText(/change queued — not saved yet/)).toBeNull());
    const quotaCalls = lensRunMock.mock.calls.filter((c) => c[1] === 'set_quota');
    expect(quotaCalls.length).toBe(2);
    expect(quotaCalls[1][2]).toEqual({ deviceId: 'dev1', quotaGb: 100 });
  });

  it('a server refusal queues nothing and fails loudly', async () => {
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'set_quota') return { data: { ok: false, error: 'quota_too_large', result: null } };
      return wireLensRunFallback(action);
    });
    render(<SyncDashboard />);
    await waitFor(() => expect(screen.getByText(/edit quota/)).toBeTruthy());
    fireEvent.click(screen.getByText(/edit quota/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText(/Failed: quota_too_large/)).toBeTruthy());
    const stored = JSON.parse(localStorage.getItem('concord-sync-pending-settings') || '[]');
    expect(stored).toEqual([]);
  });
});

function wireLensRunFallback(action: string) {
  switch (action) {
    case 'list_devices': return { data: { ok: true, result: { devices: [device] } } };
    case 'sync_status': return { data: { ok: true, result: status } };
    case 'list_conflicts': return { data: { ok: true, result: { conflicts: [] } } };
    case 'sync_history': return { data: { ok: true, result: { entries: [] } } };
    case 'available_scopes': return { data: { ok: true, result: { scopes: [] } } };
    default: return { data: { ok: true, result: {} } };
  }
}
