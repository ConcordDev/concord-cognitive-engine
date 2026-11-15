// FIX-goals-009 — reaching "New goal" took ~40 Tabs: the button is a
// position:fixed action, but it was mounted LAST in the panel's DOM,
// after every goal card and all of their controls, and tab order
// follows the DOM, not the visual position. The button now mounts
// first in the panel (its fixed visual placement is unchanged), so it
// is the panel's first keyboard stop. Modelled on goals-lifecycle's
// harness (same store mocks).
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stores = vi.hoisted(() => ({ goal: null as unknown as Record<string, unknown> }));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => stores.goal,
}));
vi.mock('@/components/lens/DraftedTextarea', async () => {
  const React = await import('react');
  return {
    DraftedTextarea: (props: { onValueChange: (v: string) => void; placeholder?: string; className?: string }) =>
      React.createElement('textarea', {
        placeholder: props.placeholder,
        className: props.className,
        onChange: (e: { target: { value: string } }) => props.onValueChange(e.target.value),
      }),
  };
});
vi.mock('@/components/lens/KeepRecordActions', () => ({ KeepRecordActions: () => null }));
vi.mock('@/components/lens/recordKeep', () => ({ goalKeepRecord: () => null }));

import { GoalsListPanel } from '@/components/goals/GoalsListPanel';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function goalItem(id: string, title: string) {
  return {
    id, title, version: 1,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    meta: { tags: [], status: 'active', visibility: 'private' },
    data: {
      title, description: 'desc', category: 'Career', priority: 'medium',
      targetDate: '2026-12-31', progress: 0.5, xp: 200, milestones: [], status: 'active',
      subtasks: [{ id: 'st-0', label: 'Step A', done: false }],
    },
  };
}

describe('FIX-goals-009 — New goal is an early tab stop', () => {
  it('precedes every goal card control in DOM order and opens the form', () => {
    stores.goal = {
      items: [goalItem('g1', 'First goal'), goalItem('g2', 'Second goal')],
      total: 2, isLoading: false, isError: false, error: null,
      createItem: vi.fn(async () => {}), updateItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}), refetch: vi.fn(),
    };
    renderWithClient(<GoalsListPanel />);

    const newGoal = screen.getByRole('button', { name: 'New goal' });
    const firstCard = screen.getByRole('button', { name: /First goal/ });
    // DOCUMENT_POSITION_FOLLOWING (4): firstCard follows newGoal.
    expect(newGoal.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(newGoal);
    expect(screen.getByLabelText('Goal title')).toBeTruthy();
  });
});
