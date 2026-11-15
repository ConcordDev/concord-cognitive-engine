// Privacy dedicated-set FE pins:
//  FIX-privacy-001/010 — the DPO studio's Inventory and Consent tools
//  load the caller's persisted working sets (privacy.dpoGet), start
//  empty (no seeded demo rows), and persist adds through dpoSet.
//  FIX-privacy-002 — the retention days field commits a typed in-range
//  value as typed, and an out-of-range value is never sent to the
//  server (it shows the range inline instead of landing as a silent
//  clamp to the max).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      if (url === '/api/account/deletion') return { data: { ok: true, scheduled: false } };
      if (url === '/api/account/export') {
        return { data: { user: { id: 'user-a', username: 'ada' }, dtus: [], chats: { sessions: [], messages: [] }, sessions: { auth: [], lens: [] }, settings: {}, privacy: {} } };
      }
      return { data: { ok: true } };
    }),
    post: vi.fn(async () => ({ data: { ok: true } })),
  },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { DpoStudioPanel } from '@/components/privacy/DpoStudioPanel';
import { DataControlsPanel } from '@/components/privacy/DataControlsPanel';

function lensOk(result: unknown) {
  return { data: { ok: true, result } };
}

describe('DPO studio working sets (FIX-privacy-001/010)', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('starts empty — no seeded demo rows — when the caller has saved nothing', async () => {
    lensRunMock.mockImplementation(async (_d: string, name: string) => {
      if (name === 'dpoGet') return lensOk({ inventory: [], consents: [] });
      return lensOk({});
    });
    render(<DpoStudioPanel />);
    expect(await screen.findByText(/no data items/i)).toBeTruthy();
    expect(screen.queryByText('health_record')).toBeNull();
    expect(screen.queryByText('user_1042')).toBeNull();
  });

  it('loads the caller’s saved inventory and persists an added category via dpoSet', async () => {
    let saved: Array<{ category: string; sensitive: boolean }> = [{ category: 'email', sensitive: false }];
    lensRunMock.mockImplementation(async (_d: string, name: string, input: Record<string, unknown> = {}) => {
      if (name === 'dpoGet') return lensOk({ inventory: saved, consents: [] });
      if (name === 'dpoSet') { saved = input.items as typeof saved; return lensOk({}); }
      return lensOk({});
    });
    render(<DpoStudioPanel />);
    expect(await screen.findByText('email')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/data category/i), { target: { value: 'ip_address' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(saved.map((x) => x.category)).toEqual(['email', 'ip_address']));
    const setCall = lensRunMock.mock.calls.find((c) => c[1] === 'dpoSet');
    expect(setCall?.[2]).toMatchObject({ which: 'inventory' });
  });
});

describe('retention days field (FIX-privacy-002)', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('commits an in-range typed value as typed; an out-of-range value is never sent', async () => {
    const policies = [{ category: 'chat_history', windowDays: 365, action: 'delete', isDefault: false }];
    const setCalls: Array<Record<string, unknown>> = [];
    lensRunMock.mockImplementation(async (_d: string, name: string, input: Record<string, unknown> = {}) => {
      switch (name) {
        case 'retentionGet': return lensOk({ policies });
        case 'retentionSet': setCalls.push(input); return lensOk({ category: input.category, windowDays: input.windowDays, action: input.action });
        case 'accessLog': return lensOk({ events: [], totalEvents: 0, byActor: {}, byOperation: {} });
        case 'flowMap': return lensOk({ flows: [], graph: { nodes: [], edges: [] }, outboundCount: 0, inboundCount: 0 });
        case 'dsarList': return lensOk({ requests: [], totalRequests: 0, openCount: 0, overdueCount: 0 });
        case 'lensSharingGet': return lensOk({ lenses: [], readEnabled: 0, shareEnabled: 0 });
        case 'cookieConfigGet': return lensOk({ config: { bannerEnabled: false, position: 'bottom', defaultState: 'opt_in', categories: { essential: { enabled: true, locked: true }, functional: { enabled: false, locked: false }, analytics: { enabled: false, locked: false }, advertising: { enabled: false, locked: false } }, consentString: '', updatedAt: 0 } });
        default: return lensOk({});
      }
    });
    render(<DataControlsPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'Flows' }));
    const input = await screen.findByRole('spinbutton', { name: 'chat_history window days' });

    fireEvent.change(input, { target: { value: '400' } });
    await waitFor(() => expect(setCalls.some((c) => c.windowDays === 400)).toBe(true));

    const before = setCalls.length;
    fireEvent.change(input, { target: { value: '36500' } });
    expect(await screen.findByText(/enter 0–3650 days/i)).toBeTruthy();
    expect(setCalls.length).toBe(before); // never sent — no silent clamp to the max
  });
});
