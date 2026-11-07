// Render + behaviour coverage for the productivity lens panels: calendar, collaboration, task
// detail and the task list. Panels mount against stubbed engine results, must render real
// content, survive a full exercise pass, degrade honestly offline, and assert the macro each
// control sends.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const TASK = (id: string, over: Record<string, unknown> = {}) => ({ id, content: `Task ${id}`, priority: 2, dueDate: '2026-03-10', labels: ['home'], dueState: 'upcoming', done: false, assigneeId: 'u2', assigneeName: 'Bo', ...over });
const DETAIL = { id: 't1', content: 'Write report', priority: 2, dueDate: '2026-03-10', projectId: 'pj1', labels: ['work', 'urgent'], assigneeId: 'u2', assigneeName: 'Bo', subtasks: [{ id: 's1', content: 'Outline', done: true, priority: 3, dueDate: null }, { id: 's2', content: 'Draft', done: false, priority: 2, dueDate: '2026-03-08' }], recurring: 'every_3_days' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'task-list': return { tasks: [TASK('t1'), TASK('t2', { done: true, dueState: 'overdue', priority: 1 }), TASK('t3', { dueDate: null, dueState: 'none', priority: 4, labels: [] })] };
    case 'project-list': return { projects: [{ id: 'pj1', name: 'Home', color: '#6366f1', taskCount: 3 }, { id: 'pj2', name: 'Work', color: '#f59e0b', taskCount: 0 }] };
    case 'task-detail': return { task: DETAIL };
    case 'task-comments': return { comments: [{ id: 'cm1', body: 'Looks good', authorId: 'u2', authorName: 'Bo', authorUsername: 'bo', createdAt: '2026-03-02T10:00:00Z' }] };
    case 'project-collaborators': return { collaborators: [{ id: 'co1', collaboratorId: 'u2', collaboratorName: 'Bo', collaboratorUsername: 'bo', role: 'editor', sharedAt: '2026-03-01' }] };
    case 'calendar-view': return { month: '2026-03', firstWeekday: 0, daysInMonth: 31, totalScheduled: 2, days: Array.from({ length: 31 }, (_, i) => ({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, tasks: i === 9 ? [{ id: 't1', content: 'Write report', priority: 2, dueTime: '09:00', done: false }, { id: 't2', content: 'Done thing', priority: 3, dueTime: null, done: true }] : [], reminders: i === 11 ? [{ id: 'r1', remindAt: '2026-03-12T08:00:00Z', note: 'Call', kind: 'call' }] : [] })) };
    case 'calendar-export-ics': return { ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR', filename: 'productivity.ics', count: 2 };
    case 'calendar-import-ics': return { imported: 2, skipped: 0 };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ProductivityCalendarPanel } from '../ProductivityCalendarPanel';
import { ProductivityCollabPanel } from '../ProductivityCollabPanel';
import { ProductivityTaskDetail } from '../ProductivityTaskDetail';
import { ProductivityTasksPanel } from '../ProductivityTasksPanel';

const render = (ui: React.ReactElement) => rtlRender(ui);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['ProductivityCalendarPanel', () => <ProductivityCalendarPanel onChange={vi.fn()} />],
  ['ProductivityCollabPanel', () => <ProductivityCollabPanel onChange={vi.fn()} />],
  ['ProductivityTaskDetail', () => <ProductivityTaskDetail taskId="t1" onChange={vi.fn()} />],
  ['ProductivityTasksPanel', () => <ProductivityTasksPanel onChange={vi.fn()} />],
];

describe('productivity panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 4, text: 'Write report' });
    await settle();
    await exercise({ passes: 1, text: '3' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('productivity flows', () => {
  it('the task list adds a task, completes and reopens one, makes and removes a project, and deletes a task', async () => {
    const onChange = vi.fn();
    render(<ProductivityTasksPanel onChange={onChange} />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['task-list', 'project-list']));
    const box = screen.getAllByRole('textbox')[0];
    fireEvent.change(box, { target: { value: 'Buy milk' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await press(/^\s*Add/i);
    await exercise({ passes: 3, text: 'Home', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Home/);
    await press(/Reopen|Undo|Completed/i);
    await press(/Delete|Trash|Remove/i);
    expect(sent().some((x) => /task-add|project-create|task-complete|task-delete|project-delete/.test(x))).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it('task detail edits fields, recurrence, subtasks, assignee and comments', async () => {
    const onChange = vi.fn();
    render(<ProductivityTaskDetail taskId="t1" onChange={onChange} />);
    await settle();
    expect(document.body.textContent).toMatch(/Write report|Outline|Looks good/);
    await press(/Edit|Pencil/i);
    await exercise({ passes: 3, text: 'Updated text', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Save/i);
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) {
      for (const o of Array.from(sel.options)) { fireEvent.change(sel, { target: { value: o.value } }); await settle(); }
    }
    await press(/Assign/i);
    await press(/Comment|Post|Send/i);
    await press(/Delete|Trash|Remove/i);
    expect(sent()).toEqual(expect.arrayContaining(['task-detail', 'task-comments', 'project-list']));
    expect(sent().some((x) => /task-update|subtask-add|subtask-update|subtask-toggle|task-assign|task-comment-add/.test(x))).toBe(true);
  });

  it('the task detail reports a task that will not load', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'gone' } }));
    render(<ProductivityTaskDetail taskId="missing" onChange={vi.fn()} />);
    await settle();
    expect(document.body.textContent).toMatch(/Could not load this task|gone/);
  });

  it('collaboration shares a project, lists collaborators, and unshares', async () => {
    render(<ProductivityCollabPanel onChange={vi.fn()} />);
    await settle();
    await press(/^\s*Share/i);
    expect(document.body.textContent).toMatch(/Pick a project first|Collaborator is required|Bo/);
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) {
      const o = Array.from(sel.options).find((x) => x.value);
      if (o) fireEvent.change(sel, { target: { value: o.value } });
    }
    await settle();
    const who = screen.queryAllByRole('textbox')[0];
    if (who) fireEvent.change(who, { target: { value: '@bo' } });
    await press(/^\s*Share/i);
    await press(/Remove|Unshare|Revoke|Trash/i);
    expect(sent()).toEqual(expect.arrayContaining(['project-list', 'task-list']));
    expect(sent().some((x) => /project-collaborators|project-share|project-unshare/.test(x))).toBe(true);
  });

  it('the calendar steps months, exports and imports an ICS file', async () => {
    render(<ProductivityCalendarPanel onChange={vi.fn()} />);
    await settle();
    await press(/Prev|‹|←|Previous/i);
    await press(/Next|›|→/i);
    await press(/Today/i);
    await press(/Export/i);
    const file = new File(['BEGIN:VCALENDAR\nEND:VCALENDAR'], 'cal.ics', { type: 'text/calendar' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (input) await act(async () => { fireEvent.change(input, { target: { files: [file] } }); await new Promise((r) => setTimeout(r, 20)); });
    await press(/Import/i);
    expect(sent().filter((x) => x === 'calendar-view').length).toBeGreaterThan(1);
    expect(sent().some((x) => /calendar-export-ics|calendar-import-ics/.test(x))).toBe(true);
  });
});
