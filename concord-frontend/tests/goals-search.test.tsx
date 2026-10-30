// S14 — in-lens goal search (Review 5 flow 17): a title fragment
// finds the goal across kinds (personal goal, challenge, objective);
// clicking a result navigates to the owning view; nonsense gets an
// honest empty state. Stores and lensRun mocked; the component's
// wiring is what is under test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const stores = vi.hoisted(() => ({
  goal: null as unknown as Record<string, unknown>,
  challenge: null as unknown as Record<string, unknown>,
}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, type: string) => (type === 'challenge' ? stores.challenge : stores.goal),
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({
    data: {
      ok: true,
      result: {
        flat: [{ id: 'o1', title: 'Ship the roadmap', level: 'company' }],
        tree: [],
        stats: null,
      },
    },
  })),
}));

import { GoalSearch } from '@/components/goals/GoalSearch';

function store(items: unknown[]) {
  return {
    items, total: items.length, isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
  };
}

beforeEach(() => {
  stores.goal = store([{
    id: 'g1', title: 'Ship it',
    data: { title: 'Ship it', description: '', status: 'active' },
  }]);
  stores.challenge = store([{
    id: 'c1', title: 'Ship drills',
    data: { title: 'Ship drills', progress: 2, target: 7 },
  }]);
});

describe('goal search (flow 17)', () => {
  it('finds the test goal by title fragment across all three kinds', async () => {
    render(<GoalSearch onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search goals'), { target: { value: 'ship' } });
    expect(await screen.findByText('Ship it')).toBeTruthy();
    expect(screen.getByText('Ship drills')).toBeTruthy();
    expect(await screen.findByText('Ship the roadmap')).toBeTruthy();
  });

  it('clicking an objective result navigates to the OKR view', async () => {
    const onNavigate = vi.fn();
    render(<GoalSearch onNavigate={onNavigate} />);
    fireEvent.change(screen.getByLabelText('Search goals'), { target: { value: 'roadmap' } });
    fireEvent.click(await screen.findByText('Ship the roadmap'));
    expect(onNavigate).toHaveBeenCalledWith('okr');
  });

  it('nonsense gets an honest empty state', async () => {
    render(<GoalSearch onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search goals'), { target: { value: 'zzzzqq' } });
    expect(await screen.findByText(/No goals match/)).toBeTruthy();
  });
});
