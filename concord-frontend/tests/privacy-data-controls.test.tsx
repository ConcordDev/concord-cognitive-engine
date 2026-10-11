import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { collapseAccessEvents } from '@/components/privacy/DataControlsPanel';

const apiGet = vi.fn();
const apiPost = vi.fn();
const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { DataControlsPanel } from '@/components/privacy/DataControlsPanel';

const DTU_ID = 'dtu-created-during-test';

function lensOk(result: unknown) {
  return { data: { ok: true, result } };
}

let dsars: Array<Record<string, unknown>>;
let shares: Array<{ lensId: string; read: boolean; share: boolean }>;
let flows: Array<Record<string, unknown>>;
let policies: Array<{ category: string; windowDays: number; action: string; isDefault: boolean }>;
let blobs: string[];

function cookieConfig() {
  return {
    bannerEnabled: true,
    position: 'bottom',
    defaultState: 'opt_in',
    categories: {
      essential: { enabled: true, locked: true },
      functional: { enabled: false, locked: false },
      analytics: { enabled: false, locked: false },
      advertising: { enabled: false, locked: false },
    },
    consentString: 'abc',
    updatedAt: 1,
  };
}

beforeEach(() => {
  dsars = [];
  shares = [{ lensId: 'chat', read: true, share: false }];
  flows = [];
  policies = [{ category: 'chat_logs', windowDays: 30, action: 'delete', isDefault: true }];
  blobs = [];
  apiGet.mockReset();
  apiPost.mockReset();
  lensRunMock.mockReset();

  apiGet.mockImplementation(async (url: string) => {
    if (url === '/api/account/deletion') return { data: { ok: true, scheduled: false } };
    if (url === '/api/account/export') {
      return {
        data: {
          user: { id: 'user-a', username: 'ada' },
          dtus: [{ id: DTU_ID, title: 'Created during the test' }],
          chats: { sessions: [{ session_id: 'sess-a' }], messages: [] },
          sessions: { auth: [], lens: [] },
          settings: { preferences: { theme: 'dark' } },
          privacy: { spec: 'concord-privacy-export/v1', userId: 'user-a' },
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });

  apiPost.mockImplementation(async (url: string) => {
    if (url === '/api/account/delete') {
      return {
        data: {
          ok: true,
          scheduled: true,
          graceDays: 7,
          balance: 0,
          forfeitDate: '2026-10-18 00:00:00',
          detail: 'Account deletion scheduled. You have 7 days to cancel.',
        },
      };
    }
    if (url === '/api/account/cancel-deletion') return { data: { ok: true, cancelled: true } };
    return { data: { ok: true } };
  });

  lensRunMock.mockImplementation(async (_domain: string, name: string, input: Record<string, unknown> = {}) => {
    switch (name) {
      case 'accessLog':
        return lensOk({
          events: [1, 2, 3].map((at) => ({
            id: `e-${at}`,
            at,
            actor: 'system',
            actorKind: 'system',
            lensId: 'privacy',
            dataCategory: 'profile',
            operation: 'read',
          })),
          totalEvents: 3,
          byActor: { system: 3 },
          byOperation: { read: 3 },
        });
      case 'dsarList':
        return lensOk({
          requests: dsars,
          totalRequests: dsars.length,
          openCount: dsars.filter((r) => r.status !== 'completed' && r.status !== 'rejected').length,
          overdueCount: dsars.length > 0 ? 1 : 0,
        });
      case 'dsarSubmit':
        dsars.push({
          id: 'dsar-1',
          kind: input.kind,
          note: input.note,
          status: 'received',
          submittedAt: 1_700_000_000_000,
          dueAt: 1_700_100_000_000,
          resolvedAt: null,
          history: [],
        });
        return lensOk({ totalRequests: dsars.length });
      case 'dsarAdvance': {
        const row = dsars.find((r) => r.id === input.dsarId);
        if (row) row.status = input.status;
        return lensOk({});
      }
      case 'lensSharingGet':
        return lensOk({
          lenses: shares,
          readEnabled: shares.filter((s) => s.read).length,
          shareEnabled: shares.filter((s) => s.share).length,
        });
      case 'lensSharingSet': {
        const row = shares.find((s) => s.lensId === input.lensId);
        if (row && typeof input.share === 'boolean') row.share = input.share;
        if (row && typeof input.read === 'boolean') row.read = input.read;
        return lensOk({});
      }
      case 'flowMap':
        return lensOk({
          flows,
          graph: { nodes: [], edges: [] },
          outboundCount: flows.filter((f) => f.direction === 'outbound').length,
          inboundCount: flows.filter((f) => f.direction === 'inbound').length,
        });
      case 'flowRegister':
        flows.push({
          id: 'flow-1',
          destination: input.destination,
          destinationKind: 'federation',
          dataCategory: 'profile',
          direction: input.direction,
          purpose: 'sync',
          active: true,
        });
        return lensOk({});
      case 'flowToggle': {
        const row = flows.find((f) => f.id === input.flowId);
        if (row) row.active = input.active;
        return lensOk({});
      }
      case 'cookieConfigGet':
      case 'cookieConfigSet':
        return lensOk({ config: cookieConfig() });
      case 'retentionGet':
        return lensOk({ policies });
      case 'retentionSet': {
        const row = policies.find((p) => p.category === input.category);
        if (row) {
          row.windowDays = Number(input.windowDays);
          row.action = String(input.action);
        }
        return lensOk({});
      }
      default:
        return { data: { ok: false, error: `unmocked ${name}` } };
    }
  });

  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      const index = blobs.push('') - 1;
      void blob.text().then((text) => { blobs[index] = text; });
      return 'blob:mock';
    },
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('collapseAccessEvents', () => {
  it('folds repeated system reads into one row', () => {
    const collapsed = collapseAccessEvents([
      { id: '1', at: 1, actor: 'system', actorKind: 'system', lensId: 'privacy', dataCategory: 'a', operation: 'read' },
      { id: '2', at: 2, actor: 'system', actorKind: 'system', lensId: 'privacy', dataCategory: 'b', operation: 'read' },
      { id: '3', at: 3, actor: 'ada', actorKind: 'user', lensId: 'chat', dataCategory: 'c', operation: 'write' },
    ]);
    expect(collapsed).toHaveLength(2);
    expect(collapsed.find((e) => e.actor === 'system')?.count).toBe(2);
    expect(collapsed[0].actor).toBe('ada');
  });
});

describe('DataControlsPanel', () => {
  it('downloads the account export, including a DTU created for this user', async () => {
    render(<DataControlsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(blobs.some((b) => b.includes(DTU_ID))).toBe(true));
    const file = JSON.parse(blobs.find((b) => b.includes(DTU_ID))!);
    expect(file.dtus.map((d: { id: string }) => d.id)).toContain(DTU_ID);
    expect(file.chats.sessions[0].session_id).toBe('sess-a');
    expect(file.settings.preferences.theme).toBe('dark');
    expect(apiGet).toHaveBeenCalledWith('/api/account/export');
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'dataExport')).toBe(false);
    expect(await screen.findByText('Saved 1 DTU.')).toBeTruthy();
  });

  it('refuses a privacy-only body that has no DTU list', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/account/deletion') return { data: { ok: true, scheduled: false } };
      return { data: { counts: { dsars: 0 }, bundle: { privacy: true } } };
    });
    render(<DataControlsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByText('Export did not include your DTUs.')).toBeTruthy();
    expect(blobs.filter(Boolean)).toHaveLength(0);
  });

  it('groups the activity log instead of listing every system read', async () => {
    render(<DataControlsPanel />);
    fireEvent.click(screen.getByText('Activity log'));
    expect(await screen.findByTitle('system · read × 3')).toBeTruthy();
    expect(screen.queryAllByTitle('system · read')).toHaveLength(0);
    expect(screen.getByText('read: 3')).toBeTruthy();
  });

  it('schedules deletion and cancels it', async () => {
    render(<DataControlsPanel />);
    const input = screen.getByPlaceholderText('Type DELETE_MY_ACCOUNT to confirm');
    fireEvent.change(input, { target: { value: 'DELETE_MY_ACCOUNT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule account deletion' }));
    expect(await screen.findByRole('button', { name: 'Cancel Scheduled Deletion' })).toBeTruthy();
    expect(apiPost).toHaveBeenCalledWith('/api/account/delete', { confirm: 'DELETE_MY_ACCOUNT' });
    expect(screen.getByText(/balance 0 CC/)).toBeTruthy();
    expect(screen.getByText(/You have 7 days to cancel/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Scheduled Deletion' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/account/cancel-deletion', {}));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel Scheduled Deletion' })).toBeNull());
  });

  it('shows a pending deletion loaded from the server', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/account/deletion') {
        return { data: { ok: true, scheduled: true, balance: 0, forfeitDate: '2026-10-18 00:00:00' } };
      }
      return { data: { dtus: [] } };
    });
    render(<DataControlsPanel />);
    expect(await screen.findByRole('button', { name: 'Cancel Scheduled Deletion' })).toBeTruthy();
  });

  it('tracks a data request, a sharing change, and a flow', async () => {
    render(<DataControlsPanel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Requests' }));
    expect(await screen.findByText('No requests yet.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Optional note for the request…'), { target: { value: 'please' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(await screen.findByText('Start review')).toBeTruthy();
    expect(screen.getByText('1 overdue')).toBeTruthy();
    fireEvent.click(screen.getByText('Start review'));
    await waitFor(() => expect(dsars[0]?.status).toBe('in_review'));

    fireEvent.click(screen.getByRole('tab', { name: 'Sharing' }));
    const share = await screen.findByRole('checkbox', { name: 'share' });
    fireEvent.click(share);
    await waitFor(() => expect(shares[0].share).toBe(true));

    fireEvent.click(screen.getByRole('tab', { name: 'Flows' }));
    expect(await screen.findByText('No data flows registered yet.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Federation peer / destination…'), { target: { value: 'peer.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register Flow' }));
    expect((await screen.findAllByText(/peer\.example/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'active' }));
    await waitFor(() => expect(flows[0].active).toBe(false));

    expect(await screen.findByText(/consent string: abc/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Banner enabled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Banner' }));
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'cookieConfigSet')).toBe(true));

    fireEvent.change(screen.getByRole('spinbutton', { name: 'chat_logs window days' }), { target: { value: '14' } });
    await waitFor(() => expect(policies[0].windowDays).toBe(14));
    fireEvent.change(screen.getByRole('combobox', { name: 'chat_logs action' }), { target: { value: 'anonymize' } });
    await waitFor(() => expect(policies[0].action).toBe('anonymize'));
  });
});
