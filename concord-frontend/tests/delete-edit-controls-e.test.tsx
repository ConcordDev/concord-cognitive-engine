/**
 * Audit sweep CB-0447, cluster E — FE pins:
 *   FIX-import-004 — Import History rows carry a two-step delete wired
 *     to the lens-data remove, and the history filters by filename.
 *     (Undo has no reversal substrate anywhere in the import domain —
 *     named in the fix record, not built.)
 *   FIX-agriculture-006 (scout leg) — a scouting pin's delete is an
 *     always-visible two-step confirm, not the old hover-only
 *     one-click icon the audit read as "no delete".
 *   FIX-game-design-001 — VERIFY-ONLY discharge, behaviour form: the
 *     chip × arms an in-place "Delete?" and fires game-delete only
 *     from the confirm (the F5 fix, previously pinned at source level
 *     only by game-design-build.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

type Call = { domain: string; action: string; input: Record<string, unknown> };
const calls: Call[] = [];
type Handler = (domain: string, action: string, input: Record<string, unknown>) => unknown;
const ok = (result: unknown) => ({ data: { ok: true, result, error: null } });
let handler: Handler = () => ok({});

// lensRun has two call styles in the fleet — positional
// (domain, action, input) and object ({domain, action, input}).
// Normalize both, as the shipped components use each.
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (...args: unknown[]) => {
    const first = args[0] as Record<string, unknown> | string;
    if (typeof first === 'object' && first !== null && 'domain' in first) {
      const { domain, action, input } = first as { domain: string; action: string; input?: Record<string, unknown> };
      calls.push({ domain, action, input: input || {} });
      return handler(domain, action, input || {});
    }
    const [domain, action, input] = args as [string, string, Record<string, unknown>?];
    calls.push({ domain, action, input: input || {} });
    return handler(domain, action, input || {});
  }),
  api: { get: vi.fn(async () => ({ data: { ok: true, result: {} } })), post: vi.fn(async () => ({ data: { ok: true, result: {} } })), delete: vi.fn(async () => ({ data: { ok: true, result: {} } })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })) } },
}));

const removeJob = vi.fn(async (_id: string) => {});
const JOB_ITEMS = [
  {
    id: 'job_1', title: 'alpha.csv', createdAt: '2026-11-09T10:00:00Z',
    data: {
      filename: 'alpha.csv', type: 'dtus', status: 'completed', progress: 100,
      records_total: 10, records_imported: 10, records_skipped: 0, records_failed: 0,
      errors: [], started_at: '2026-11-09T10:00:00Z', completed_at: '2026-11-09T10:01:00Z',
    },
  },
  {
    id: 'job_2', title: 'beta.json', createdAt: '2026-11-09T11:00:00Z',
    data: {
      filename: 'beta.json', type: 'dtus', status: 'failed', progress: 40,
      records_total: 5, records_imported: 2, records_skipped: 0, records_failed: 3,
      errors: ['row 4: bad date'], started_at: '2026-11-09T11:00:00Z', completed_at: '2026-11-09T11:01:00Z',
    },
  },
];
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: JOB_ITEMS, total: JOB_ITEMS.length, isLoading: false, isError: false, error: null,
    isSeeding: false, refetch: vi.fn(), create: vi.fn(), update: vi.fn(), remove: removeJob,
  }),
}));
vi.mock('@/components/import/UniversalImport', () => ({ UniversalImport: () => null }));

// GameDesignSection's tab panels are not under test — stub them out
// (doMock + dynamic import: the fleet's proven pattern for panel stubs).
for (const name of [
  'GdGddPanel', 'GdMechanicsPanel', 'GdEntitiesPanel', 'GdLevelPanel', 'GdLoopsPanel',
  'GdNarrativePanel', 'GdAssetsPanel', 'GdAnimationPanel', 'GdBehaviorPanel',
  'GdRuntimePanel', 'GdCollabPanel', 'GdAnalysisPanel', 'AssetStudioPanel', 'CreatureStudioPanel',
]) {
  vi.doMock(`@/components/game-design/${name}`, () => ({ [name]: () => null }));
}

import { ImportDeskPanel } from '@/components/import/ImportDeskPanel';
import { FarmWorkbench } from '@/components/agriculture/FarmWorkbench';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => { calls.length = 0; handler = () => ok({}); removeJob.mockClear(); });

describe('import history controls (FIX-import-004)', () => {
  it('filters history by filename and deletes a row only through the two-step confirm', async () => {
    wrap(<ImportDeskPanel />);
    expect(await screen.findByText('alpha.csv')).toBeInTheDocument();
    expect(screen.getByText('beta.json')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter import history by filename'), { target: { value: 'beta' } });
    await waitFor(() => expect(screen.queryByText('alpha.csv')).not.toBeInTheDocument());
    expect(screen.getByText('beta.json')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter import history by filename'), { target: { value: '' } });
    expect(await screen.findByText('alpha.csv')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete import job alpha.csv from history' }));
    expect(removeJob).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete import job alpha.csv' }));
    await waitFor(() => expect(removeJob).toHaveBeenCalledWith('job_1'));
  });
});

describe('agriculture scout pin delete (FIX-agriculture-006, scout leg)', () => {
  it('the pin delete is a visible two-step confirm that fires scout-delete only on confirm', async () => {
    const FIELD = {
      id: 'field_1', name: 'North 40', acreage: 40, lat: 41.7, lng: -73.9,
      soilType: 'loam', currentCrop: 'corn', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    };
    const PIN = {
      id: 'pin_1', fieldId: 'field_1', note: 'Aphids on the north edge', category: 'pest',
      severity: 'medium', lat: 41.7, lng: -73.9, createdAt: '2026-11-01T00:00:00Z',
    };
    handler = (_d, action) => {
      if (action === 'field-list') return ok({ fields: [FIELD] });
      if (action === 'scout-list') return ok({ pins: [PIN] });
      return ok({});
    };
    wrap(<FarmWorkbench open onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Scouting log/ }));
    expect(await screen.findByText('Aphids on the north edge')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete observation Aphids on the north edge' }));
    expect(calls.some((c) => c.action === 'scout-delete')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete observation' }));
    await waitFor(() => {
      const call = calls.find((c) => c.action === 'scout-delete');
      expect(call).toBeTruthy();
      expect(call?.input).toMatchObject({ id: 'pin_1' });
    });
  });
});

describe('game-design chip delete (FIX-game-design-001, verify-only)', () => {
  it('the × arms an in-place Delete? and game-delete fires only from the confirm', async () => {
    const GAME = { id: 'game_1', title: 'Star Cartographer', genre: 'puzzle', platform: 'web', pitch: null };
    handler = (_d, action) => {
      if (action === 'game-list') return ok({ games: [GAME] });
      if (action === 'game-dashboard') return ok(null);
      return ok({});
    };
    const { GameDesignSection } = await import('@/components/game-design/GameDesignSection');
    wrap(<GameDesignSection />);
    // The title renders twice: the roster chip and the active-game line.
    expect((await screen.findAllByText('Star Cartographer')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Star Cartographer' }));
    expect(calls.some((c) => c.action === 'game-delete')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete?' }));
    await waitFor(() => {
      const call = calls.find((c) => c.action === 'game-delete');
      expect(call).toBeTruthy();
      expect(call?.input).toMatchObject({ id: 'game_1' });
    });
  });
});
