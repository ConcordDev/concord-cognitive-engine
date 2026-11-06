/**
 * Carpentry coverage breadth — build(carpentry).
 * Exercises every JobOps panel's render + primary flows so the changed
 * components meet the repo's 60% diff-coverage gate, and walks the
 * manifest lookup helpers the declaration flip's registries rely on.
 * (Companion to carpentry-build-slices.test.tsx, which pins the F2–F8
 * behaviours; this file is breadth, in the CB-0207 coverage pattern.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const calls: { action: string; input: Record<string, unknown> }[] = [];

const CUT_RESULT = {
  boardsNeeded: 2, stockLength: 96, kerf: 0.125, totalCutLength: 96,
  wasteLength: 12.5, wastePct: 13, materialCost: 24,
  layout: [
    { board: 1, cuts: [{ label: 'rail', length: 24 }, { label: 'rail', length: 24 }, { label: 'rail', length: 24 }, { label: 'rail', length: 24 }], usedLength: 96.5, offcut: 0 },
    { board: 2, cuts: [{ label: 'stile', length: 30 }], usedLength: 30.1, offcut: 65.9 },
  ],
};
const ACTIVE_SHARE = {
  token: 'tok_active', client: 'Pat Client', estimateId: 'est_1', estimateAmount: 1100,
  jobName: 'Fixture Project', progressPct: 50, status: 'open', expiresAt: '2026-12-01T00:00:00Z',
  clientDecision: { decision: 'approved', signedBy: 'Pat Client' }, milestones: [],
};

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string, input: Record<string, unknown> = {}) => {
    calls.push({ action, input });
    const results: Record<string, unknown> = {
      crewList: { members: [{ id: 'c1', name: 'Jo Carpenter', role: 'Lead', phone: '', hourlyRate: 65, color: '' }] },
      scheduleList: { entries: [{ id: 'sch_1', title: 'Fixture Job', date: '2026-11-10', startTime: '08:00', endTime: '16:00', crewIds: ['c1'], crewNames: ['Jo Carpenter'], jobId: '', address: '1 Old St', status: 'scheduled', notes: '' }] },
      timeEntryList: {
        entries: [{ id: 'te1', jobId: 'job_1', jobName: 'Deck build', hours: 2, rate: 65, cost: 130, source: 'manual' }],
        running: [{ jobId: 'job_2', jobName: 'Fence run', elapsedHours: 0.5, startedAt: '2026-11-05T12:00:00Z' }],
        totalHours: 2.5, totalCost: 162.5,
        byJob: [{ jobId: 'job_1', jobName: 'Deck build', hours: 2, cost: 130 }],
      },
      photoLogList: { entries: [{ id: 'ph1', jobId: 'job_1', jobName: 'Deck build', imageUrl: 'https://example.com/deck.jpg', phase: 'before', caption: 'Start of job', takenAt: '2026-11-05T12:00:00Z' }] },
      invoiceList: { invoices: [], outstanding: 0, collected: 0 },
      portalList: { shares: [ACTIVE_SHARE] },
      cutListOptimize: CUT_RESULT,
    };
    return { data: { ok: true, result: results[action] ?? {}, error: null } };
  }),
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })) } },
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
  TimelineView: () => React.createElement('div', { 'data-testid': 'timeline' }),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { JobOps } from '@/components/carpentry/JobOps';
import { getLensManifests, getAllLensDomains, getManifestCount, getLensesMissingMacro, isKnownLensId, LENS_MANIFEST_INDEX } from '@/lib/lenses/manifest';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}
const called = (action: string) => calls.some((c) => c.action === action);

beforeEach(() => { calls.length = 0; });

describe('cut list optimizer breadth', () => {
  it('computes and renders boards, waste and the per-board layout', async () => {
    wrap(<JobOps />);
    fireEvent.change(screen.getByPlaceholderText('24'), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: /Add cut/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Optimize' }));
    expect(await screen.findByText('Board 1')).toBeInTheDocument();
    expect(screen.getByText('Board 2')).toBeInTheDocument();
    expect(called('cutListOptimize')).toBe(true);
  });
});

describe('crew + schedule breadth', () => {
  it('renders the roster, adds a member, and cycles a job status', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Dispatch/i }));
    // the name renders in the roster, the crew picker chips, and the
    // schedule entry's crew line — presence, not uniqueness, is the point
    expect((await screen.findAllByText('Jo Carpenter')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText('Crew member name'), { target: { value: 'Sam Saw' } });
    fireEvent.click(screen.getByRole('button', { name: /Add crew/i }));
    await waitFor(() => expect(called('crewAdd')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'scheduled' }));
    await waitFor(() => {
      const c = calls.find((x) => x.action === 'scheduleUpdate');
      expect(c?.input.status).toBe('dispatched');
    });
  });
});

describe('time tracking breadth', () => {
  it('renders totals, running timer, by-job and entries; starts/stops/logs/deletes', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Time/i }));
    expect(await screen.findByText('2.5h logged')).toBeInTheDocument();
    expect(screen.getByText(/Fence run/)).toBeInTheDocument();
    expect(screen.getByText('Labor cost by job')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Stop/i }));
    await waitFor(() => expect(called('timerStop')).toBe(true));
    fireEvent.change(screen.getByPlaceholderText('Job ID'), { target: { value: 'job_9' } });
    fireEvent.change(screen.getByPlaceholderText('hrs'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Log hrs/i }));
    await waitFor(() => expect(called('timeEntryAdd')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /Start timer/i }));
    await waitFor(() => expect(called('timerStart')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    await waitFor(() => expect(called('timeEntryDelete')).toBe(true));
  });
});

describe('photo log breadth', () => {
  it('renders entries, adds a photo, deletes one', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Photos/i }));
    expect(await screen.findByText('Start of job')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Job ID'), { target: { value: 'job_9' } });
    fireEvent.change(screen.getByPlaceholderText(/Image URL/), { target: { value: 'https://example.com/new.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: /Add photo/i }));
    await waitFor(() => expect(called('photoLogAdd')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photo' }));
    await waitFor(() => expect(called('photoLogDelete')).toBe(true));
  });
});

describe('invoicing + portal breadth', () => {
  it('signs, converts, creates a portal, bumps progress and revokes', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Invoicing/i }));
    expect(await screen.findByText(/approved by Pat Client/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Estimate ID'), { target: { value: 'est_9' } });
    fireEvent.change(screen.getByPlaceholderText('Sign-off name'), { target: { value: 'Pat Client' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign quote/i }));
    await waitFor(() => expect(called('signEstimate')).toBe(true));
    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: /Convert to invoice/i }));
    await waitFor(() => expect(called('estimateToInvoice')).toBe(true));
    fireEvent.change(screen.getByPlaceholderText('Client name'), { target: { value: 'New Client' } });
    fireEvent.click(screen.getByRole('button', { name: /Share portal/i }));
    await waitFor(() => expect(called('portalCreate')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '75%' }));
    await waitFor(() => expect(called('portalUpdateProgress')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(called('portalRevoke')).toBe(true));
  });
});

describe('manifest lookup helpers', () => {
  it('every helper resolves carpentry and the registry shape holds', () => {
    expect(getManifestCount()).toBeGreaterThan(200);
    expect(getAllLensDomains()).toContain('carpentry');
    expect(getLensManifests()).toHaveLength(getManifestCount());
    expect(getLensManifests('trades').map((m) => m.domain)).toContain('carpentry');
    expect(getLensesMissingMacro('create')).not.toContain('carpentry');
    expect(isKnownLensId('carpentry')).toBe(true);
    expect(isKnownLensId('not-a-lens')).toBe(false);
    expect(LENS_MANIFEST_INDEX.carpentry?.dataTier).toBe('REAL_LIVE');
  });
});
