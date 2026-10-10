import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="stl-viewer" /> }));

import { DesignResult } from './DesignResult';
import { DesignsIndex } from './DesignsIndex';
import type { DesignSnapshot } from '@/lib/conkay/designs-api';

const MEANING = { sourced: 's', measured: 'm', computed: 'c', estimated: 'e', design: 'd', unknown: 'u' };
const SNAP: DesignSnapshot = {
  showcaseVersion: '1.0.0', id: 'car', title: 'Four-seat 180 mph car', kind: 'vehicle', pipeline: 'carAcceptanceAsync',
  brief: 'Design a car', headline: { verdict: 'credible_with_caveats', status: 'WARN' },
  disclaimers: ['Software screening only.'], caveats: ['Cd is a screening range'], failures: [],
  checks: [
    { runId: 'vehicle.top-speed@VEH', solver: 'vehicle.top-speed', target: 'VEH', status: 'PASS', method: 'power balance', reason: null, margins: [{ check: 'speed', demand: 80.5, capacity: 81.9, unit: 'm/s', utilization: 0.98, marginPct: 1.7 }], failures: [], warnings: [] },
    { runId: 'aero.drag-buildup@VEH', solver: 'aero.drag-buildup', target: 'VEH', status: 'WARN', method: null, reason: 'screening range wide', margins: [], failures: [], warnings: [] },
  ],
  checkCounts: { PASS: 1, WARN: 1, FAIL: 0, NOT_COMPUTED: 0, ERROR: 0 },
  perPartRuns: { PASS: 68, WARN: 0, FAIL: 0, NOT_COMPUTED: 0, ERROR: 0 },
  values: [
    { id: 'a', group: 'Component masses', name: 'ENGINE', value: 201.8, unit: 'kg', range: null, status: 'sourced', statusLabel: 'sourced', source: { title: 'Ford data sheet', url: 'https://example.org/ford' }, sourceRole: 'evidence', method: null, note: null },
    { id: 'b', group: 'Component masses', name: 'FUEL_CELL can', value: null, unit: 'kg', range: null, status: 'unknown', statusLabel: 'placeholder', source: null, sourceRole: null, method: null, note: null },
  ],
  mass: { totalKg: 1032.2, bandKg: [1018, 1035], byState: { sourced: 361.2, measured: 213.2, computed: 305, estimated: 152.7, design: 0, unknown: 0 }, unknownCount: 0, notIncluded: ['fuel load'], note: 'lower bound', limit: { label: 'brief: 2,500 lb', kg: 1134, marginKg: 101.8 } },
  drawings: [{ title: 'General arrangement CK-GA-VEH', revision: 'R-77BE7CCC', modelHash: 'abc123', method: null, files: [
    { label: 'Sheet 1', name: 'CK-GA-VEH-sheet1.svg', kind: 'svg', bytes: 353236, sha256: 'x' },
    { label: 'PDF', name: 'CK-GA-VEH.pdf', kind: 'pdf', bytes: 361078, sha256: 'y' },
  ] }],
  model3d: { name: 'body.stl', format: 'stl', bytes: 715384, sha256: 'z', triangles: 14306, units: 'm', upAxis: 'z', source: 'cad.body@BODY_SHELL' },
  physicalTests: ['Weigh the built car'], statuses: ['sourced', 'measured', 'computed', 'estimated', 'design', 'unknown'], statusMeaning: MEANING,
  files: [], snapshotSha256: 'f'.repeat(64),
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/conkay/demo/designs') return { status: 200, json: async () => ({ ok: true, designs: [
      { id: 'car', title: 'Four-seat 180 mph car', kind: 'vehicle', available: true, brief: 'Design a car', checkCounts: SNAP.checkCounts, hasDrawings: true, hasModel3d: true },
      { id: 'nuscale-us600', title: 'NuScale US600 facility screening', kind: 'nuclear', available: false },
    ] }) };
    if (url === '/api/conkay/demo/designs/car') return { status: 200, json: async () => ({ ok: true, design: SNAP }) };
    return { status: 404, json: async () => ({ ok: false, error: 'no such showcase design' }) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('DesignsIndex', () => {
  it('lists the snapshots and says when one is not built', async () => {
    render(<DesignsIndex />);
    await screen.findByText('Four-seat 180 mph car');
    expect(screen.getByRole('link', { name: /Four-seat 180 mph car/ }).getAttribute('href')).toBe('/conkay/designs/car');
    expect(screen.getByText(/Snapshot not built/)).toBeTruthy();
  });
});

describe('DesignResult', () => {
  it('shows disclaimers, drawings, checks, values and mass from the snapshot only', async () => {
    render(<DesignResult id="car" />);
    await screen.findByRole('heading', { name: 'Four-seat 180 mph car' });
    expect(screen.getByRole('note').textContent).toContain('Software screening only.');
    const img = screen.getByRole('img', { name: /General arrangement CK-GA-VEH, Sheet 1/ });
    expect(img.getAttribute('src')).toBe('/api/conkay/demo/designs/car/files/CK-GA-VEH-sheet1.svg');
    expect(screen.getByText(/68 per-part mass\/cost runs/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ford data sheet/ }).getAttribute('href')).toBe('https://example.org/ford');
    expect(screen.getByText('no source')).toBeTruthy();
    expect(screen.getByText('Weigh the built car')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the model is not fetched until asked for
  });

  it('opens a check to its margins and filters values by status', async () => {
    render(<DesignResult id="car" />);
    await screen.findByText('vehicle.top-speed@VEH');
    fireEvent.click(screen.getByRole('button', { name: /vehicle.top-speed@VEH/ }));
    expect(screen.getByText('1.7 %')).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Filter values by status' });
    fireEvent.click(within(group).getByRole('button', { name: /unknown 1/ }));
    expect(screen.queryByText('ENGINE')).toBeNull();
    expect(screen.getByText('FUEL_CELL can')).toBeTruthy();
  });

  it('loads the CAD model only on request', async () => {
    render(<DesignResult id="car" />);
    fireEvent.click(await screen.findByRole('button', { name: /Load CAD model/ }));
    expect(screen.getByTestId('stl-viewer')).toBeTruthy();
  });

  it('reports a missing design instead of rendering an empty page', async () => {
    render(<DesignResult id="nope" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('No such design.'));
  });
});
