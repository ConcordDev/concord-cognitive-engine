// Behaviour tests for the Projects Team + My Work surfaces (slice
// S4/D3 — real accounts only). PjTeamPanel: members render as accounts
// (owner pinned, level shown), adding submits a @username + level to
// member-add, removing calls member-delete with the project scope, and
// the owner row offers no removal. PjMyWorkPanel: the caller's queue
// renders grouped by due state with project context, completing a row
// writes task-move-status done, and shared-with-me projects render as
// discovery rows.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PjTeamPanel } from '@/components/projects/PjTeamPanel';
import { PjMyWorkPanel } from '@/components/projects/PjMyWorkPanel';

const calls: { action: string; params: Record<string, unknown> }[] = [];
let fixtures: Record<string, unknown> = {};

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string, params: Record<string, unknown>) => {
    calls.push({ action, params });
    const f = fixtures[action];
    return { data: { ok: true, result: typeof f === 'function' ? (f as (p: Record<string, unknown>) => unknown)(params) : f } };
  }),
}));
vi.mock('@/lib/utils', () => ({ cn: (...parts: unknown[]) => parts.filter(Boolean).join(' ') }));
vi.mock('@/components/ui', () => ({
  SkeletonTableRows: () => null,
  ErrorState: ({ message }: { message: string }) => <div>{message}</div>,
}));

const MEMBERS = {
  members: [
    { id: 'user_a', userId: 'user_a', name: 'usera', username: 'usera', level: 'owner', assigned: 2 },
    { id: 'user_bea', userId: 'user_bea', name: 'bea', username: 'bea', level: 'edit', assigned: 1 },
  ],
  count: 2,
};

beforeEach(() => {
  calls.length = 0;
  fixtures = { 'member-list': MEMBERS, 'member-add': { member: { id: 'user_cy', userId: 'user_cy', name: 'cy', username: 'cy', level: 'view', assigned: 0 } }, 'member-delete': { deleted: 'user_bea' } };
});

describe('PjTeamPanel — accounts', () => {
  it('renders members as accounts with levels; the owner cannot be removed', async () => {
    render(<PjTeamPanel projectId="p1" onChange={() => {}} />);
    expect(await screen.findByText('bea')).toBeTruthy();
    expect(screen.getByText('@bea')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    // Scope to Bea's row: the level <option> in the add form carries the
    // same words (the /APO/ lesson — ambiguous text queries throw).
    const beaRow = screen.getByText('@bea').closest('li');
    expect(beaRow).toBeTruthy();
    expect(within(beaRow as HTMLElement).getByText('Can edit')).toBeTruthy();
    expect(screen.getAllByLabelText('Remove member')).toHaveLength(1);
  });

  it('adds a member by username with the chosen level', async () => {
    render(<PjTeamPanel projectId="p1" onChange={() => {}} />);
    await screen.findByText('bea');
    fireEvent.change(screen.getByPlaceholderText(/Concord username/), { target: { value: '@cy' } });
    fireEvent.click(screen.getByRole('button', { name: /Member/ }));
    await waitFor(() => {
      const add = calls.find((c) => c.action === 'member-add');
      expect(add?.params).toEqual({ projectId: 'p1', account: '@cy', level: 'edit' });
    });
  });

  it('removing a member revokes with the project scope', async () => {
    render(<PjTeamPanel projectId="p1" onChange={() => {}} />);
    await screen.findByText('bea');
    fireEvent.click(screen.getByLabelText('Remove member'));
    await waitFor(() => {
      const del = calls.find((c) => c.action === 'member-delete');
      expect(del?.params).toEqual({ projectId: 'p1', id: 'user_bea' });
    });
  });
});

describe('PjMyWorkPanel — the morning queue', () => {
  it('groups by due state, completes through the status path, and shows shared projects', async () => {
    const today = new Date().toISOString().slice(0, 10);
    fixtures = {
      'my-work': {
        tasks: [
          { id: 't1', ref: 'APO-1', title: 'Overdue thing', projectId: 'p1', projectName: 'Apollo', projectKey: 'APO', priority: 'high', dueDate: '2020-01-01', status: 'todo' },
          { id: 't2', ref: 'ZEP-1', title: 'Today thing', projectId: 'p2', projectName: 'Zephyr', projectKey: 'ZEP', priority: 'none', dueDate: today, status: 'todo' },
          { id: 't3', ref: 'APO-2', title: 'Someday thing', projectId: 'p1', projectName: 'Apollo', projectKey: 'APO', priority: 'none', dueDate: null, status: 'backlog' },
        ],
        count: 3,
      },
      'shared-with-me': { projects: [{ projectId: 'p9', name: "Bea's Board", key: 'BEA', level: 'view', ownerName: 'bea' }], count: 1 },
      'task-move-status': { task: { id: 't1', status: 'done' } },
    };
    const onOpenTask = vi.fn();
    render(<PjMyWorkPanel onOpenTask={onOpenTask} />);
    expect(await screen.findByText('Overdue thing')).toBeTruthy();
    expect(screen.getByText('Overdue · 1')).toBeTruthy();
    expect(screen.getByText('Due today · 1')).toBeTruthy();
    expect(screen.getByText('No due date · 1')).toBeTruthy();
    expect(screen.getByText("Bea's Board")).toBeTruthy();
    fireEvent.click(screen.getByText('Today thing'));
    expect(onOpenTask).toHaveBeenCalledWith('p2', 't2');
    fireEvent.click(screen.getByLabelText('Complete APO-1'));
    await waitFor(() => {
      const move = calls.find((c) => c.action === 'task-move-status');
      expect(move?.params).toEqual({ id: 't1', status: 'done' });
    });
  });

  it('an empty queue says so plainly', async () => {
    fixtures = { 'my-work': { tasks: [], count: 0 }, 'shared-with-me': { projects: [], count: 0 } };
    render(<PjMyWorkPanel onOpenTask={() => {}} />);
    expect(await screen.findByText(/Nothing assigned to you right now/)).toBeTruthy();
  });
});
