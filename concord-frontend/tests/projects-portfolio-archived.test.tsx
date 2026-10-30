/**
 * A31 — Portfolio truth at a glance: by default the list shows active
 * projects only; archived projects sit behind the "Show archived (N)"
 * toggle and carry their Archived pill when shown.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const projects = [
  { id: 'p1', name: 'Active One', key: 'ACT', status: 'started', health: 'on_track', archived: false, targetDate: null, totalTasks: 2, doneTasks: 1, progressPct: 50, points: 5 },
  { id: 'p2', name: 'Archived One', key: 'ARC', status: 'planned', health: 'at_risk', archived: true, targetDate: null, totalTasks: 1, doneTasks: 0, progressPct: 0, points: 3 },
];
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { projects, byHealth: { on_track: 1, at_risk: 0, off_track: 0 } } } })),
}));

import { PjPortfolioPanel } from '../components/projects/PjPortfolioPanel';

describe('PjPortfolioPanel — archived marking (A31)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('default list excludes archived projects; the toggle shows them pill-marked', async () => {
    render(<PjPortfolioPanel />);
    expect(await screen.findByText('Active One')).toBeInTheDocument();
    expect(screen.queryByText('Archived One')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toMatch(/1\s*active/);
    fireEvent.click(screen.getByRole('button', { name: 'Show archived (1)' }));
    expect(await screen.findByText('Archived One')).toBeInTheDocument();
    expect(screen.getByText('Archived', { selector: 'span' })).toBeInTheDocument();
  });
});
