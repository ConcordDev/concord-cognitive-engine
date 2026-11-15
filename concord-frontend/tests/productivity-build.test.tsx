// concord-frontend/tests/productivity-build.test.tsx
//
// Productivity full lens build (B2) — pins:
//   F1  the agenda sends the viewer's local today; bucket labels match
//       their dates; overdue tasks render once, in the Overdue group
//   F2  the task detail wires task-update: a rename saves through it
//   F3  completed tasks list in Tasks with a Reopen action
//   F6  comment authors render by resolved name, not raw user id
//   F7  a project delete asks before it fires
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/ui', () => ({
  ErrorState: ({ message }: { message: string }) => React.createElement('div', null, message),
}));

import { ProductivityTodayPanel } from '@/components/productivity/ProductivityTodayPanel';
import { ProductivityTasksPanel } from '@/components/productivity/ProductivityTasksPanel';
import { ProductivityTaskDetail } from '@/components/productivity/ProductivityTaskDetail';

const pad = (n: number) => String(n).padStart(2, '0');
function localDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function labelFor(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
const task = (over: Record<string, unknown>) => ({
  id: 't1', content: 'Task', priority: 4, dueDate: null, labels: [], ...over,
});

beforeEach(() => { lensRunMock.mockReset(); });

describe('Today agenda (F1)', () => {
  it('sends local today, labels buckets by their own date, overdue renders once in its group', async () => {
    const overdueTask = task({ id: 't-old', content: 'Overdue thing', dueDate: localDay(-2), dueState: 'overdue' });
    const todayTask = task({ id: 't-now', content: 'Today thing', dueDate: localDay(0), dueState: 'today' });
    const tomorrowTask = task({ id: 't-tom', content: 'Tomorrow thing', dueDate: localDay(1), dueState: 'upcoming' });
    const days = Array.from({ length: 7 }, (_, i) => ({
      date: localDay(i),
      tasks: i === 1 ? [tomorrowTask] : [],
    }));
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'today-view') return { data: { ok: true, result: { tasks: [overdueTask, todayTask], overdue: 1, dueToday: 1 } } };
      if (action === 'upcoming-view') return { data: { ok: true, result: { days, overdue: [overdueTask] } } };
      return { data: { ok: true, result: {} } };
    });

    render(<ProductivityTodayPanel onChange={() => {}} />);

    expect(await screen.findByText('Today thing')).toBeInTheDocument();
    expect(screen.getAllByText('Overdue thing')).toHaveLength(1);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText(labelFor(localDay(1)))).toBeInTheDocument();
    expect(screen.getByText('Tomorrow thing')).toBeInTheDocument();
    const todayCalls = lensRunMock.mock.calls.filter((c) => c[1] === 'today-view');
    expect(todayCalls[0][2]).toEqual({ today: localDay(0) });
  });
});

describe('Tasks panel lifecycle (F3/F7)', () => {
  it('completed tasks reopen from the Completed section; project delete confirms first', async () => {
    const open = task({ id: 't-open', content: 'Open task' });
    const done = task({ id: 't-done', content: 'Finished task', done: true });
    lensRunMock.mockImplementation(async (_d: string, action: string, params: Record<string, unknown> = {}) => {
      if (action === 'task-list' && params.includeDone) return { data: { ok: true, result: { tasks: [open, done] } } };
      if (action === 'task-list') return { data: { ok: true, result: { tasks: [open] } } };
      if (action === 'project-list') return { data: { ok: true, result: { projects: [{ id: 'p1', name: 'Proj', color: 'blue', taskCount: 1 }] } } };
      return { data: { ok: true, result: {} } };
    });

    render(<ProductivityTasksPanel onChange={() => {}} />);
    expect(await screen.findByText('Open task')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Completed \(1\)/));
    expect(await screen.findByText('Finished task')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('productivity', 'task-complete', { id: 't-done', reopen: true }));

    fireEvent.click(screen.getByLabelText('Delete Proj'));
    expect(await screen.findByText('Delete?')).toBeInTheDocument();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'project-delete')).toBe(false);
    fireEvent.click(screen.getByLabelText('Confirm delete Proj'));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('productivity', 'project-delete', { id: 'p1' }));
  });
});

describe('Task detail editing + attribution (F2/F6)', () => {
  it('renames through task-update; comments show the author name', async () => {
    const detail = task({
      id: 't1', content: 'Old title', priority: 2, dueDate: null, projectId: null, labels: [],
      assigneeId: null, subtasks: [], recurring: null,
    });
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'task-detail') return { data: { ok: true, result: { task: detail } } };
      if (action === 'task-comments') {
        return { data: { ok: true, result: { comments: [
          { id: 'c1', body: 'Nice work', authorId: '0a6c582d-dead-beef', authorName: 'Ada Lovelace', createdAt: '2026-10-31T14:05:00.000Z' },
        ] } } };
      }
      if (action === 'project-list') return { data: { ok: true, result: { projects: [] } } };
      return { data: { ok: true, result: {} } };
    });

    render(<ProductivityTaskDetail taskId="t1" onChange={() => {}} />);
    expect(await screen.findByText('Old title')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/0a6c582d/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit task' }));
    const titleInput = await screen.findByLabelText('Task title');
    fireEvent.change(titleInput, { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'productivity', 'task-update',
      expect.objectContaining({ id: 't1', content: 'New title' }),
    ));
  });
});

describe('Task row edit (FIX-productivity-005)', () => {
  it('opens the saved task from the list and renames it', async () => {
    const open = task({ id: 't1', content: 'Old title', priority: 2, dueDate: '2026-11-12' });
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'task-list') return { data: { ok: true, result: { tasks: [open] } } };
      if (action === 'project-list') return { data: { ok: true, result: { projects: [] } } };
      if (action === 'task-detail') return { data: { ok: true, result: { task: { ...open, subtasks: [], recurring: null, labels: [] } } } };
      if (action === 'task-comments') return { data: { ok: true, result: { comments: [] } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ProductivityTasksPanel onChange={() => {}} />);
    expect(await screen.findByText('Old title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Old title' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit task' }));
    const titleInput = await screen.findByLabelText('Task title');
    fireEvent.change(titleInput, { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'productivity', 'task-update',
      expect.objectContaining({ id: 't1', content: 'New title' }),
    ));
  });
});
