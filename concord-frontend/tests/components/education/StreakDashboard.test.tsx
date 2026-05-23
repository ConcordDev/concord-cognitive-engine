import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { StreakDashboard } from '@/components/education/StreakDashboard';

const STATUS = {
  totalPoints: 4200, streak: 7, level: 5, skillPoints: 30, nextLevelAt: 50,
  recentPoints: [
    { amount: 50, source: 'lesson_complete', timestamp: '2026-05-01T10:00:00Z' },
    { amount: 25, source: 'skill_mastered', timestamp: '2026-05-02T10:00:00Z' },
  ],
};

describe('StreakDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: STATUS } });
  });

  it('renders tiles, progress bar and recent points', async () => {
    render(<StreakDashboard />);
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText('4,200')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('30 / 50 skill pts')).toBeInTheDocument();
    expect(screen.getByText('+50')).toBeInTheDocument();
    // underscore source is humanized
    expect(screen.getByText('lesson complete')).toBeInTheDocument();
  });

  it('shows the empty recent-points message', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...STATUS, recentPoints: [] } } });
    render(<StreakDashboard />);
    expect(await screen.findByText(/Earn points by completing lessons/)).toBeInTheDocument();
  });

  it('shows the no-data state when result is null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<StreakDashboard />);
    expect(await screen.findByText('No data yet')).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<StreakDashboard />);
    await waitFor(() => expect(screen.getByText('No data yet')).toBeInTheDocument());
  });
});
