/**
 * D1 remainder — the sprint receipt in Activity: the project-level
 * sprint_receipt record renders as a stamped receipt card (not a log
 * line) and survives reload because it is read back from the stream.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const rows = [
  {
    id: 'act_summary', taskId: null, action: 'sprint_receipt',
    detail: 'Sprint "Sprint 1" settled: 2/3 issues, 5/10 points; 1 carried over',
    at: '2026-10-29T14:00:00Z', taskRef: null, taskTitle: null, projectId: 'p1',
    meta: { sprintName: 'Sprint 1', issuesDone: 2, issuesTotal: 3, pointsDone: 5, pointsTotal: 10, carriedOver: 1, settledInFull: false },
  },
  {
    id: 'act_line', taskId: 't1', action: 'sprint_receipt',
    detail: 'Sprint "Sprint 1" settled: 2/3 issues, 5/10 points; 1 carried over',
    at: '2026-10-29T14:00:00Z', taskRef: 'RCP-1', taskTitle: 'Done A', projectId: 'p1', meta: null,
  },
];

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { activity: rows, count: rows.length } } })),
}));

import { PjActivityPanel } from '../components/projects/PjActivityPanel';

describe('PjActivityPanel — D1 receipt card', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the project-level receipt as a stamped card with the settled numbers', async () => {
    render(<PjActivityPanel projectId="p1" />);
    const card = await screen.findByLabelText('Receipt for Sprint 1');
    expect(card).toHaveTextContent('Sprint 1 — settled');
    expect(card).toHaveTextContent('2/3 issues');
    expect(card).toHaveTextContent('5/10 points');
    expect(card).toHaveTextContent('1 carried over');
    expect(card).toHaveTextContent('Settled');
    // The per-issue line still renders inside its issue group.
    expect(screen.getByText('RCP-1')).toBeInTheDocument();
  });
});
