/**
 * F23 — task date entry: date inputs draft locally and commit on
 * blur. Per-segment change events (what split-field date controls
 * emit) must not fire task-update, must not banner, and must not
 * reset the field mid-entry; a completed date commits once.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const calls: { action: string; params: Record<string, unknown> }[] = [];
const task = {
  id: 't1', ref: 'PR4-1', title: 'Dated task', description: null, type: 'task',
  status: 'todo', priority: 'medium', assigneeId: null, sprintId: null,
  milestoneId: null, parentId: null, labels: [], customFields: {}, points: 3,
  startDate: null, dueDate: '2026-11-01',
};
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_lens: string, action: string, params: Record<string, unknown>) => {
    calls.push({ action, params });
    if (action === 'task-detail') {
      return { data: { ok: true, result: { task, parent: null, subtasks: [], subtaskProgress: null, relations: [], attachments: [], comments: [], activity: [] } } };
    }
    return { data: { ok: true, result: {} } };
  }),
}));

import { PjTaskDetail } from '../components/projects/PjTaskDetail';

function renderDetail() {
  return render(
    <PjTaskDetail taskId="t1" projectId="p1" members={[]} sprints={[]} milestones={[]}
      labels={[]} customFields={[]} allTasks={[]} onClose={() => {}} onChange={() => {}} />,
  );
}

describe('PjTaskDetail — date entry (F23)', () => {
  beforeEach(() => { calls.length = 0; vi.clearAllMocks(); });

  it('per-segment edits fire no update and no banner; the completed date commits once on blur', async () => {
    renderDetail();
    const due = await screen.findByDisplayValue('2026-11-01');
    // What a split-field control emits while the user types:
    fireEvent.change(due, { target: { value: '' } });
    fireEvent.change(due, { target: { value: '2026-11-15' } });
    expect(calls.filter((c) => c.action === 'task-update')).toHaveLength(0);
    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument();
    fireEvent.blur(due);
    expect(calls.filter((c) => c.action === 'task-update')).toHaveLength(1);
    expect(calls.find((c) => c.action === 'task-update')?.params).toMatchObject({ dueDate: '2026-11-15' });
  });

  it('an abandoned partial entry reverts silently — no update, nothing stored', async () => {
    renderDetail();
    const due = await screen.findByDisplayValue('2026-11-01');
    fireEvent.change(due, { target: { value: '2026-11-' } });
    fireEvent.blur(due);
    expect(calls.filter((c) => c.action === 'task-update')).toHaveLength(0);
    expect((due as HTMLInputElement).value).toBe('2026-11-01');
  });

  it('an empty read-back on blur does NOT erase the stored date (ambiguous with a half-typed entry)', async () => {
    renderDetail();
    const due = await screen.findByDisplayValue('2026-11-01');
    fireEvent.change(due, { target: { value: '' } });
    fireEvent.blur(due);
    expect(calls.filter((c) => c.action === 'task-update')).toHaveLength(0);
    expect((due as HTMLInputElement).value).toBe('2026-11-01');
  });

  it('clearing happens only through the explicit Clear button', async () => {
    renderDetail();
    await screen.findByDisplayValue('2026-11-01');
    fireEvent.click(screen.getByRole('button', { name: 'Clear due date' }));
    const updates = calls.filter((c) => c.action === 'task-update');
    expect(updates).toHaveLength(1);
    expect(updates[0].params).toMatchObject({ dueDate: '' });
  });
});
