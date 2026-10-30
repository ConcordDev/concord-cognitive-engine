/**
 * A18 — the Assignee picker renders the members it is given. The panels
 * feed it project-get.members; the domain fix makes that payload carry
 * the account rows (owner first). This pins the FE half of the contract:
 * given the owner row, the select offers the owner — self-assignment is
 * possible — and choosing them fires task-update with their account id.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const calls: { action: string; params: Record<string, unknown> }[] = [];
const task = {
  id: 't1', ref: 'A18-1', title: 'Assignable task', description: null, type: 'task',
  status: 'todo', priority: 'medium', assigneeId: null, sprintId: null,
  milestoneId: null, parentId: null, labels: [], customFields: {}, points: 1,
  startDate: null, dueDate: null,
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

describe('PjTaskDetail — Assignee picker (A18)', () => {
  beforeEach(() => { calls.length = 0; vi.clearAllMocks(); });

  it('offers the owner from project-get-shaped members and self-assigns on choose', async () => {
    render(
      <PjTaskDetail taskId="t1" projectId="p1"
        members={[{ id: 'user_a', name: 'usera' }, { id: 'user_bea', name: 'bea' }]}
        sprints={[]} milestones={[]} labels={[]} customFields={[]} allTasks={[]}
        onClose={() => {}} onChange={() => {}} />,
    );
    await screen.findByText('Assignee');
    const select = screen.getAllByRole('combobox').find((s) => Array.from(s.querySelectorAll('option')).some((o) => (o as HTMLOptionElement).value === 'user_a'));
    expect(select).toBeTruthy();
    const options = Array.from(select!.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['Unassigned', 'usera', 'bea']);
    fireEvent.change(select!, { target: { value: 'user_a' } });
    expect(calls.find((c) => c.action === 'task-update')?.params).toMatchObject({ assigneeId: 'user_a' });
  });
});
