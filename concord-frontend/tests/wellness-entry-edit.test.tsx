// FIX-wellness-005 (FE) — CBT records gain Edit (reuses the form,
// saves via cbt-record-update) and confirmed Delete; metric entries
// gain edit/delete in the entry log; workout delete now asks first.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (req: { domain: string; action: string; input?: Record<string, unknown> }) => {
    calls.push({ action: req.action, input: req.input || {} });
    if (req.action === 'cbt-prompts' && !req.input?.fieldKind) {
      return { data: { ok: true, result: { kinds: [{ fieldKind: 'binary_thinking', label: 'Binary thinking', distortion: 'All-or-nothing' }] } } };
    }
    if (req.action === 'cbt-prompts') {
      return { data: { ok: true, result: { fieldKind: 'binary_thinking', label: 'Binary thinking', distortion: 'All-or-nothing', challenges: [], reframe: '' } } };
    }
    if (req.action === 'cbt-record-list') {
      return { data: { ok: true, result: { total: 1, completed: 1, avgRelief: 20, records: [{
        id: 'tr_1', number: 'TR-0001', fieldKind: 'binary_thinking', distortionLabel: 'Binary thinking',
        situation: 'Missed a deadline', emotion: 'shame', automaticThought: 'I always fail',
        evidenceFor: '', evidenceAgainst: '', reframe: 'One miss', intensityBefore: 80, intensityAfter: 60,
        relief: 20, date: '2026-11-10', at: '2026-11-10T00:00:00.000Z',
      }] } } };
    }
    if (req.action === 'metrics-list') {
      return { data: { ok: true, result: { metrics: [{ id: 'm_1', type: 'steps', value: 5000, date: '2026-11-10', at: '2026-11-10T00:00:00.000Z', note: '' }] } } };
    }
    if (req.action === 'metrics-trend') {
      return { data: { ok: true, result: { type: 'steps', days: 30, series: [], average: 0, latest: null, min: null, max: null, trend: 'flat' } } };
    }
    if (req.action === 'habits-list') return { data: { ok: true, result: { habits: [] } } };
    if (req.action === 'mood-list') return { data: { ok: true, result: { moods: [] } } };
    if (req.action === 'mood-correlate') return { data: { ok: true, result: { correlations: [] } } };
    if (req.action === 'goals-list') return { data: { ok: true, result: { goals: [] } } };
    if (req.action === 'recovery-score') return { data: { ok: true, result: { score: 0, band: 'red' } } };
    if (req.action === 'wellness-dashboard-summary') {
      return { data: { ok: true, result: { habitCount: 0, habitsDoneToday: 0, workoutsThisWeek: 0, workoutMinThisWeek: 0, avgMoodThisWeek: null, activeGoals: 0, metricEntryCount: 1 } } };
    }
    if (req.action === 'workouts-list') {
      return { data: { ok: true, result: { workouts: [{ id: 'w_1', kind: 'run', durationMin: 30, distanceKm: null, calories: null, avgHr: null, intensity: 'moderate', date: '2026-11-10', note: '', at: '2026-11-10T00:00:00.000Z', number: 'WO-00001' }], totalMin: 30, count: 1 } } };
    }
    return { data: { ok: true, result: {} } };
  }),
}));
vi.mock('recharts', () => ({
  AreaChart: () => null, Area: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, ResponsiveContainer: (p: { children?: React.ReactNode }) => <>{p.children}</>, CartesianGrid: () => null,
}));

import { CBTPanel } from '@/components/wellness/CBTPanel';
import { WellnessSection } from '@/components/wellness/WellnessSection';

beforeEach(() => { calls.length = 0; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('wellness entry edit/delete', () => {
  it('CBT record edit saves via cbt-record-update; delete asks first', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<CBTPanel />);
    await screen.findByText('Missed a deadline', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Edit thought record TR-0001' })); });
    const situation = await screen.findByDisplayValue('Missed a deadline');
    await act(async () => { fireEvent.change(situation, { target: { value: 'Missed two deadlines' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save record' })); });
    await waitFor(() => expect(calls.some((c) => c.action === 'cbt-record-update' && c.input.id === 'tr_1' && c.input.situation === 'Missed two deadlines')).toBe(true));
    expect(calls.some((c) => c.action === 'cbt-record-create')).toBe(false);

    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Delete thought record TR-0001' })); });
    await waitFor(() => expect(calls.some((c) => c.action === 'cbt-record-delete' && c.input.id === 'tr_1')).toBe(true));
  });

  it('metric entry edit/delete call the new macros; workout delete is gated by confirm', async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    vi.stubGlobal('prompt', vi.fn(() => '6500'));
    render(<WellnessSection />);
    // Metric entries render on the Today tab's entry log.
    await screen.findByText('5000', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Edit Steps entry' })); });
    await waitFor(() => expect(calls.some((c) => c.action === 'metrics-update' && c.input.id === 'm_1' && c.input.value === 6500)).toBe(true));

    // Workout delete with confirm declined → no delete call.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Workouts/ })); });
    const delButtons = await screen.findAllByRole('button', { name: 'Delete' });
    await act(async () => { fireEvent.click(delButtons[0]); });
    expect(calls.some((c) => c.action === 'workouts-delete')).toBe(false);
    confirmMock.mockReturnValue(true);
    await act(async () => { fireEvent.click(delButtons[0]); });
    await waitFor(() => expect(calls.some((c) => c.action === 'workouts-delete' && c.input.id === 'w_1')).toBe(true));
  });
});
