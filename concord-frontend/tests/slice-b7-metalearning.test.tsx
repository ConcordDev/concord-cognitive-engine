import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-metalearning-003: the five domain-owned record types
// (SRS cards, plans, goals, experiments, journal entries) gain edit
// forms wired to the new update verbs. (Strategy/capture/curriculum
// live in the platform lens-artifact store — named back, not built here.)

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import { SpacedRepetitionPanel } from '@/components/metalearning/SpacedRepetitionPanel';
import { LearningPlanPanel } from '@/components/metalearning/LearningPlanPanel';
import { GoalTrackerPanel } from '@/components/metalearning/GoalTrackerPanel';
import { StrategyExperimentPanel } from '@/components/metalearning/StrategyExperimentPanel';
import { StudyJournalPanel } from '@/components/metalearning/StudyJournalPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

const CARD = { id: 'c1', front: 'What is 2+2?', back: '4', topic: 'math', ease: 2.5, repetitions: 0, overdueDays: 1 };
const PLAN = { id: 'p1', title: 'Plan A', goal: 'Learn', stepsDone: 0, stepsTotal: 0, remainingHours: 0, totalHours: 0, progress: 0, topics: [] };
const GOAL = { id: 'g1', title: 'Read 10', status: 'active', currentValue: 2, targetValue: 10, metric: 'books', deadline: '', metricKind: 'manual', progress: 0.2, checkIns: [] };
const EXP = {
  id: 'e1', title: 'A/B test', hypothesis: 'Deep wins',
  summary: {
    armA: { name: 'skim', n: 0, mean: 0, stdDev: 0 },
    armB: { name: 'deep', n: 0, mean: 0, stdDev: 0 },
    winner: '', effectSize: 0, confidence: '—',
  },
};
const ENTRY = { id: 'j1', topic: 'bio', technique: 'recall', minutesStudied: 30, effectiveness: 3, reflection: 'Hard session', createdAt: '2026-11-13T10:00:00Z' };

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((_d: string, action: string) => {
    if (action === 'srsDue') return ok({ dueNow: [CARD], upcoming: [], totalCards: 1 });
    if (action === 'planList') return ok({ plans: [PLAN] });
    if (action === 'goalList') return ok({ goals: [GOAL], active: 1, achieved: 0 });
    if (action === 'experimentList') return ok({ experiments: [EXP] });
    if (action === 'journalList') return ok({ entries: [ENTRY], techniqueEffectiveness: [], totalMinutes: 30 });
    return ok({});
  });
});

describe('FIX-metalearning-003 edit paths', () => {
  it('SRS card edit saves through srsUpdateCard', async () => {
    render(<SpacedRepetitionPanel />);
    fireEvent.click(await screen.findByLabelText('Edit card What is 2+2?'));
    const front = await screen.findByLabelText('Edit card front');
    fireEvent.change(front, { target: { value: 'What is 3+3?' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('srsUpdateCard')).toHaveLength(1));
    expect(calls('srsUpdateCard')[0][2]).toMatchObject({ id: 'c1', front: 'What is 3+3?' });
  });

  it('plan edit saves through planUpdate', async () => {
    render(<LearningPlanPanel />);
    fireEvent.click(await screen.findByLabelText('Edit plan Plan A'));
    const title = await screen.findByLabelText('Edit plan title');
    fireEvent.change(title, { target: { value: 'Plan A+' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('planUpdate')).toHaveLength(1));
    expect(calls('planUpdate')[0][2]).toMatchObject({ id: 'p1', title: 'Plan A+' });
  });

  it('goal edit saves through goalUpdate', async () => {
    render(<GoalTrackerPanel />);
    fireEvent.click(await screen.findByLabelText('Edit goal Read 10'));
    const target = await screen.findByLabelText('Edit goal target');
    fireEvent.change(target, { target: { value: '12' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('goalUpdate')).toHaveLength(1));
    expect(calls('goalUpdate')[0][2]).toMatchObject({ id: 'g1', targetValue: 12 });
  });

  it('experiment edit saves through experimentUpdate', async () => {
    render(<StrategyExperimentPanel />);
    fireEvent.click(await screen.findByLabelText('Edit experiment A/B test'));
    const hyp = await screen.findByLabelText('Edit experiment hypothesis');
    fireEvent.change(hyp, { target: { value: 'Deep wins on retention' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('experimentUpdate')).toHaveLength(1));
    expect(calls('experimentUpdate')[0][2]).toMatchObject({ id: 'e1', hypothesis: 'Deep wins on retention' });
  });

  it('journal edit saves through journalUpdate', async () => {
    render(<StudyJournalPanel />);
    fireEvent.click(await screen.findByLabelText('Edit journal entry bio'));
    const reflection = await screen.findByLabelText('Edit entry reflection');
    fireEvent.change(reflection, { target: { value: 'Hard but useful' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('journalUpdate')).toHaveLength(1));
    expect(calls('journalUpdate')[0][2]).toMatchObject({ id: 'j1', reflection: 'Hard but useful' });
  });
});
