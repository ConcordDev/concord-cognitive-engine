// S13 — honest chrome + XP rules (Review 5 F14) and §3b proposals
// 3–4: challenge XP counts in the Milestones total and the rules are
// stated where XP is shown; a completed goal's timeline entry keeps
// its real-data record; "Set a weekly focus" opens a real picker and
// the chosen goal wears the focus line. Store mocked as in the S1
// lifecycle suite; the panels' wiring is what is under test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

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

import { GoalsListPanel, GOALS_NEW_EVENT } from '@/components/goals/GoalsListPanel';
import { ChallengesPanel } from '@/components/goals/ChallengesPanel';
import { MilestonesPanel } from '@/components/goals/MilestonesPanel';

function store(items: unknown[]) {
  return {
    items, total: items.length, isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
  };
}

const completedGoal = {
  id: 'g9', title: 'Done thing', version: 1,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-12-03T00:00:00.000Z',
  meta: { tags: [], status: 'active', visibility: 'private' },
  data: {
    title: 'Done thing', description: '', category: 'Career', priority: 'medium',
    targetDate: '', progress: 1, xp: 200, milestones: [], status: 'completed',
    subtasks: [
      { id: 'st-0', label: 'Step A', done: true },
      { id: 'st-1', label: 'Step B', done: true },
    ],
  },
};

const activeGoal = {
  id: 'g1', title: 'Ship it', version: 1,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
  meta: { tags: [], status: 'active', visibility: 'private' },
  data: {
    title: 'Ship it', description: '', category: 'Career', priority: 'medium',
    targetDate: '', progress: 0, xp: 200, milestones: [], status: 'active', subtasks: [],
  },
};

function challengeItem(id: string, progress: number, target: number, xp: number) {
  return {
    id, title: `Challenge ${id}`, version: 1,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    meta: { tags: [], status: 'active', visibility: 'private' },
    data: {
      title: `Challenge ${id}`, description: '', type: 'daily', difficulty: 'Easy',
      xp, progress, target, accepted: true,
    },
  };
}

beforeEach(() => {
  stores.goal = store([completedGoal]);
  stores.challenge = store([challengeItem('c1', 7, 7, 50), challengeItem('c2', 1, 7, 150)]);
});

describe('XP coherence (F14)', () => {
  it('Milestones total counts completed challenge XP as well as goal XP', () => {
    render(<MilestonesPanel />);
    // 200 (goal) + 50 (completed challenge); the incomplete 150 stays out.
    expect(screen.getByText(/250 XP earned/)).toBeTruthy();
    expect(screen.getByText(/XP rules:/)).toBeTruthy();
  });

  it('the timeline keeps the completion record from real data', () => {
    render(<MilestonesPanel />);
    expect(screen.getByText(/2 steps · 63 days/)).toBeTruthy();
  });

  it('the challenge card states when its XP is earned', () => {
    render(<ChallengesPanel />);
    expect(screen.getAllByText(/XP on completion/).length).toBeGreaterThan(0);
  });
});

describe('weekly focus (F14 / §3b 4)', () => {
  it('the page chip event opens a picker; choosing a goal sets weeklyFocus', async () => {
    stores.goal = store([activeGoal]);
    render(<GoalsListPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent(GOALS_NEW_EVENT, { detail: { weekly: true } }));
    });
    const pick = await screen.findByRole('button', { name: /Set Ship it as weekly focus/ });
    fireEvent.click(pick);
    const update = stores.goal.update as ReturnType<typeof vi.fn>;
    expect(update).toHaveBeenCalled();
    const [, payload] = update.mock.calls[0];
    expect(payload.data.weeklyFocus).toBe(true);
  });

  it('a focused goal wears the focus line on its card', () => {
    const focused = {
      ...activeGoal,
      data: { ...activeGoal.data, weeklyFocus: true },
    };
    stores.goal = store([focused]);
    render(<GoalsListPanel />);
    expect(screen.getByText(/This week's focus/)).toBeTruthy();
  });
});
