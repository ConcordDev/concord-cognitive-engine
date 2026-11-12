/**
 * Theme-5 sticky-confirm cluster 1 (FIX-carpentry-007 · FIX-ar-006):
 * schedule + time-entry deletes in Carpentry's JobOps, and the AR lens's
 * capture + model deletes, no longer fire on the first click. The first
 * click arms a confirm that NAMES the record and sends nothing; Confirm
 * sends the delete; Cancel disarms with nothing sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── Carpentry JobOps ────────────────────────────────────────────────────────
const carpCalls: { action: string; input: Record<string, unknown> }[] = [];
const SCHED = { id: 'sch_1', title: 'Fixture Job', date: '2026-11-10', startTime: '08:00', endTime: '16:00', crewIds: [], crewNames: [], jobId: '', address: '1 Old St', status: 'scheduled', notes: '' };
const ENTRY = { id: 'te_1', jobName: 'Fixture Job', source: 'manual', hours: 3, cost: 90 };

vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
  TimelineView: () => React.createElement('div', { 'data-testid': 'timeline' }),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/lib/public-lookup', () => ({
  wikiSummary: vi.fn(async (s: string) => ({ title: s, description: '', extract: '', content_urls: { desktop: { page: '' } } })),
  lookupMeta: () => null,
}));
vi.mock('@/components/common/LookupNotice', () => ({ LookupNotice: () => null }));

// ── AR AssetLibrary hooks ───────────────────────────────────────────────────
const removeModel = vi.fn(async () => true);
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [{ id: 'm1', data: { name: 'Brass Gear', format: 'glb', polyCount: 1200, fileSize: '2 MB', sourceUrl: '' } }],
    isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(), remove: removeModel,
  }),
  LensItem: undefined,
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => vi.fn() }));
vi.mock('@/components/ar/SketchfabModels', () => ({ SketchfabModels: () => null }));

// ── shared lensRun mock (carpentry + AR captures) ───────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })) } },
}));

import { JobOps } from '@/components/carpentry/JobOps';
import { ARCaptureGallery } from '@/components/ar/ARCaptureGallery';
import { AssetLibrary } from '@/components/ar/AssetLibrary';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => {
  carpCalls.length = 0;
  removeModel.mockClear();
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_d: string, action: string, input: Record<string, unknown> = {}) => {
    carpCalls.push({ action, input });
    const results: Record<string, unknown> = {
      crewList: { members: [] },
      scheduleList: { entries: [SCHED] },
      timeEntryList: { entries: [ENTRY], running: [], totalHours: 3, totalCost: 90, byJob: [] },
      photoLogList: { entries: [] },
      invoiceList: { invoices: [], outstanding: 0, collected: 0 },
      portalList: { shares: [] },
      materialTakeoff: {},
      speciesReference: { species: [] },
      captureList: { captures: [{ id: 'cap_1', label: 'Yard scan', mimeType: 'image/png', byteSize: 2048 }], count: 1 },
    };
    return { data: { ok: true, result: results[action] ?? {}, error: null } };
  });
});

describe('FIX-carpentry-007 — schedule + time-entry deletes confirm first', () => {
  it('schedule delete: arm sends nothing, Confirm sends scheduleDelete', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Dispatch/i }));
    const arm = await screen.findByRole('button', { name: 'Delete schedule Fixture Job' });
    fireEvent.click(arm);
    expect(await screen.findByRole('button', { name: 'Confirm delete schedule Fixture Job' })).toBeTruthy();
    expect(carpCalls.some((c) => c.action === 'scheduleDelete')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete schedule Fixture Job' }));
    await waitFor(() => expect(carpCalls.some((c) => c.action === 'scheduleDelete' && c.input.id === 'sch_1')).toBe(true));
  });

  it('time-entry delete: arm sends nothing, Cancel disarms, Confirm sends timeEntryDelete', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /^Time$/i }));
    const arm = await screen.findByRole('button', { name: 'Delete entry for Fixture Job' });
    fireEvent.click(arm);
    expect(await screen.findByRole('button', { name: 'Confirm delete entry for Fixture Job' })).toBeTruthy();
    expect(carpCalls.some((c) => c.action === 'timeEntryDelete')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm delete entry for Fixture Job' })).toBeNull());
    expect(carpCalls.some((c) => c.action === 'timeEntryDelete')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry for Fixture Job' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete entry for Fixture Job' }));
    await waitFor(() => expect(carpCalls.some((c) => c.action === 'timeEntryDelete' && c.input.id === 'te_1')).toBe(true));
  });
});

describe('FIX-ar-006 — capture + model deletes confirm first', () => {
  it('capture delete: arm sends nothing, Confirm sends captureDelete', async () => {
    wrap(<ARCaptureGallery canvasRef={React.createRef()} sceneId={null} disabled={false} onNotify={() => {}} />);
    const arm = await screen.findByRole('button', { name: 'Delete capture Yard scan' });
    fireEvent.click(arm);
    expect(await screen.findByRole('button', { name: 'Confirm delete capture Yard scan' })).toBeTruthy();
    expect(carpCalls.some((c) => c.action === 'captureDelete')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete capture Yard scan' }));
    await waitFor(() => expect(carpCalls.some((c) => c.action === 'captureDelete' && c.input.captureId === 'cap_1')).toBe(true));
  });

  it('model delete: arm does not remove, Confirm removes the model', async () => {
    wrap(<AssetLibrary onPreview={() => {}} />);
    const arm = await screen.findByRole('button', { name: 'Delete Brass Gear' });
    fireEvent.click(arm);
    expect(await screen.findByRole('button', { name: 'Confirm delete Brass Gear' })).toBeTruthy();
    expect(removeModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Brass Gear' }));
    await waitFor(() => expect(removeModel).toHaveBeenCalledWith('m1'));
  });
});
