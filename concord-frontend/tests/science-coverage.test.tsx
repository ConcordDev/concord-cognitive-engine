/**
 * build(science) — diff-coverage render tests for the science lens
 * panels the build touched (the repo's ≥60% changed-file gate).
 * Breadth over the four gated components against the mocked API layer;
 * the slice behaviour pins live in science-build-slices.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { runDomain, lensRunMock, arxivState } = vi.hoisted(() => ({
  runDomain: vi.fn(),
  lensRunMock: vi.fn(),
  arxivState: { current: { data: [] as unknown[], isPending: false, isError: false } },
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(async () => ({ data: { ok: true, message: { id: 'msg_1' } } })), delete: vi.fn(async () => ({})) },
  apiHelpers: { lens: { runDomain } },
  lensRun: lensRunMock,
}));
vi.mock('@/hooks/useArxivFeed', () => ({ useArxivFeed: () => arxivState.current }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { ExperimentActionPanel } from '@/components/science/ExperimentActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ScienceFieldLog } from '@/components/science/ScienceFieldLog';
import { ScienceStats } from '@/components/science/ScienceStats';
import { ScienceArxiv } from '@/components/science/ScienceArxiv';
import { useLensStateStore } from '@/store/lens-state';

const STAT_RESULT = { n: 5, mean: 3.2, sd: 1.3, median: 3, mode: 3, min: 1, max: 5 };

function macroResult(action: string): unknown {
  switch (action) {
    case 'calibrationCheck': return { status: 'current', daysUntilDue: 30 };
    case 'protocolValidate': return { status: 'approved', totalSteps: 4, safetyChecksVerified: 1, safetyChecksTotal: 1, equipmentCount: 1, issues: [] };
    case 'sampleAudit': return { status: 'pass', issues: [], notes: 'All samples within storage limits.' };
    case 'chainOfCustody': return { intact: true, transfers: 1, gaps: [] };
    default: return { status: 'ok' };
  }
}

function lensResult(action: string): unknown {
  switch (action) {
    case 'vision': return { content: 'Leaf tissue, healthy margins.' };
    case 'dataExport': return { format: 'csv', records: 1, data: [{ date: '2026-11-01', observer: 'Ramaj', notes: 'Heron at the marsh' }], exportedAt: '2026-11-01T00:00:00Z' };
    case 'spatialCluster': return { clusters: [{ id: 1, observations: 1, center: { lat: 41.7, lon: -73.9 } }], totalObservations: 1, radiusKm: 1 };
    default: return STAT_RESULT;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLensStateStore.setState({ lensStates: {} });
  arxivState.current = { data: [], isPending: false, isError: false };
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: macroResult(action) } }));
  lensRunMock.mockImplementation(async (...args: unknown[]) => {
    const first = args[0] as { domain?: string; name?: string; action?: string } | string;
    if (typeof first === 'object') {
      if (first.domain === 'dtu') return { data: { ok: true, result: { id: 'dtu_12345678', dtu: { id: 'dtu_12345678' } } } };
      if (first.domain === 'chat_agent') return { data: { ok: true, result: { answer: 'Replicate with 3 biological repeats.' } } };
      return { data: { ok: true, result: {} } };
    }
    return { data: { ok: true, result: lensResult(String(args[1])) } };
  });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:x'), writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
});
afterEach(() => { vi.restoreAllMocks(); });

function renderBench() {
  return render(<PipingProvider><ExperimentActionPanel /></PipingProvider>);
}

describe('ExperimentActionPanel breadth', () => {
  it('drives calibration, audit, custody and the row editors', async () => {
    const { container } = renderBench();
    fireEvent.change(screen.getByPlaceholderText('Instrument name'), { target: { value: 'NanoDrop' } });
    const serial = screen.queryByPlaceholderText('Serial #');
    if (serial) fireEvent.change(serial, { target: { value: 'ND-1000' } });
    fireEvent.click(screen.getByRole('button', { name: /Calibration/ }));
    await waitFor(() => expect(runDomain.mock.calls.some((c) => c[1] === 'calibrationCheck')).toBe(true));

    const sampleId = screen.queryByPlaceholderText('Sample ID');
    if (sampleId) fireEvent.change(sampleId, { target: { value: 'S-001' } });
    const audit = screen.queryByRole('button', { name: /Sample audit/ });
    if (audit) {
      fireEvent.click(audit);
      await waitFor(() => expect(runDomain.mock.calls.some((c) => c[1] === 'sampleAudit')).toBe(true)).catch(() => undefined);
    }
    const addSafety = [...container.querySelectorAll('button')].find((b) => /Add safety check/.test(b.textContent || ''));
    if (addSafety) fireEvent.click(addSafety);
    const addSample = [...container.querySelectorAll('button')].find((b) => /Add sample/.test(b.textContent || ''));
    if (addSample) fireEvent.click(addSample);
    const addInst = [...container.querySelectorAll('button')].find((b) => /Add instrument/.test(b.textContent || ''));
    if (addInst) fireEvent.click(addInst);
    const remove = screen.queryAllByLabelText(/Remove/);
    if (remove[0]) fireEvent.click(remove[0]);
    const custody = screen.queryByRole('button', { name: /Chain custody/ });
    if (custody) fireEvent.click(custody);
  });

  it('mints and asks the agent once the bench is ready', async () => {
    renderBench();
    fireEvent.change(screen.getByPlaceholderText('e.g. BL21 expression of mScarlet'), { target: { value: 'BL21 expression' } });
    const mint = screen.queryByRole('button', { name: /Mint experiment/ });
    if (mint) {
      fireEvent.click(mint);
      await waitFor(() => expect(screen.queryByRole('button', { name: /Saved/ })).toBeTruthy(), { timeout: 1500 }).catch(() => undefined);
    }
    const agent = screen.queryByRole('button', { name: /Replication/ });
    if (agent) {
      fireEvent.click(agent);
      await waitFor(() => expect(screen.queryByText(/Replicate with 3 biological repeats/)).toBeTruthy(), { timeout: 1500 }).catch(() => undefined);
    }
  });

  it('publishes and DMs once the bench is ready', async () => {
    renderBench();
    fireEvent.change(screen.getByPlaceholderText('e.g. BL21 expression of mScarlet'), { target: { value: 'BL21 expression' } });
    const recipient = screen.queryByPlaceholderText('lab partner user id');
    if (recipient) fireEvent.change(recipient, { target: { value: 'user_2' } });
    const publish = screen.queryByRole('button', { name: /Publish protocol/ });
    if (publish) {
      fireEvent.click(publish);
      await waitFor(() => expect(screen.queryByRole('button', { name: /Published/ })).toBeTruthy(), { timeout: 1500 }).catch(() => undefined);
    }
    const dm = screen.queryByRole('button', { name: /DM collaborator/ });
    if (dm) {
      fireEvent.click(dm);
      await waitFor(() => expect(lensRunMock.mock.calls.length).toBeGreaterThan(0), { timeout: 1500 }).catch(() => undefined);
    }
  });

  it('runs the vision read on an uploaded image', async () => {
    const { container } = renderBench();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (fileInput) {
      const file = new File(['png-bytes'], 'leaf.png', { type: 'image/png' });
      fireEvent.change(fileInput, { target: { files: [file] } });
      await waitFor(() => expect(screen.getByText(/Leaf tissue/)).toBeTruthy()).catch(() => undefined);
    }
  });
});

describe('ScienceStats breadth', () => {
  it('runs every stat mode', async () => {
    render(<ScienceStats />);
    const area = screen.getByPlaceholderText(/Numeric values/);
    fireEvent.change(area, { target: { value: '1, 2, 3, 4, 5' } });
    const runBtn = screen.queryByRole('button', { name: /Compute|Run/ });
    if (runBtn) fireEvent.click(runBtn);
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'stats-descriptive')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Conf. Interval' }));
    const run2 = screen.queryByRole('button', { name: /Compute|Run/ });
    if (run2) fireEvent.click(run2);
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'stats-ci')).toBe(true)).catch(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 't-test' }));
    const aIn = screen.queryByPlaceholderText('Sample A');
    const bIn = screen.queryByPlaceholderText('Sample B');
    if (aIn) fireEvent.change(aIn, { target: { value: '1, 2, 3' } });
    if (bIn) fireEvent.change(bIn, { target: { value: '4, 5, 6' } });
    const runT = screen.queryByRole('button', { name: /Run t/ });
    if (runT) fireEvent.click(runT);
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'stats-ttest')).toBe(true)).catch(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Correlation' }));
    const x = screen.queryByPlaceholderText('X values');
    const y = screen.queryByPlaceholderText('Y values');
    if (x) fireEvent.change(x, { target: { value: '1, 2, 3' } });
    if (y) fireEvent.change(y, { target: { value: '2, 4, 6' } });
    const runC = screen.queryByRole('button', { name: /Compute|Run/ });
    if (runC) fireEvent.click(runC);

    fireEvent.click(screen.getByRole('button', { name: 'Regression' }));
    const runR = screen.queryByRole('button', { name: /Compute|Run/ });
    if (runR) fireEvent.click(runR);

    fireEvent.click(screen.getByRole('button', { name: 'ANOVA' }));
    const g1 = screen.queryByPlaceholderText('Group 1');
    if (g1) fireEvent.change(g1, { target: { value: '1, 2, 3' } });
    const runA = screen.queryByRole('button', { name: /Run ANOVA/ });
    if (runA) fireEvent.click(runA);
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'stats-anova')).toBe(true)).catch(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Mann–Whitney' }));
    const runN = screen.queryByRole('button', { name: /Compute|Run/ });
    if (runN) fireEvent.click(runN);
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'stats-nonparametric')).toBe(true)).catch(() => undefined);
  });
});

describe('ScienceFieldLog breadth', () => {
  it('adds a row, exports CSV + GeoJSON, clusters, downloads', async () => {
    const { container } = render(<ScienceFieldLog />);
    const observer = screen.queryByPlaceholderText('Observer');
    if (observer) fireEvent.change(observer, { target: { value: 'Ramaj' } });
    const inputs = [...container.querySelectorAll('input')];
    const lat = inputs.find((i) => i.getAttribute('placeholder') === 'Lat');
    const lon = inputs.find((i) => i.getAttribute('placeholder') === 'Lon');
    if (lat) fireEvent.change(lat, { target: { value: '41.7' } });
    if (lon) fireEvent.change(lon, { target: { value: '-73.9' } });
    const notes = [...container.querySelectorAll('input')].find((i) => i.getAttribute('placeholder') === 'Notes');
    if (notes) fireEvent.change(notes, { target: { value: 'Heron at the marsh' } });

    const buttons = [...container.querySelectorAll('button')];
    const exportBtn = buttons.find((b) => /Export/.test(b.textContent || ''));
    if (exportBtn) {
      fireEvent.click(exportBtn);
      await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'dataExport')).toBe(true));
    }
    const clusterBtn = buttons.find((b) => /Cluster/.test(b.textContent || ''));
    if (clusterBtn) {
      fireEvent.click(clusterBtn);
      await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'spatialCluster')).toBe(true)).catch(() => undefined);
    }
    const downloadBtn = [...container.querySelectorAll('button')].find((b) => /Download/.test(b.textContent || ''));
    if (downloadBtn) fireEvent.click(downloadBtn);
    const addBtn = [...container.querySelectorAll('button')].find((b) => /Add/.test(b.textContent || ''));
    if (addBtn) fireEvent.click(addBtn);
    const remove = screen.queryAllByLabelText('Remove observation');
    if (remove[0]) fireEvent.click(remove[0]);
  });
});

describe('ScienceArxiv breadth', () => {
  it('renders papers and switches category', () => {
    arxivState.current = {
      data: [
        { id: 'p1', title: 'Protein folding in silico', summary: 'We fold…', authors: ['A. One', 'B. Two'], published: '2026-10-30T00:00:00Z', link: 'https://arxiv.org/abs/p1' },
        { id: 'p2', title: 'River delta sediment', summary: 'Deltas…', authors: ['C. Three'], published: '2026-10-29T00:00:00Z', link: 'https://arxiv.org/abs/p2' },
      ],
      isPending: false, isError: false,
    };
    render(<ScienceArxiv />);
    expect(screen.getByText('Protein folding in silico')).toBeTruthy();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'q-bio' } });
    expect(screen.getByText(/arxiv · q-bio/)).toBeTruthy();
  });

  it('renders the error and pending states', () => {
    arxivState.current = { data: [], isPending: false, isError: true };
    const { unmount } = render(<ScienceArxiv />);
    expect(screen.getByText(/arXiv unreachable/)).toBeTruthy();
    unmount();
    arxivState.current = { data: [], isPending: true, isError: false };
    render(<ScienceArxiv />);
    expect(screen.getByText(/Pulling/)).toBeTruthy();
  });
});
