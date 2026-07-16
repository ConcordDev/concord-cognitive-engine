/**
 * SyncDashboard — "Download portable pack" per-device action.
 *
 * Wave-4 gap closure (docs/WAVE4_INVENTORY.md row 317,
 * docs/lens-specs/sync-capability-map.md): the sync lens's `sync_now`
 * reported a real DTU count + byte estimate but never produced a
 * downloadable, hash-verifiable pack the way `dtu_sync.force_sync` /
 * `dtu_portability.export` already do. This pins the new frontend wiring
 * against the REAL `sync.export_pack` macro shape (mocked at the
 * `lensRun()` boundary only — no network):
 *
 *   1. The button renders per device.
 *   2. Clicking it calls `sync.export_pack` with the real deviceId.
 *   3. A successful call triggers a genuine browser download (Blob +
 *      anchor-click, via the shared `downloadFile` helper from
 *      `@/lib/utils` — not a duplicated download mechanism).
 *   4. A failed call surfaces the real error honestly and never fires the
 *      download mechanism (no fake "downloaded!" state).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { SyncDashboard } from '@/components/sync/SyncDashboard';

const DEVICE = {
  id: 'dev_abc123',
  label: 'MacBook Pro',
  autoSync: true,
  online: true,
  lastSeenAt: Date.now(),
  lastSyncAt: null,
  lastSyncStatus: 'never',
  scopes: ['personal', 'public', 'artifacts'],
  quotaBytes: 50 * 1024 ** 3,
  usedBytes: 0,
  quotaPct: 0,
  dtusSynced: 0,
  revoked: false,
};

// Real envelope shape per server/lib/dtu-portability.js#exportUserCorpus,
// as returned by sync.export_pack.
const EXPORT_RESULT = {
  deviceId: DEVICE.id,
  scoped: false,
  deviceScopes: DEVICE.scopes,
  note: 'This is your full portable pack — the real, SHA-256-hashed envelope also produced by dtu_sync.force_sync / dtu_portability.export. It is NOT filtered to this device\'s selective-sync scopes.',
  envelope: {
    spec: 'concord-dtu-pack/v1',
    exported_at: 1700000000,
    creator_id: 'u1',
    instance_signature: 'abc123',
    dtus: [{ id: 'dtu:1', kind: 'knowledge', title: 'My real thought', creator_id: 'u1' }],
    citations: [],
    hashes: { dtus_sha256: 'a'.repeat(64), citations_sha256: 'b'.repeat(64) },
    counts: { dtus: 1, citations: 0, economy: 0, attachments: 0 },
  },
  counts: { dtus: 1, citations: 0, economy: 0, attachments: 0 },
  logEntry: { id: 'log_1', at: Date.now(), kind: 'pack_exported', deviceId: DEVICE.id, label: DEVICE.label },
};

// Every lensRun call resolves benignly except the ones a test overrides.
function baseImpl(overrides: Record<string, (input?: unknown) => unknown> = {}) {
  return (_domain: string, action: string, input?: unknown) => {
    if (action in overrides) return Promise.resolve(overrides[action](input));
    if (action === 'list_devices') return Promise.resolve({ data: { ok: true, result: { devices: [DEVICE], count: 1 }, error: null } });
    if (action === 'sync_status') {
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            deviceCount: 1, onlineCount: 1, lastSyncAt: null, dtusSynced: 0,
            usedBytes: 0, quotaBytes: DEVICE.quotaBytes, quotaPct: 0,
            openConflicts: 0, state: 'synced',
          },
          error: null,
        },
      });
    }
    if (action === 'list_conflicts') return Promise.resolve({ data: { ok: true, result: { conflicts: [], open: 0, resolved: 0 }, error: null } });
    if (action === 'sync_history') return Promise.resolve({ data: { ok: true, result: { entries: [], timeline: [], total: 0 }, error: null } });
    if (action === 'available_scopes') return Promise.resolve({ data: { ok: true, result: { scopes: [] }, error: null } });
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

async function renderDashboard() {
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(React.createElement(SyncDashboard)); });
  await waitFor(() => expect(view!.getByText('Download portable pack')).toBeInTheDocument());
  return view!;
}

beforeEach(() => {
  lensRunMock.mockReset();
  vi.restoreAllMocks();
});

describe('SyncDashboard — Download portable pack', () => {
  it('renders the button for a registered device', async () => {
    lensRunMock.mockImplementation(baseImpl());
    const view = await renderDashboard();
    expect(view.getByText('Download portable pack')).toBeInTheDocument();
  });

  it('calls sync.export_pack with the real deviceId on click', async () => {
    lensRunMock.mockImplementation(baseImpl({
      export_pack: () => ({ data: { ok: true, result: EXPORT_RESULT, error: null } }),
    }));
    const view = await renderDashboard();

    vi.spyOn(window.URL, 'createObjectURL').mockImplementation(() => 'blob:mock');
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(view.getByText('Download portable pack'));

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'export_pack');
      expect(call).toBeTruthy();
    });
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'export_pack') as [string, string, { deviceId: string }];
    const [domain, , input] = call;
    expect(domain).toBe('sync');
    expect(input.deviceId).toBe(DEVICE.id);
  });

  it('triggers a real download (Blob + anchor-click) on a successful export', async () => {
    lensRunMock.mockImplementation(baseImpl({
      export_pack: () => ({ data: { ok: true, result: EXPORT_RESULT, error: null } }),
    }));
    const view = await renderDashboard();

    const createSpy = vi.spyOn(window.URL, 'createObjectURL').mockImplementation(() => 'blob:mock');
    const revokeSpy = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(view.getByText('Download portable pack'));

    // Real download mechanism was exercised — not a fabricated success toast
    // with no actual browser download call.
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledTimes(1);
    const blobArg = createSpy.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(revokeSpy).toHaveBeenCalledTimes(1);

    // Honest success toast — reflects the REAL counts from the macro result,
    // and is explicit that this is the full (not device-scoped) corpus.
    await waitFor(() => expect(view.getByText(/Downloaded portable pack/)).toBeInTheDocument());
    expect(view.getByText(/not device-scoped/)).toBeInTheDocument();
  });

  it('surfaces an honest error and never downloads when the macro call fails', async () => {
    lensRunMock.mockImplementation(baseImpl({
      export_pack: () => ({ data: { ok: false, result: null, error: 'device_not_found' } }),
    }));
    const view = await renderDashboard();

    const createSpy = vi.spyOn(window.URL, 'createObjectURL').mockImplementation(() => 'blob:mock');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(view.getByText('Download portable pack'));

    await waitFor(() => expect(view.getByText(/Export failed: device_not_found/)).toBeInTheDocument());
    // no fake download — the mechanism must never fire on a failed call
    expect(createSpy).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
