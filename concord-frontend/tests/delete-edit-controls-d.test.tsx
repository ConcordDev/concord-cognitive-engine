/**
 * Audit sweep CB-0447, cluster D — FE pins for the missing edit/clear
 * controls: FIX-carpentry-010 (time-entry + invoice edit in JobOps),
 * FIX-parenting-010 (child edit in ParentingSection),
 * FIX-photography-001 (shoot edit in LightroomCollectionsPanel) and
 * FIX-sync-009 (clear history in SyncDashboard). Each edit loads the
 * record into the lens's own create form and saves through the new
 * update verb; the sync clear rides the family's two-step confirm and
 * fires nothing until confirmed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

type Handler = (domain: string, action: string, input: Record<string, unknown>) => unknown;
const ok = (result: unknown) => ({ data: { ok: true, result, error: null } });
let handler: Handler = () => ok({});
const calls: { domain: string; action: string; input: Record<string, unknown> }[] = [];

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    calls.push({ domain, action, input });
    return handler(domain, action, input);
  }),
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
  TimelineView: ({ events }: { events: { id: string; label: string }[] }) =>
    React.createElement('div', null, events.map((e) => React.createElement('span', { key: e.id }, e.label))),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/components/common/LookupNotice', () => ({ LookupNotice: () => null }));
vi.mock('@/lib/public-lookup', () => ({
  wikiSummary: vi.fn(async (species: string) => ({
    title: species, description: 'Genus of trees', extract: `About ${species}.`,
    content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${species}` } },
  })),
  lookupMeta: () => null,
}));
vi.mock('@/hooks/useSmartPolling', () => ({ useSmartPolling: () => {} }));

import { JobOps } from '@/components/carpentry/JobOps';
import { ParentingSection } from '@/components/parenting/ParentingSection';
import { LightroomCollectionsPanel } from '@/components/photography/LightroomCollectionsPanel';
import { SyncDashboard } from '@/components/sync/SyncDashboard';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => { calls.length = 0; handler = () => ok({}); });

const TIME_ENTRY = { id: 'time_1', jobId: 'job-1', jobName: 'Deck build', hours: 2, rate: 50, cost: 100, source: 'manual' };
const INVOICE = {
  id: 'inv_1', invoiceNumber: 'INV-1001', estimateId: 'est_1', client: 'Pat Client',
  subtotal: 1100, tax: 0, total: 1100, depositPct: 25, depositDue: 275, status: 'issued',
  signature: { signedBy: 'Pat Client', decision: 'approved' },
};

describe('carpentry JobOps edits (FIX-carpentry-010)', () => {
  it('a time entry edits hours/rate in place via timeEntryUpdate', async () => {
    handler = (_d, action) => {
      if (action === 'timeEntryList') return ok({ entries: [TIME_ENTRY], running: [], totalHours: 2, totalCost: 100, byJob: [] });
      if (action === 'crewList') return ok({ members: [] });
      if (action === 'scheduleList') return ok({ entries: [] });
      if (action === 'photoLogList') return ok({ entries: [] });
      if (action === 'invoiceList') return ok({ invoices: [], outstanding: 0, collected: 0 });
      if (action === 'portalList') return ok({ shares: [] });
      return ok({});
    };
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Time/ }));
    await screen.findByText(/Deck build/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit entry for Deck build' }));
    fireEvent.change(screen.getByLabelText('Hours for Deck build'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = calls.find((c) => c.action === 'timeEntryUpdate');
      expect(call).toBeTruthy();
      expect(call?.input).toMatchObject({ id: 'time_1', hours: 3, rate: 50 });
    });
  });

  it('an invoice edits client/amount in place via invoiceUpdate', async () => {
    handler = (_d, action) => {
      if (action === 'timeEntryList') return ok({ entries: [], running: [], totalHours: 0, totalCost: 0, byJob: [] });
      if (action === 'crewList') return ok({ members: [] });
      if (action === 'scheduleList') return ok({ entries: [] });
      if (action === 'photoLogList') return ok({ entries: [] });
      if (action === 'invoiceList') return ok({ invoices: [INVOICE], outstanding: 825, collected: 0 });
      if (action === 'portalList') return ok({ shares: [] });
      return ok({});
    };
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Invoicing/ }));
    await screen.findByText(/INV-1001/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit INV-1001' }));
    fireEvent.change(screen.getByLabelText('Client for INV-1001'), { target: { value: 'Patricia' } });
    fireEvent.change(screen.getByLabelText('Amount for INV-1001'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = calls.find((c) => c.action === 'invoiceUpdate');
      expect(call).toBeTruthy();
      expect(call?.input).toMatchObject({ id: 'inv_1', client: 'Patricia', amount: 2000 });
    });
  });
});

describe('parenting child edit (FIX-parenting-010)', () => {
  it('the roster Edit loads the child into the form and Save fires child-update', async () => {
    const CHILD = {
      id: 'kid_1', name: 'Ada', birthDate: '2024-01-15', sex: 'girl',
      ageDisplay: '1 yr 10 mo', ageMonths: 22, vaccinesReceived: [], shared: false,
    };
    handler = (_d, action) => {
      if (action === 'child-list') return ok({ children: [CHILD], count: 1 });
      return ok({});
    };
    wrap(<ParentingSection />);
    await screen.findByText(/Ada · 1 yr 10 mo/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Ada' }));
    await screen.findByText(/Editing Ada/);
    fireEvent.change(screen.getByPlaceholderText('Child name'), { target: { value: 'Ada L' } });
    fireEvent.click(screen.getByRole('button', { name: /Save child/ }));
    await waitFor(() => {
      const call = calls.find((c) => c.action === 'child-update');
      expect(call).toBeTruthy();
      expect(call?.input).toMatchObject({ id: 'kid_1', name: 'Ada L', birthDate: '2024-01-15', sex: 'girl' });
    });
  });
});

describe('photography shoot edit (FIX-photography-001)', () => {
  it('a shoot row Edit loads the shoot form and Save fires shoot-update', async () => {
    const SHOOT = { id: 'sht_1', name: 'Roll 1', date: '2026-10-01', location: 'Studio', photoCount: 3 };
    handler = (_d, action) => {
      if (action === 'album-list') return ok({ albums: [] });
      if (action === 'shoot-list') return ok({ shoots: [SHOOT], count: 1 });
      if (action === 'photo-list') return ok({ photos: [] });
      return ok({});
    };
    wrap(<LightroomCollectionsPanel onChange={() => {}} />);
    await screen.findByText('Roll 1');
    fireEvent.click(screen.getByRole('button', { name: 'Edit shoot Roll 1' }));
    fireEvent.change(screen.getByPlaceholderText('Shoot name'), { target: { value: 'Roll 1 — selects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = calls.find((c) => c.action === 'shoot-update');
      expect(call).toBeTruthy();
      expect(call?.input).toMatchObject({ rollId: 'sht_1', name: 'Roll 1 — selects', date: '2026-10-01', location: 'Studio' });
    });
  });
});

describe('sync clear history (FIX-sync-009)', () => {
  it('the two-step Clear in the activity header fires clear_history only on confirm', async () => {
    const LOG = { id: 'log_1', at: Date.now(), kind: 'device_registered', label: 'Phone', message: 'Registered Phone' };
    let cleared = false;
    handler = (_d, action) => {
      if (action === 'list_devices') return ok({ devices: [], count: 0 });
      if (action === 'sync_status') return ok({
        deviceCount: 0, onlineCount: 0, lastSyncAt: null, dtusSynced: 0,
        usedBytes: 0, quotaBytes: 0, quotaPct: 0, openConflicts: 0, state: 'no_devices',
      });
      if (action === 'list_conflicts') return ok({ conflicts: [] });
      if (action === 'sync_history') return ok(cleared ? { entries: [], total: 0 } : { entries: [LOG], total: 1 });
      if (action === 'available_scopes') return ok({ scopes: [] });
      if (action === 'clear_history') { cleared = true; return ok({ cleared: 1, total: 0 }); }
      return ok({});
    };
    wrap(<SyncDashboard />);
    const arm = await screen.findByRole('button', { name: 'Clear sync activity history' });
    fireEvent.click(arm);
    expect(calls.some((c) => c.action === 'clear_history')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm clear sync activity history' }));
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'clear_history')).toBe(true);
    });
  });
});
