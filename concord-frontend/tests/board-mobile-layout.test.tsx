/**
 * FIX-board-014 + FIX-board-015 — Board at 390px.
 *
 * 014: the view switcher was a single-row overflow-x-auto pill strip, so
 * Workspace and BGG sat beyond the visible width with no wrap. The switcher
 * now wraps below sm (every view visible + tappable) and keeps the
 * scrollable pill strip at sm+.
 * 015: the task detail drawer animated to a fixed 400px inside the flex
 * row — wider than the 390px viewport — so it overflowed and its header
 * clipped. Below sm the drawer is now a full-viewport overlay; sm+ keeps
 * the 400px side panel.
 *
 * jsdom has no layout engine, so the pins assert the responsive contract
 * the classes encode (the desk's live re-walk verifies the rendered fit).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/board/BoardWorkspace', () => ({ BoardWorkspace: () => null }));
vi.mock('@/components/board/BggHotList', () => ({ BggHotList: () => null }));

const TASK_ITEM = {
  id: 't1',
  title: 'Drawer task',
  data: {
    status: 'todo', priority: 'medium', type: 'task', progress: 10,
    description: '', dueDate: '', subtasks: [], comments: [], activity: [],
  },
};
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [TASK_ITEM], isLoading: false, error: null,
    createItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), refetch: vi.fn(),
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ alerts: [], insights: [] }),
}));
vi.mock('@/components/motion/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));

import BoardLensPage from '@/app/lenses/board/page';
import { TasksPanel } from '@/components/board/TasksPanel';

describe('FIX-board-014 — view switcher at mobile width', () => {
  it('wraps below sm so Workspace and BGG are visible without sideways scrolling', () => {
    render(<BoardLensPage />);
    const nav = screen.getByRole('navigation', { name: 'Board views' });
    expect(nav.className).toContain('flex-wrap');
    expect(nav.className).toContain('sm:flex-nowrap');
    expect(nav.className).toContain('sm:overflow-x-auto');
    for (const label of ['Board', 'Timeline', 'Table', 'Workspace', 'BGG']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
  });
});

describe('FIX-board-015 — task drawer at mobile width', () => {
  it('opens as a full-viewport overlay below sm and a 400px panel at sm+', async () => {
    render(<TasksPanel mode="board" />);
    fireEvent.click(screen.getByRole('button', { name: /Drawer task/ }));
    const drawer = await screen.findByTestId('board-task-drawer', {}, { timeout: 3000 }).catch(() => null);
    const el = drawer ?? document.querySelector('#board-task-drawer');
    expect(el).toBeTruthy();
    expect(el!.className).toContain('w-[100vw]');
    expect(el!.className).toContain('sm:w-[400px]');
    expect(el!.className).toContain('fixed');
    expect(el!.className).toContain('sm:static');
  });
});
