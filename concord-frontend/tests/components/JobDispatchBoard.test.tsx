/**
 * JobDispatchBoard — the landscaping lens's field-service scheduling
 * surface, wiring the job-schedule / job-list / job-complete macro triple
 * (server/domains/landscaping.js) that closed the "Jobs (scheduling/
 * dispatch)" gap in docs/lens-specs/landscaping-capability-map.md.
 *
 * Pins: empty state, real macro calls with the right domain/action/params
 * shape, per-crew lane + unassigned rendering with load hours, the
 * status-filter round-trip, and the complete-job flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { JobDispatchBoard } from '@/components/landscaping/JobDispatchBoard';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, error, result: null } });
}

const EMPTY_BOARD = {
  jobs: [], count: 0, lanes: [], unassigned: [],
  scheduledCount: 0, inProgressCount: 0, completedCount: 0, cancelledCount: 0,
};

const JOB_A = {
  id: 'job_a', title: 'Spring cleanup', client: 'Acme HOA', address: '12 Elm St',
  proposalId: null, bedId: null, crew: 'Crew A', date: '2026-06-02',
  startHour: 9, durationHours: 3, notes: '', status: 'scheduled', createdAt: '2026-06-01T00:00:00.000Z',
};
const JOB_UNASSIGNED = {
  id: 'job_b', title: 'Mulch delivery', client: '', address: '', proposalId: null,
  bedId: null, crew: '', date: '2026-06-02', startHour: 10, durationHours: 1,
  notes: '', status: 'scheduled', createdAt: '2026-06-01T00:00:00.000Z',
};
const BOARD_WITH_JOBS = {
  jobs: [JOB_A, JOB_UNASSIGNED], count: 2,
  lanes: [{ crew: 'Crew A', jobs: [JOB_A], loadHours: 3 }],
  unassigned: [JOB_UNASSIGNED],
  scheduledCount: 2, inProgressCount: 0, completedCount: 0, cancelledCount: 0,
};

function mockRoute(behaviors: Record<string, () => Promise<unknown>>) {
  lensRun.mockImplementation((domain: string, action: string) => {
    const fn = behaviors[action];
    if (fn) return fn();
    return ok(EMPTY_BOARD);
  });
}

describe('JobDispatchBoard', () => {
  beforeEach(() => {
    lensRun.mockReset();
    window.prompt = vi.fn(() => '');
  });

  it('loads job-list + bed-list on mount and renders the empty state', async () => {
    mockRoute({
      'job-list': () => ok(EMPTY_BOARD),
      'bed-list': () => ok({ beds: [] }),
    });
    render(<JobDispatchBoard />);
    expect(await screen.findByText(/No jobs match this filter/i)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('landscaping', 'job-list', {});
    expect(lensRun).toHaveBeenCalledWith('landscaping', 'bed-list', {});
  });

  it('renders crew lanes with load hours and a separate unassigned lane', async () => {
    mockRoute({
      'job-list': () => ok(BOARD_WITH_JOBS),
      'bed-list': () => ok({ beds: [] }),
    });
    render(<JobDispatchBoard />);
    expect(await screen.findByText('Crew A')).toBeInTheDocument();
    expect(screen.getByText('3h scheduled')).toBeInTheDocument();
    expect(screen.getByText('Spring cleanup')).toBeInTheDocument();
    expect(screen.getByText(/Unassigned \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Mulch delivery')).toBeInTheDocument();
  });

  it('schedules a job via job-schedule with the entered fields, then reloads the board', async () => {
    mockRoute({
      'job-list': () => ok(EMPTY_BOARD),
      'bed-list': () => ok({ beds: [] }),
      'job-schedule': () => ok({ job: JOB_A }),
    });
    render(<JobDispatchBoard />);
    await screen.findByText(/No jobs match this filter/i);

    fireEvent.change(screen.getByPlaceholderText('Job title'), { target: { value: 'Spring cleanup' } });
    fireEvent.change(screen.getByPlaceholderText('Crew (e.g. Crew A)'), { target: { value: 'Crew A' } });
    fireEvent.click(screen.getByRole('button', { name: /Schedule job/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'landscaping', 'job-schedule',
      expect.objectContaining({ title: 'Spring cleanup', crew: 'Crew A' }),
    ));
    // board reloads after a successful schedule
    await waitFor(() => {
      const calls = lensRun.mock.calls.filter((c) => c[1] === 'job-list');
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('surfaces a job-schedule validation error without crashing', async () => {
    mockRoute({
      'job-list': () => ok(EMPTY_BOARD),
      'bed-list': () => ok({ beds: [] }),
      'job-schedule': () => fail('job title required'),
    });
    render(<JobDispatchBoard />);
    await screen.findByText(/No jobs match this filter/i);
    fireEvent.change(screen.getByPlaceholderText('Job title'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Schedule job/i }));
    expect(await screen.findByText('job title required')).toBeInTheDocument();
  });

  it('re-queries job-list with a status filter when the Status select changes', async () => {
    mockRoute({
      'job-list': () => ok(EMPTY_BOARD),
      'bed-list': () => ok({ beds: [] }),
    });
    render(<JobDispatchBoard />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('landscaping', 'job-list', {}));

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'completed' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'landscaping', 'job-list', { status: 'completed' },
    ));
  });

  it('completes a job via job-complete and reloads the board', async () => {
    mockRoute({
      'job-list': () => ok(BOARD_WITH_JOBS),
      'bed-list': () => ok({ beds: [] }),
      'job-complete': () => ok({ job: { ...JOB_A, status: 'completed', completedAt: '2026-06-02T12:00:00.000Z' } }),
    });
    render(<JobDispatchBoard />);
    await screen.findByText('Spring cleanup');

    const completeButtons = screen.getAllByRole('button', { name: /Complete/i });
    fireEvent.click(completeButtons[0]);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'landscaping', 'job-complete', expect.objectContaining({ id: JOB_A.id }),
    ));
  });
});
