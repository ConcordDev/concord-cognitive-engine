import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { InspectionsPanel } from '@/components/government/InspectionsPanel';

const PERMITS = [{ id: 'p1', recordNumber: 'PMT-1', kind: 'building' }];
const INSPECTIONS = [
  { id: 'i1', permitId: 'p1', kind: 'framing', date: '2026-06-01', inspectorName: 'Sam', timeSlot: 'morning', status: 'scheduled', result: null, notes: '' },
  { id: 'i2', permitId: 'p1', kind: 'final', date: '2026-06-02', inspectorName: '', timeSlot: 'afternoon', status: 'completed', result: 'pass', notes: 'ok' },
  { id: 'i3', permitId: 'p1', kind: 'electrical', date: '2026-06-03', inspectorName: 'Lee', timeSlot: 'all_day', status: 'completed', result: 'fail', notes: 'bad wiring' },
];

function mockBoth(inspections: unknown[], permits: unknown[]) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'inspections-list') return Promise.resolve({ data: { ok: true, result: { inspections } } });
    if (spec.action === 'permits-list') return Promise.resolve({ data: { ok: true, result: { permits } } });
    return Promise.resolve({ data: { ok: true } });
  });
}

describe('InspectionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBoth([], []);
  });

  it('shows empty state', async () => {
    render(<InspectionsPanel />);
    expect(await screen.findByText('No inspections yet.')).toBeInTheDocument();
  });

  it('renders inspections with result branches', async () => {
    mockBoth(INSPECTIONS, PERMITS);
    render(<InspectionsPanel />);
    expect(await screen.findByText(/PMT-1 · framing/)).toBeInTheDocument();
    expect(screen.getByText('pass')).toBeInTheDocument();
    expect(screen.getByText('fail')).toBeInTheDocument();
    expect(screen.getByText('1 scheduled')).toBeInTheDocument();
    // unassigned inspector fallback
    expect(screen.getByText(/unassigned/)).toBeInTheDocument();
  });

  it('does not schedule without a permit selected', async () => {
    mockBoth([], PERMITS);
    render(<InspectionsPanel />);
    await screen.findByText('No inspections yet.');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Schedule'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'inspections-schedule' }));
  });

  it('schedules an inspection', async () => {
    mockBoth([], PERMITS);
    render(<InspectionsPanel />);
    await screen.findByText('No inspections yet.');
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'p1' } });
    lensRun.mockClear();
    mockBoth([], PERMITS);
    fireEvent.click(screen.getByText('Schedule'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'inspections-schedule', input: expect.objectContaining({ permitId: 'p1' }) }),
      ),
    );
  });

  it('completes a scheduled inspection as pass with prompt notes', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('looks good');
    mockBoth(INSPECTIONS, PERMITS);
    render(<InspectionsPanel />);
    await screen.findByText(/PMT-1 · framing/);
    fireEvent.click(screen.getByTitle('Pass'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'inspections-complete', input: { id: 'i1', result: 'pass', notes: 'looks good' } }),
      ),
    );
    promptSpy.mockRestore();
  });

  it('completes a scheduled inspection as fail with empty notes when prompt cancelled', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    mockBoth(INSPECTIONS, PERMITS);
    render(<InspectionsPanel />);
    await screen.findByText(/PMT-1 · framing/);
    fireEvent.click(screen.getByTitle('Fail'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'inspections-complete', input: { id: 'i1', result: 'fail', notes: '' } }),
      ),
    );
    promptSpy.mockRestore();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<InspectionsPanel />);
    expect(await screen.findByText('No inspections yet.')).toBeInTheDocument();
  });
});
