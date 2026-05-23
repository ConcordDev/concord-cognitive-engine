import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: () => <div data-testid="chartkit" />,
}));

import { MasteryDashboard } from '@/components/education/MasteryDashboard';

const REPORT = {
  overallMastery: 62, totalSkills: 3, masteredSkills: 1, proficientSkills: 2,
  streak: 4, bestStreak: 9, bestExerciseStreak: 5, videosCompleted: 12, totalPoints: 800,
  skillStates: [
    { skillId: 's1', name: 'Addition', subject: 'math', mastery: 'mastered', masteryScore: 100, attempts: 1, lastPracticedAt: '2026-05-01' },
    { skillId: 's2', name: 'Cells', subject: 'science', mastery: 'proficient', masteryScore: 75, attempts: 4, lastPracticedAt: null },
  ],
  subjects: [
    { subject: 'math', skills: 1, avgMastery: 100 },
    { subject: 'science', skills: 2, avgMastery: 50 },
  ],
  activity: [
    { date: '2026-05-01', points: 50, active: true },
    { date: '2026-05-02', points: 0, active: false },
  ],
};

describe('MasteryDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: REPORT } });
  });

  it('renders summary tiles, subject rollups and per-skill states', async () => {
    render(<MasteryDashboard />);
    expect(await screen.findByText('62%')).toBeInTheDocument();
    expect(screen.getByText('Day streak (best 9)')).toBeInTheDocument();
    expect(screen.getByText('Addition')).toBeInTheDocument();
    expect(screen.getByText('Cells')).toBeInTheDocument();
    // subject pluralization
    expect(screen.getByText('math (1 skill)')).toBeInTheDocument();
    expect(screen.getByText('science (2 skills)')).toBeInTheDocument();
    expect(screen.getByTestId('chartkit')).toBeInTheDocument();
    // singular vs plural attempt label
    expect(screen.getByText(/1 attempt/)).toBeInTheDocument();
    expect(screen.getByText(/4 attempts/)).toBeInTheDocument();
  });

  it('shows the no-data state when totalSkills is 0', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...REPORT, totalSkills: 0 } } });
    render(<MasteryDashboard />);
    expect(await screen.findByText(/No skill data yet/)).toBeInTheDocument();
  });

  it('omits the subject section when there are no subjects', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...REPORT, subjects: [] } } });
    render(<MasteryDashboard />);
    await screen.findByText('62%');
    expect(screen.queryByText('Mastery by subject')).not.toBeInTheDocument();
  });

  it('tolerates a fetch rejection (no-data state)', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<MasteryDashboard />);
    await waitFor(() => expect(screen.getByText(/No skill data yet/)).toBeInTheDocument());
  });
});
