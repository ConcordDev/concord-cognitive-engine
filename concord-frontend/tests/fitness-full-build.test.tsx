/**
 * Fitness lens — GB-1088 full-build pins (Review 3 first-pass findings).
 *
 * Pins the behaviours the build changed, against the real macro channel
 * shapes ({ data: { ok, result } } after one unwrap):
 *   F5  WorkoutLogger — Add exercise is an inline field, NOT
 *       window.prompt; Finish refuses an empty session inline and
 *       never calls workout-save.
 *   F12 SleepRecovery — the empty state's "log manually" promise is a
 *       real control that calls fitness.recovery-log.
 *   F4  ActivityRings — a derived ("logged") day renders with its
 *       provenance caption instead of "No activity data yet."
 *   F9  WorkoutPlanner — a generated plan can be kept: Save as program
 *       hands the plan to the host's saver.
 *   F11 WorkoutFinishPanel — the HR tile requests Karvonen (it collects
 *       resting HR) and names the zone the entered avg HR sits in.
 *   F8  WorkoutFinishPanel — the form restores from the persisted
 *       lens UI-state draft instead of resetting on remount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
  api: { post: vi.fn(() => Promise.resolve({ data: { ok: true } })) },
}));

import { WorkoutLogger } from '@/components/fitness/WorkoutLogger';
import { SleepRecovery } from '@/components/fitness/SleepRecovery';
import { ActivityRings } from '@/components/fitness/ActivityRings';
import { WorkoutPlanner } from '@/components/fitness/WorkoutPlanner';
import { WorkoutFinishPanel } from '@/components/fitness/WorkoutFinishPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

function actionOf(call: unknown[]): string {
  const a = call[0] as { action?: string } | string;
  return typeof a === 'string' ? String(call[1]) : (a?.action ?? '');
}
function inputOf(call: unknown[]): Record<string, unknown> {
  const a = call[0] as { input?: Record<string, unknown> };
  return a?.input ?? {};
}

beforeEach(() => { lensRunMock.mockReset(); runDomainMock.mockReset(); window.localStorage.clear(); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('F5 — WorkoutLogger add-exercise + empty-finish refusal', () => {
  it('adds via the inline field (never window.prompt) and refuses an empty finish', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => 'Bench Press');
    lensRunMock.mockImplementation((arg: { action?: string }) =>
      arg?.action === 'workout-list' ? ok({ workouts: [] }) : ok({ id: 'wo_1' }));
    const view = render(<WorkoutLogger />);
    await waitFor(() => expect(view.getByText('Start workout')).toBeInTheDocument());
    fireEvent.click(view.getByText('Start workout'));
    // Finish with zero exercises → inline refusal, no workout-save call.
    fireEvent.click(view.getByText('Finish'));
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(/at least one exercise/i));
    expect(lensRunMock.mock.calls.filter(c => actionOf(c) === 'workout-save')).toHaveLength(0);
    // Add an exercise through the inline field.
    fireEvent.change(view.getByLabelText('Exercise name'), { target: { value: 'Bench Press' } });
    fireEvent.click(view.getByText('Add exercise'));
    await waitFor(() => expect(view.getByText('Bench Press')).toBeInTheDocument());
    expect(promptSpy).not.toHaveBeenCalled();
  });
});

describe('F12 — SleepRecovery manual log', () => {
  it('the empty state’s "log manually" is a working control calling recovery-log', async () => {
    lensRunMock.mockImplementation((arg: { action?: string }) => {
      if (arg?.action === 'recovery-history') return ok({ days: [], source: 'empty', notes: null });
      if (arg?.action === 'recovery-log') return ok({ entry: { date: '2026-11-04', sleepHours: 7.5, source: 'manual' }, created: true });
      return ok({});
    });
    const view = render(<SleepRecovery />);
    await waitFor(() => expect(view.getByRole('button', { name: 'Log manually' })).toBeInTheDocument());
    fireEvent.click(view.getByRole('button', { name: 'Log manually' }));
    fireEvent.change(view.getByPlaceholderText('7.5'), { target: { value: '7.5' } });
    fireEvent.click(view.getByText('Log entry'));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find(c => actionOf(c) === 'recovery-log');
      expect(call).toBeTruthy();
      expect(inputOf(call!).sleepHours).toBe(7.5);
    });
    await waitFor(() => expect(view.getByText(/Logged 7\.5h sleep/)).toBeInTheDocument());
  });
});

describe('F4 — ActivityRings derived day', () => {
  it('renders a "logged" day with its provenance caption', async () => {
    const loggedDay = {
      date: '2026-11-04', moveCalories: 0, moveGoal: 600,
      exerciseMinutes: 90, exerciseGoal: 30,
      standHours: 0, standGoal: 12, steps: 0, stepsGoal: 10000,
      source: 'logged',
    };
    lensRunMock.mockImplementation(() => ok({ days: [loggedDay], source: 'logged', notes: null }));
    const view = render(<ActivityRings />);
    await waitFor(() => expect(view.getByText(/Days marked from your logs/i)).toBeInTheDocument());
    expect(view.queryByText('No activity data yet.')).toBeNull();
  });
});

describe('F9 — WorkoutPlanner keep path', () => {
  it('Save as program hands the generated plan to the host saver', async () => {
    const plan = {
      goal: 'strength', weeks: 8, daysPerWeek: 4,
      template: [{ day: 'Monday', focus: 'Upper push', duration: 60, exercises: [{ name: 'Barbell Bench Press', sets: 5, reps: '3-5', restSec: 180 }] }],
      progression: 'Add 2.5–5 lb weekly.', nutrition: 'Slight surplus.',
    };
    lensRunMock.mockImplementation(() => ok({ plan }));
    const onSavePlan = vi.fn(() => Promise.resolve('strength program — 8wk × 4d'));
    const view = render(<WorkoutPlanner onSavePlan={onSavePlan} />);
    fireEvent.click(view.getByText('Generate plan'));
    await waitFor(() => expect(view.getByText('Save as program')).toBeInTheDocument());
    fireEvent.click(view.getByText('Save as program'));
    await waitFor(() => expect(onSavePlan).toHaveBeenCalledWith(expect.objectContaining({ goal: 'strength', weeks: 8 })));
    await waitFor(() => expect(view.getByText(/find it under Programs/i)).toBeInTheDocument());
  });
});

describe('F11 + F8 — WorkoutFinishPanel HR tile + form persistence', () => {
  const ZONES = [
    { zone: 1, name: 'Recovery', lowBpm: 100, highBpm: 115, purpose: 'Easy aerobic' },
    { zone: 2, name: 'Easy', lowBpm: 115, highBpm: 125, purpose: 'Aerobic base' },
    { zone: 3, name: 'Aerobic', lowBpm: 125, highBpm: 140, purpose: 'Aerobic threshold' },
    { zone: 4, name: 'Threshold', lowBpm: 140, highBpm: 155, purpose: 'Lactate threshold' },
    { zone: 5, name: 'VO₂ Max', lowBpm: 155, highBpm: 190, purpose: 'Peak power' },
  ];

  it('restores the persisted draft, requests Karvonen, and names the avg-HR zone', async () => {
    window.localStorage.setItem('concord-lens-ui-state', JSON.stringify({
      'fitness-finish': {
        savedAt: Date.now(),
        state: {
          title: 'Persisted Title', avgHr: '130', restingHr: '58', age: '41',
          lifts: [{ name: 'Squat', sets: [{ reps: 5, weight: 100, rir: 2 }] }],
        },
      },
    }));
    runDomainMock.mockImplementation(() => Promise.resolve({
      data: { ok: true, result: { maxHr: 190, method: 'karvonen', zones: ZONES } },
    }));
    const view = render(<WorkoutFinishPanel />);
    // F8: the title survived the "remount" because it was persisted.
    await waitFor(() => expect(view.getByDisplayValue('Persisted Title')).toBeInTheDocument());
    fireEvent.click(view.getByText('HR zones'));
    await waitFor(() => expect(runDomainMock).toHaveBeenCalled());
    const hrCall = runDomainMock.mock.calls.find(c => c[1] === 'hr-zones');
    expect(hrCall).toBeTruthy();
    expect((hrCall![2] as { input: Record<string, unknown> }).input.method).toBe('karvonen');
    // F11: the verdict names the zone containing avg HR 130.
    await waitFor(() => expect(view.getByText(/Zone 3 · Aerobic/)).toBeInTheDocument());
    expect(view.getByText(/Karvonen \(HR reserve\)/)).toBeInTheDocument();
  });
});
