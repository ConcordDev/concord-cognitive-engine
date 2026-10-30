/**
 * Projects typing + focus integrity (Review 4, projects.md F8/F9 — S7).
 *
 * The mechanism under test: text inputs must hold their value locally
 * across the lens's re-renders. Before this slice, custom-field inputs
 * bound straight to server state and saved per keystroke — the refresh
 * snapped the value back mid-typing ("PR4 field value" stored as
 * "Rfeae") — and a sibling field's save replaced the whole detail
 * object, wiping a title/description draft; the Backlog panel swapped
 * its entire tree (search box included) for a skeleton whenever a
 * keystroke's fetch returned zero rows, eating the rest of the word.
 *
 * These tests pin the fix at component level: drafts commit on
 * blur/Enter, a same-task refresh never overwrites a draft, and the
 * Backlog filters stay mounted across empty result frames.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const hoisted = vi.hoisted(() => ({
  calls: [] as { name: string; params: Record<string, unknown> }[],
}));

const TASK = {
  id: 't1', ref: 'APO-1', title: 'Original title', description: 'Original description',
  type: 'task', status: 'backlog', priority: 'none',
  assigneeId: null, sprintId: null, milestoneId: null,
  labels: [] as string[], customFields: { fld1: 'x' } as Record<string, string>,
  points: 0, startDate: null, dueDate: null, createdAt: '', updatedAt: '',
};

vi.mock('@/lib/api/client', () => ({
  lensRun: async (_domain: string, name: string, params: Record<string, unknown> = {}) => {
    hoisted.calls.push({ name, params });
    const ok = (result: unknown) => ({ data: { ok: true, result } });
    if (name === 'task-detail') {
      return ok({
        task: { ...TASK }, parent: null, subtasks: [], subtaskProgress: null,
        relations: [], attachments: [], comments: [], activity: [],
      });
    }
    if (name === 'integration-list') return ok({ integrations: [] });
    if (name === 'project-get') {
      return ok({ project: {}, members: [], sprints: [], milestones: [], labels: [], customFields: [] });
    }
    if (name === 'view-list') return ok({ views: [] });
    if (name === 'task-list') {
      const q = String(params.query || '');
      if (q.includes('focus')) return ok({ tasks: [], count: 0 });
      return ok({
        tasks: [{ id: 't1', ref: 'APO-1', title: 'Subtask item', status: 'todo', priority: 'none', type: 'task', assigneeId: null, sprintId: null, points: 0, dueDate: null, labels: [] }],
        count: 1,
      });
    }
    return ok({});
  },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));
vi.mock('@/components/ui', () => ({
  Skeleton: () => null,
  SkeletonTableRows: () => null,
  ErrorState: ({ message }: { message: string }) => <div>{message}</div>,
}));

import { PjTaskDetail } from '@/components/projects/PjTaskDetail';
import { PjBacklogPanel } from '@/components/projects/PjBacklogPanel';

const callsTo = (name: string) => hoisted.calls.filter((c) => c.name === name);

beforeEach(() => { hoisted.calls = []; });

function fieldInput(container: HTMLElement, label: string): HTMLInputElement {
  const span = [...container.querySelectorAll('span')].find((s) => s.textContent === label);
  const input = span?.closest('label')?.querySelector('input');
  if (!input) throw new Error(`no input for field ${label}`);
  return input as HTMLInputElement;
}

describe('Projects typing integrity — task detail drafts (F8/F9)', () => {
  const renderDetail = () => render(
    <PjTaskDetail
      taskId="t1" projectId="p1"
      members={[]} sprints={[]} milestones={[]} labels={[]}
      customFields={[{ id: 'fld1', name: 'Estimate note', type: 'text', options: [] }]}
      allTasks={[]} onClose={() => {}} onChange={() => {}}
    />,
  );

  it('a custom-field value is a local draft: typing does not save per keystroke, blur commits the whole string', async () => {
    const { container } = renderDetail();
    await screen.findByDisplayValue('Original title');
    const input = fieldInput(container, 'Estimate note');
    expect(input.value).toBe('x');
    fireEvent.change(input, { target: { value: 'PR4 field value' } });
    expect(input.value).toBe('PR4 field value');
    expect(callsTo('task-set-field')).toHaveLength(0, 'no save fires mid-typing');
    fireEvent.blur(input);
    await waitFor(() => expect(callsTo('task-set-field')).toHaveLength(1));
    expect(callsTo('task-set-field')[0].params).toEqual({ taskId: 't1', fieldId: 'fld1', value: 'PR4 field value' });
  });

  it('a sibling save refresh never overwrites the title draft in progress', async () => {
    renderDetail();
    const title = await screen.findByDisplayValue('Original title');
    fireEvent.change(title, { target: { value: 'Original title — still typing' } });
    // Change Status (a select): its patch saves and refreshes the whole
    // detail from the server, which still holds the OLD title. The
    // draft must survive untouched.
    const statusLabel = screen.getByText('Status');
    const statusSelect = statusLabel.closest('label')?.querySelector('select') as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: 'todo' } });
    await waitFor(() => expect(callsTo('task-update')).toHaveLength(1));
    await waitFor(() => expect(callsTo('task-detail').length).toBeGreaterThan(1), 'the refresh landed');
    expect((screen.getByDisplayValue('Original title — still typing') as HTMLInputElement)).toBeTruthy();
  });
});

describe('Projects typing integrity — backlog search (F8)', () => {
  it('the search box stays mounted and keeps its full string across an empty result frame', async () => {
    render(<PjBacklogPanel projectId="p1" onChange={() => {}} />);
    const search = await screen.findByPlaceholderText('Search…');
    fireEvent.change(search, { target: { value: 'Subtask' } });
    await screen.findByText('Subtask item');
    fireEvent.change(search, { target: { value: 'Subtask focus' } });
    await screen.findByText('No issues match these filters.');
    const after = screen.getByPlaceholderText('Search…') as HTMLInputElement;
    expect(after.value).toBe('Subtask focus', 'the full typed string survives the empty frame');
  });
});
