/**
 * /lenses/ingest — Detect Schema action.
 *
 * Airbyte-parity gap closure (docs/lens-specs/ingest-capability-map.md
 * "Genuinely missing (deferred)": "Schema auto-inference / column-type
 * detection on preview"). The lens's "Ingest Analysis" panel already ran
 * parseDocument / extractEntities / validateSchema / batchStatus against the
 * real `ingest.*` macros over POST /api/lens/run (`lensRun`); this pins the
 * 5th action — `detectSchema` — added alongside them:
 *
 *   - the button renders and is wired into the action array (same shape as
 *     its siblings: {action,label,icon,color,needsText})
 *   - clicking it parses the textarea's JSON array and calls
 *     lensRun('ingest','detectSchema', { records: [...] }) with the REAL
 *     parsed data, not a placeholder
 *   - a successful result renders as a real per-field <table> (field name,
 *     type badge, nullable %, uniqueness % w/ PK flag, sample values) — not
 *     a raw JSON dump
 *   - a macro failure surfaces the real error message honestly, not a
 *     swallowed/silent failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { dtus: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isSuccess: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const lensRunMock = vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } }));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: { dtus: [] } })), post: vi.fn(() => Promise.resolve({ data: {} })) },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ─────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/ConnectiveTissueBar', () => ({ ConnectiveTissueBar: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => null }));
vi.mock('@/components/ingest/IngestionRepos', () => ({ IngestionRepos: () => null }));
vi.mock('@/components/ingest/PipelinePanel', () => ({ PipelinePanel: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
}));

import IngestLensPage from '@/app/lenses/ingest/page';

const SAMPLE_RECORDS = [
  { id: 1, name: 'Alice', joined: '2024-01-01' },
  { id: 2, name: 'Bob', joined: '2024-02-01' },
];

function pasteRecordsIntoTextarea() {
  const textarea = screen.getByPlaceholderText('Paste or type text to ingest...');
  fireEvent.change(textarea, { target: { value: JSON.stringify(SAMPLE_RECORDS) } });
  return textarea;
}

describe('IngestLensPage — Detect Schema action', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation(() => Promise.resolve({ data: { ok: true, result: {} } }));
  });

  it('renders a Detect Schema button alongside the other analysis actions, disabled until text is present', () => {
    render(<IngestLensPage />);
    const btn = screen.getByRole('button', { name: /Detect Schema/i });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    pasteRecordsIntoTextarea();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking Detect Schema calls ingest.detectSchema with the real parsed records', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'ingest' && action === 'detectSchema') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              recordCount: 2,
              fieldCount: 3,
              primaryKeyCandidates: ['id'],
              fields: [
                { field: 'id', type: 'integer', typeBreakdown: { integer: 2 }, nullCount: 0, nullablePct: 0, nonNullCount: 2, uniqueCount: 2, uniquePct: 100, likelyPrimaryKey: true, sampleValues: [1, 2] },
                { field: 'name', type: 'string', typeBreakdown: { string: 2 }, nullCount: 0, nullablePct: 0, nonNullCount: 2, uniqueCount: 2, uniquePct: 100, likelyPrimaryKey: true, sampleValues: ['Alice', 'Bob'] },
                { field: 'joined', type: 'date', typeBreakdown: { date: 2 }, nullCount: 0, nullablePct: 0, nonNullCount: 2, uniqueCount: 2, uniquePct: 100, likelyPrimaryKey: true, sampleValues: ['2024-01-01', '2024-02-01'] },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    render(<IngestLensPage />);
    pasteRecordsIntoTextarea();
    fireEvent.click(screen.getByRole('button', { name: /Detect Schema/i }));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('ingest', 'detectSchema', { records: SAMPLE_RECORDS });
    });
  });

  it('renders the result as a real per-field table, not a raw JSON dump', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'ingest' && action === 'detectSchema') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              recordCount: 2,
              fieldCount: 2,
              primaryKeyCandidates: ['id'],
              fields: [
                { field: 'id', type: 'integer', typeBreakdown: { integer: 2 }, nullCount: 0, nullablePct: 0, nonNullCount: 2, uniqueCount: 2, uniquePct: 100, likelyPrimaryKey: true, sampleValues: [1, 2] },
                { field: 'status', type: 'mixed', typeBreakdown: { string: 1, boolean: 1 }, nullCount: 0, nullablePct: 0, nonNullCount: 2, uniqueCount: 2, uniquePct: 100, likelyPrimaryKey: false, sampleValues: ['open', true] },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    render(<IngestLensPage />);
    pasteRecordsIntoTextarea();
    fireEvent.click(screen.getByRole('button', { name: /Detect Schema/i }));

    await waitFor(() => expect(screen.getByText('id')).toBeTruthy());

    // Real table structure, not a stringified JSON blob.
    const table = document.querySelector('table');
    expect(table).toBeTruthy();
    expect(screen.getByText('integer')).toBeTruthy();
    expect(screen.getByText('mixed')).toBeTruthy();
    expect(screen.getByText(/likely PK/i)).toBeTruthy();
    // The raw JSON shape (quoted keys) must not leak into the rendered text.
    expect(screen.queryByText(/"fieldCount"/)).toBeNull();
    expect(screen.queryByText(/"typeBreakdown"/)).toBeNull();
  });

  it('surfaces a macro failure honestly instead of silently failing', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'ingest' && action === 'detectSchema') {
        return Promise.resolve({ data: { ok: false, error: 'handler_error: boom', result: null } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    render(<IngestLensPage />);
    pasteRecordsIntoTextarea();
    fireEvent.click(screen.getByRole('button', { name: /Detect Schema/i }));

    await waitFor(() => {
      expect(screen.getByText(/handler_error: boom/)).toBeTruthy();
    });
  });
});
