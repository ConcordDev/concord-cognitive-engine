// S1 — personal-goal + challenge lifecycle (Review 5 F1): edit and
// delete exist, delete is two-step and recoverable via Undo, and a
// failed delete surfaces instead of silently keeping the object.
// The generic lens-data store is mocked; the panels' own wiring is
// what is under test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stores = vi.hoisted(() => ({
  goal: null as unknown as Record<string, unknown>,
  challenge: null as unknown as Record<string, unknown>,
}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, type: string) => (type === 'challenge' ? stores.challenge : stores.goal),
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
import { ChallengesPanel } from '@/components/goals/ChallengesPanel';

// The panels use react-query mutations, so every render needs a client.
function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const goalItem = {
  id: 'g1', title: 'Ship it', version: 1,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
  meta: { tags: [], status: 'active', visibility: 'private' },
  data: {
    title: 'Ship it', description: 'desc', category: 'Career', priority: 'medium',
    targetDate: '2026-12-31', progress: 0.5, xp: 200, milestones: [], status: 'active',
    subtasks: [
      { id: 'st-0', label: 'Step A', done: true },
      { id: 'st-1', label: 'Step B', done: false },
    ],
  },
};

function goalStore(overrides: Record<string, unknown> = {}) {
  return {
    items: [goalItem], total: 1, isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})), ...overrides,
  };
}

beforeEach(() => {
  stores.goal = goalStore();
  stores.challenge = {
    items: [{
      id: 'c1', title: 'Meditate', version: 1,
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      meta: { tags: [], status: 'active', visibility: 'private' },
      data: {
        title: 'Meditate', description: '', type: 'daily', difficulty: 'Easy',
        xp: 50, progress: 1, target: 7, accepted: true,
      },
    }],
    total: 1, isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
  };
});

describe('personal goal lifecycle (F1)', () => {
  it('edit saves the new title and keeps step completion', async () => {
    renderWithClient(<GoalsListPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Ship it/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Edit goal/ }));
    const title = await screen.findByLabelText('Edit goal title');
    fireEvent.change(title, { target: { value: 'Ship it v2' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(stores.goal.update).toHaveBeenCalled());
    const [, payload] = (stores.goal.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.title).toBe('Ship it v2');
    expect(payload.data.subtasks).toHaveLength(2);
    expect(payload.data.subtasks[0].done).toBe(true);
    expect(payload.data.progress).toBe(0.5);
  });

  it('delete is two-step, then Undo restores the goal content', async () => {
    renderWithClient(<GoalsListPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Ship it/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Delete goal/ }));
    expect(stores.goal.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete/ }));
    await waitFor(() => expect(stores.goal.remove).toHaveBeenCalledWith('g1'));
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(stores.goal.create).toHaveBeenCalled());
    const [created] = (stores.goal.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created.title).toBe('Ship it');
    expect(created.data.subtasks).toHaveLength(2);
  });

  it('a failed delete says so and offers no fake undo', async () => {
    stores.goal = goalStore({ remove: vi.fn(async () => { throw new Error('store down'); }) });
    renderWithClient(<GoalsListPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Ship it/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Delete goal/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete/ }));
    expect(await screen.findByText(/Could not delete that goal/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });
});

describe('challenge lifecycle (F1)', () => {
  it('challenge delete is two-step and calls the store remove', async () => {
    renderWithClient(<ChallengesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(stores.challenge.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete/ }));
    await waitFor(() => expect(stores.challenge.remove).toHaveBeenCalledWith('c1'));
  });
});
