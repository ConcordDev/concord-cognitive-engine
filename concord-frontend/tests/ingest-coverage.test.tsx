/**
 * Ingest coverage breadth — renders the panels' major branches with
 * rich macro results so the diff-coverage gate sees real execution of
 * the changed components (companion to ingest-build-slices.test.tsx,
 * which pins the slice behaviours).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

let handlers: Record<string, (input: any) => any> = {};

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (domain: string, action: string, input: any) => {
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

beforeEach(() => {
  handlers = {};
});

describe('WorkbenchPanel breadth', () => {
  function workbenchHandlers() {
    return {
      'ingest.listIngested': () => ({
        dtus: [
          { id: 'dtu_1', title: 'Chunk one', domain: 'ingest', tags: ['ingested'], createdAt: 1700000000000, preview: 'x' },
        ],
        total: 3,
      }),
      'ingest.parseDocument': () => ({
        format: 'text', wordCount: 18, sentenceCount: 4, paragraphCount: 2,
        avgWordsPerSentence: 4.5, avgWordsPerParagraph: 9, readingTimeMinutes: 1,
        sectionCount: 1, sections: ['Intro'],
      }),
      'ingest.validateSchema': () => ({
        totalRecords: 2, validRecords: 1, invalidRecords: 1, validationRate: 50,
        issues: [{ row: 2, missingFields: ['email'], extraFields: [], nullFields: [] }],
      }),
      'ingest.detectSchema': () => ({
        recordCount: 2, fieldCount: 2, primaryKeyCandidates: ['id'],
        fields: [
          { field: 'id', type: 'number', nullablePct: 0, uniquePct: 100, sampleValues: [1, 2], likelyPrimaryKey: true },
          { field: 'name', type: 'string', nullablePct: 0, uniquePct: 50, sampleValues: ['Ada'] },
        ],
      }),
      'ingest.extractEntities': () => ({
        people: ['Ada Lovelace'], organizations: ['Acme'], locations: ['Hudson Valley'],
        dates: ['2026-01-01'], emails: ['a@b.co'], urls: ['https://x.dev'], numbers: ['42'],
        summary: { peopleCount: 1, orgCount: 1, locationCount: 1, dateCount: 1, numberCount: 1 },
      }),
      'ingest.batchStatus': () => ({
        totalItems: 4, completed: 2, pending: 1, inProgress: 1, failed: 0,
        completionRate: 50, statusCounts: { complete: 2 }, byPriority: { high: 1 }, throughput: 2,
      }),
    };
  }

  it('renders every analysis result branch', async () => {
    handlers = workbenchHandlers();
    wrap(<WorkbenchPanel />);
    const ta = screen.getByPlaceholderText(/Paste or type text to ingest/);
    fireEvent.change(ta, { target: { value: 'Some text. More text here. And $1,250 in 2024.' } });
    fireEvent.click(screen.getByRole('button', { name: /Parse Document/ }));
    await waitFor(() => expect(screen.getByText(/Document Parse/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Extract Entities/ }));
    await waitFor(() => expect(screen.getByText('a@b.co')).toBeTruthy());
    fireEvent.change(ta, { target: { value: '[{"id":1,"name":"Ada"},{"id":2,"name":"Bo"}]' } });
    fireEvent.click(screen.getByRole('button', { name: /Validate Schema/ }));
    await waitFor(() => expect(screen.getByText('Row 2')).toBeTruthy());
    expect(screen.getByText('email')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Detect Schema/ }));
    await waitFor(() => expect(screen.getByText(/likely PK/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Batch Status/ }));
    await waitFor(() => expect(screen.getByText('50.0%')).toBeTruthy());
  });

  it('renders analysis error/message states and batch extras', async () => {
    handlers = {
      'ingest.listIngested': () => ({ dtus: [], total: 0 }),
      'ingest.parseDocument': () => ({ error: 'parse exploded' }),
      'ingest.detectSchema': () => ({ message: 'paste JSON first' }),
      'ingest.batchStatus': () => ({
        totalItems: 3, completed: 1, pending: 1, inProgress: 0, failed: 1,
        completionRate: 33.3, statusCounts: {}, byPriority: {}, throughput: 0,
        estimatedRemaining: '2 items',
        recentErrors: [{ index: 0, id: 'row-9', error: 'bad row' }],
      }),
    };
    wrap(<WorkbenchPanel />);
    const ta = screen.getByPlaceholderText(/Paste or type text to ingest/);
    fireEvent.change(ta, { target: { value: 'plain text' } });
    fireEvent.click(screen.getByRole('button', { name: /Parse Document/ }));
    await waitFor(() => expect(screen.getByText('parse exploded')).toBeTruthy());
    fireEvent.change(ta, { target: { value: '[{"id":1}]' } });
    fireEvent.click(screen.getByRole('button', { name: /Detect Schema/ }));
    await waitFor(() => expect(screen.getByText('paste JSON first')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Batch Status/ }));
    await waitFor(() => expect(screen.getByText(/bad row/)).toBeTruthy());
    expect(screen.getByText(/Est. remaining/)).toBeTruthy();
  });

  it('renders the bulk upload + history surfaces', async () => {
    handlers = workbenchHandlers();
    wrap(<WorkbenchPanel />);
    await waitFor(() => expect(screen.getAllByText('Chunk one').length).toBeGreaterThan(0));
    expect(screen.getByText(/Batch-ingest multiple files/)).toBeTruthy();
    expect(screen.getByText('Ingestion History')).toBeTruthy();
  });
});

describe('PipelinePanel breadth', () => {
  function pipelineHandlers() {
    return {
      'ingest.listConnectors': () => ({
        connectors: [
          {
            id: 'rest-api', name: 'REST API', description: 'Pull from an HTTP endpoint',
            fields: [
              { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, placeholder: 'https://…' },
              { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST'] },
              { key: 'authHeader', label: 'Auth header', type: 'password' },
            ],
            oauth: { provider: 'generic', scopes: ['read'] },
          },
          { id: 'postgres', name: 'Postgres', description: 'Database', fields: [], oauth: null },
        ],
      }),
      'ingest.listConnections': () => ({
        connections: [
          { id: 'conn_1', connectorId: 'rest-api', connectorName: 'REST API', status: 'configured', config: { baseUrl: 'https://api.example.com', path: '/records' }, incremental: true, cursor: '2026-01-02', lastSyncAt: 1700000000000, oauthUrl: 'https://oauth.example.com' },
        ],
      }),
      'ingest.listSchedules': () => ({
        schedules: [
          { id: 'sch_1', connectionId: 'conn_1', connectorName: 'REST API', cadence: 'daily', mode: 'incremental', enabled: true, nextRunInMs: 3600000, runCount: 3, due: true, lastDrainStatus: 'drained', lastDrainRecordCount: 5, lastDrainAt: 1700000000000 },
          { id: 'sch_2', connectionId: 'conn_1', connectorName: 'REST API', cadence: 'weekly', mode: 'full', enabled: false, nextRunInMs: 0, runCount: 0, due: false, lastDrainStatus: 'error', lastDrainReason: 'boom', lastDrainAt: 1700000000000 },
        ],
      }),
      'ingest.listSyncRuns': () => ({
        runs: [
          { id: 'run_1', connectionId: 'conn_1', connectorName: 'REST API', mode: 'incremental', startedAt: 1, finishedAt: 2, recordsScanned: 10, recordsExtracted: 9, recordsLoaded: 8, duplicatesRemoved: 1, byteVolume: 2048, failures: 0, status: 'completed', source: 'payload', newCursor: 'x', cursorField: 'updated_at' },
        ],
        limit: 25, totals: { runs: 1, recordsLoaded: 8, bytes: 2048, failures: 0 },
      }),
      'ingest.getWebhookEndpoint': () => ({
        id: 'wh_1', token: 'tok123', url: 'https://x/api/ingest/webhook/tok123',
        recordsReceived: 2, lastReceivedAt: 1700000000000,
      }),
      'ingest.listWebhookRecords': () => ({
        records: [
          { id: 'rec_1', receivedAt: 1700000000000, payload: { hello: 'world' } },
          { id: 'rec_2', receivedAt: 1700000001000, payload: { n: 2 } },
        ],
      }),
      'ingest.getMapping': () => ({ mapping: [] }),
      'ingest.getDedupConfig': () => ({ enabled: true, threshold: 0.85, strategy: 'key-field', keyField: 'id' }),
      'ingest.configureConnector': () => ({ connectionId: 'conn_new' }),
      'ingest.previewTransform': () => ({
        transformed: [{ id: 1, name: 'Ada' }],
        results: [{ before: { id: 1 }, after: { id: 1, name: 'Ada' } }],
        meta: { input: ['id'], output: ['id', 'name'], dropped: [], derived: ['name'] },
      }),
    };
  }

  it('renders the connector catalog, create form and schedules', async () => {
    handlers = pipelineHandlers();
    wrap(<PipelinePanel />);
    await waitFor(() => expect(screen.getAllByText('REST API').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Postgres'));
    fireEvent.click(screen.getAllByText('REST API')[0]);
    await waitFor(() => expect(screen.getByText('Base URL')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Create Connection/ }));
    await waitFor(() => expect(screen.getByText('Connections')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Schedules/ }));
    await waitFor(() => expect(screen.getByText(/drained 5 records/)).toBeTruthy());
    expect(screen.getByText(/drain error: boom/)).toBeTruthy();
  });

  it('renders runs with totals, the dedup tab and the OCR tab', async () => {
    handlers = pipelineHandlers();
    wrap(<PipelinePanel />);
    await waitFor(() => expect(screen.getAllByText('REST API').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Sync Runs/ }));
    await waitFor(() => expect(screen.getByText(/10 scanned/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Dedup/ }));
    await waitFor(() => expect(screen.getByText('Dedup enabled')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Save Dedup Config/ }));
    fireEvent.click(screen.getByRole('button', { name: /OCR/ }));
    await waitFor(() => expect(screen.getAllByText(/OCR/).length).toBeGreaterThan(0));
  });

  it('renders the webhook tab with its received records', async () => {
    handlers = pipelineHandlers();
    wrap(<PipelinePanel />);
    await waitFor(() => expect(screen.getAllByText('REST API').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Webhook/ }));
    await waitFor(() => expect(screen.getByText(/Received Records \(2\)/)).toBeTruthy());
    expect(screen.getByText(/hello/)).toBeTruthy();
  });

  it('renders a transform preview', async () => {
    handlers = pipelineHandlers();
    const { container } = wrap(<PipelinePanel />);
    await waitFor(() => expect(screen.getAllByText('REST API').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Transforms/ }));
    const select = container.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'conn_1' } });
    await waitFor(() => expect(screen.getByText(/0 rules/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    await waitFor(() => expect(screen.getAllByText(/Ada/).length).toBeGreaterThan(0));
  });
});
