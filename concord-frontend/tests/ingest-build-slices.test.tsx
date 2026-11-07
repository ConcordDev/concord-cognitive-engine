/**
 * Ingest full-build slices — behaviour tests (B7, F-C row 7).
 *
 * IG-S1b: the ingest banner is a FROZEN RECEIPT of the server result —
 * it no longer renders the live form's chunk count (F2: "Successfully
 * ingested 0 chunks" on a successful ingest).
 * IG-S1a: Total Ingested / History / Recent all read the caller's
 * ingested DTUs from the server (F1/F3); a Recent row opens the DTU.
 * IG-S4: connection delete and webhook token rotation are two-step
 * named confirms — never one-click (F9).
 * IG-S5: the transform editor guards unsaved rules when switching
 * connections (F11); the batch completion rate renders in the units
 * the server returns (percent, not ×100 again); entity number values
 * render, not just a count (F12).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const calls: Array<[string, string, any]> = [];
let handlers: Record<string, (input: any) => any> = {};

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (domain: string, action: string, input: any) => {
    calls.push([domain, action, input]);
    const h = handlers[`${domain}.${action}`];
    const result = h ? h(input) : {};
    return { data: { ok: true, result } };
  }),
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({
  VisionAnalyzeButton: () => null,
}));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));

import { WorkbenchPanel } from '@/components/ingest/WorkbenchPanel';
import { PipelinePanel } from '@/components/ingest/PipelinePanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function called(action: string) {
  return calls.filter(([, a]) => a === action);
}

beforeEach(() => {
  calls.length = 0;
  handlers = {};
});

const RECEIPT = {
  title: 'Field notes',
  totalChunks: 3,
  created: [
    { chunkIndex: 0, dtuId: 'dtu_aaa111' },
    { chunkIndex: 1, dtuId: 'dtu_bbb222' },
  ],
  createdCount: 2,
  deduped: [{ chunkIndex: 2, dtuId: 'dtu_ccc333' }],
  dedupedCount: 1,
  failures: 0,
};

describe('WorkbenchPanel — receipt + retrieval (IG-S1a/S1b)', () => {
  it('freezes the banner on the server result, not the live form', async () => {
    handlers = {
      'ingest.listIngested': () => ({ dtus: [], total: 0 }),
      'ingest.ingestText': () => RECEIPT,
    };
    const { container } = wrap(<WorkbenchPanel />);
    const textarea = screen.getByPlaceholderText(/Paste or type text to ingest/);
    fireEvent.change(textarea, { target: { value: 'alpha beta gamma' } });
    fireEvent.click(screen.getByText('⌘↵').closest('button')!);
    await waitFor(() =>
      expect(screen.getByText(/Ingested 2 chunks as DTUs/)).toBeTruthy(),
    );
    expect(screen.getByText(/dtu_aaa111/)).toBeTruthy();
    expect(container.textContent).toContain('1 chunk already present, not duplicated');
    // Typing more content must NOT rewrite the receipt (pristine bug:
    // the banner re-rendered the live form's chunk count).
    fireEvent.change(textarea, {
      target: { value: 'completely different much longer text '.repeat(30) },
    });
    expect(screen.getByText(/Ingested 2 chunks as DTUs/)).toBeTruthy();
    expect(screen.queryByText(/Ingested 0 chunks/)).toBeNull();
    // Dismissing clears the receipt.
    fireEvent.click(screen.getByLabelText('Dismiss receipt'));
    await waitFor(() =>
      expect(screen.queryByText(/Ingested 2 chunks as DTUs/)).toBeNull(),
    );
  });

  it('reads Total Ingested from the verb total and opens a Recent DTU', async () => {
    handlers = {
      'ingest.listIngested': () => ({
        dtus: [
          { id: 'dtu_1', title: 'First chunk', domain: 'ingest', tags: ['ingested'], createdAt: 1700000000000, preview: 'p' },
          { id: 'dtu_2', title: 'Second chunk', domain: 'ingest', tags: ['ingested'], createdAt: 1700000001000, preview: 'p' },
        ],
        total: 7,
      }),
      'ingest.getIngested': () => ({
        id: 'dtu_1', title: 'First chunk', content: 'the full stored body', domain: 'ingest',
        tags: ['ingested'], createdAt: 1700000000000,
      }),
    };
    wrap(<WorkbenchPanel />);
    // Total Ingested = 7 (the server total), not the 2 rows shown.
    await waitFor(() => expect(screen.getByText('Total Ingested')).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText('7').length).toBeGreaterThan(0));
    const rowBtn = screen
      .getAllByText('First chunk')
      .map((e) => e.closest('button'))
      .find(Boolean)!;
    fireEvent.click(rowBtn);
    await waitFor(() =>
      expect(screen.getByText('the full stored body')).toBeTruthy(),
    );
    expect(called('getIngested')[0][2]).toMatchObject({ dtuId: 'dtu_1' });
    fireEvent.click(screen.getByLabelText('Close DTU'));
    await waitFor(() =>
      expect(screen.queryByText('the full stored body')).toBeNull(),
    );
  });

  it('shows an honest empty state when a search matches nothing', async () => {
    handlers = {
      'ingest.listIngested': (input: any) =>
        input?.q
          ? { dtus: [], total: 0 }
          : { dtus: [{ id: 'dtu_9', title: 'Kept chunk', domain: 'ingest', tags: [], createdAt: 1, preview: '' }], total: 1 },
    };
    wrap(<WorkbenchPanel />);
    await waitFor(() => expect(screen.getAllByText('Kept chunk').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByPlaceholderText(/Search your ingested DTUs/), {
      target: { value: 'nope' },
    });
    await waitFor(() =>
      expect(screen.getByText('No DTUs matched that search.')).toBeTruthy(),
    );
  });
});

describe('WorkbenchPanel — analysis honesty (IG-S5)', () => {
  it('renders the batch completion rate in percent, not ×100 again', async () => {
    handlers = {
      'ingest.listIngested': () => ({ dtus: [], total: 0 }),
      'ingest.batchStatus': () => ({
        totalItems: 2, completed: 1, pending: 0, inProgress: 1, failed: 0,
        completionRate: 50, statusCounts: { complete: 1, active: 1 }, byPriority: {}, throughput: 0,
      }),
    };
    wrap(<WorkbenchPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Paste or type text to ingest/), {
      target: { value: '[{"id":"a","status":"complete"},{"id":"b","status":"active"}]' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Batch Status/ }));
    await waitFor(() => expect(screen.getByText('50.0%')).toBeTruthy());
    expect(screen.queryByText('5000.0%')).toBeNull();
  });

  it('renders entity number VALUES, not just a count', async () => {
    handlers = {
      'ingest.listIngested': () => ({ dtus: [], total: 0 }),
      'ingest.extractEntities': () => ({
        people: [], organizations: [], locations: [], dates: [], emails: [], urls: [],
        numbers: ['$1,250', '2024'],
        summary: { peopleCount: 0, orgCount: 0, locationCount: 0, dateCount: 0, numberCount: 2 },
      }),
    };
    wrap(<WorkbenchPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Paste or type text to ingest/), {
      target: { value: 'Paid $1,250 in 2024 for the rig.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Extract Entities/ }));
    await waitFor(() => expect(screen.getByText('$1,250')).toBeTruthy());
    expect(screen.getByText('2024')).toBeTruthy();
  });
});

describe('PipelinePanel — consequential-action safety (IG-S4)', () => {
  function pipelineHandlers(over: Record<string, any> = {}) {
    return {
      'ingest.listConnectors': () => ({ connectors: [] }),
      'ingest.listConnections': () => ({
        connections: [
          { id: 'conn_1', connectorId: 'rest-api', connectorName: 'REST API', status: 'configured', config: { baseUrl: 'https://api.example.com', path: '/records' }, incremental: true, cursor: null, lastSyncAt: null, oauthUrl: null },
        ],
      }),
      'ingest.listSchedules': () => ({ schedules: [] }),
      'ingest.listSyncRuns': () => ({ runs: [], limit: 25, totals: { runs: 0, recordsLoaded: 0, bytes: 0, failures: 0 } }),
      'ingest.getWebhookEndpoint': () => ({
        id: 'wh_1', token: 'tok', url: 'https://x/api/ingest/webhook/tok',
        recordsReceived: 3, lastReceivedAt: 1700000000000,
      }),
      'ingest.listWebhookRecords': () => ({ records: [] }),
      ...over,
    };
  }

  it('deletes a connection only after the second, named confirm click', async () => {
    handlers = pipelineHandlers();
    wrap(<PipelinePanel />);
    await waitFor(() => expect(screen.getByText('REST API')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Delete connection'));
    expect(called('deleteConnection').length).toBe(0);
    fireEvent.click(screen.getByText('Confirm remove'));
    await waitFor(() => expect(called('deleteConnection').length).toBe(1));
    expect(called('deleteConnection')[0][2]).toMatchObject({ connectionId: 'conn_1' });
  });

  it('rotates the webhook token only after a confirm that names the cost', async () => {
    handlers = pipelineHandlers();
    wrap(<PipelinePanel />);
    await waitFor(() => expect(screen.getByText('REST API')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Webhook/ }));
    await waitFor(() => expect(screen.getByText('Rotate token')).toBeTruthy());
    fireEvent.click(screen.getByText('Rotate token'));
    expect(screen.getByText(/Rotating invalidates the current URL/)).toBeTruthy();
    expect(called('getWebhookEndpoint').filter((c) => (c[2] as any)?.rotate).length).toBe(0);
    fireEvent.click(screen.getByText('Confirm rotate'));
    await waitFor(() =>
      expect(called('getWebhookEndpoint').filter((c) => (c[2] as any)?.rotate).length).toBe(1),
    );
  });
});

describe('PipelinePanel — transform dirty guard (IG-S5)', () => {
  it('asks before a connection switch discards unsaved rules', async () => {
    handlers = {
      'ingest.listConnectors': () => ({ connectors: [] }),
      'ingest.listConnections': () => ({
        connections: [
          { id: 'conn_a', connectorId: 'rest-api', connectorName: 'Alpha', status: 'configured', config: {}, incremental: false, cursor: null, lastSyncAt: null },
          { id: 'conn_b', connectorId: 'rest-api', connectorName: 'Beta', status: 'configured', config: {}, incremental: false, cursor: null, lastSyncAt: null },
        ],
      }),
      'ingest.listSchedules': () => ({ schedules: [] }),
      'ingest.listSyncRuns': () => ({ runs: [], limit: 25, totals: { runs: 0, recordsLoaded: 0, bytes: 0, failures: 0 } }),
      'ingest.getWebhookEndpoint': () => null,
      'ingest.listWebhookRecords': () => ({ records: [] }),
      'ingest.getMapping': () => ({ mapping: [] }),
    };
    const { container } = wrap(<PipelinePanel />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Transforms/ }));
    const select = container.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'conn_a' } });
    await waitFor(() =>
      expect(called('getMapping').some((c) => (c[2] as any)?.connectionId === 'conn_a')).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: /Add mapping rule/ }));
    await waitFor(() => expect(screen.getByText(/unsaved changes/)).toBeTruthy());
    // Switching while dirty: NO load happens yet; a discard prompt shows.
    fireEvent.change(select, { target: { value: 'conn_b' } });
    await waitFor(() =>
      expect(screen.getByText(/will discard your unsaved rules/)).toBeTruthy(),
    );
    expect(called('getMapping').some((c) => (c[2] as any)?.connectionId === 'conn_b')).toBe(false);
    // Keep editing: prompt clears, rules survive.
    fireEvent.click(screen.getByText('Keep editing'));
    expect(screen.queryByText(/will discard your unsaved rules/)).toBeNull();
    expect(screen.getByText(/unsaved changes/)).toBeTruthy();
    // Switch again and confirm: the load proceeds.
    fireEvent.change(select, { target: { value: 'conn_b' } });
    await waitFor(() =>
      expect(screen.getByText(/will discard your unsaved rules/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('Load anyway'));
    await waitFor(() =>
      expect(called('getMapping').some((c) => (c[2] as any)?.connectionId === 'conn_b')).toBe(true),
    );
  });
});

describe('PipelinePanel — sync source honesty (IG-S2)', () => {
  it('offers endpoint fetch for rest-api connections and labels payload runs', async () => {
    handlers = {
      'ingest.listConnectors': () => ({ connectors: [] }),
      'ingest.listConnections': () => ({
        connections: [
          { id: 'conn_1', connectorId: 'rest-api', connectorName: 'REST API', status: 'configured', config: { baseUrl: 'https://api.example.com', path: '/records' }, incremental: true, cursor: null, lastSyncAt: null },
        ],
      }),
      'ingest.listSchedules': () => ({ schedules: [] }),
      'ingest.listSyncRuns': () => ({
        runs: [
          { id: 'run_1', connectionId: 'conn_1', connectorName: 'REST API', mode: 'incremental', startedAt: 1, finishedAt: 2, recordsScanned: 0, recordsExtracted: 0, recordsLoaded: 0, duplicatesRemoved: 0, byteVolume: 0, failures: 1, status: 'failed', source: 'endpoint', error: 'endpoint returned HTTP 500', newCursor: null, cursorField: 'updated_at' },
        ],
        limit: 25, totals: { runs: 1, recordsLoaded: 0, bytes: 0, failures: 1 },
      }),
      'ingest.getWebhookEndpoint': () => null,
      'ingest.listWebhookRecords': () => ({ records: [] }),
      'ingest.runSync': () => ({ runId: 'run_2', recordsLoaded: 3, duplicatesRemoved: 0 }),
    };
    const { container } = wrap(<PipelinePanel />);
    await waitFor(() => expect(screen.getByText('REST API')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Sync Runs/ }));
    // The failed endpoint run names its error instead of printing zeros.
    await waitFor(() =>
      expect(screen.getByText(/Failed: endpoint returned HTTP 500/)).toBeTruthy(),
    );
    expect(screen.getByText('endpoint')).toBeTruthy();
    // Pick the connection in the run form; endpoint mode is the default
    // for a rest-api connection: no records are sent with the run.
    fireEvent.change(container.querySelector('select')!, { target: { value: 'conn_1' } });
    await waitFor(() => expect(screen.getByLabelText('Sync source')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Run Sync/ }));
    await waitFor(() => expect(called('runSync').length).toBe(1));
    expect((called('runSync')[0][2] as any).records).toBeUndefined();
    // Payload mode is labelled as a payload run.
    fireEvent.change(screen.getByLabelText('Sync source'), { target: { value: 'payload' } });
    await waitFor(() =>
      expect(screen.getByText(/Payload run — this syncs the records below/)).toBeTruthy(),
    );
  });
});
