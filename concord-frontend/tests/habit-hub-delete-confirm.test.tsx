// FIX-game-008 — deleting a daily/habit/to-do in HabitHub takes two
// clicks: the trash icon arms a per-row "Confirm delete"; only the
// second click calls game.taskDelete.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import { HabitHub } from '@/components/game/HabitHub';

const TASK = { id: 'task-1', kind: 'daily', title: 'Morning run', notes: '', difficulty: 'easy', completedToday: false, streak: 3, completions: 5 };

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, name: string) => {
    if (name === 'taskList') return { data: { ok: true, result: { tasks: [TASK] } } };
    if (name === 'playerProgress') return { data: { ok: true, result: { xp: 120, level: 2, gold: 40, intoLevel: 20, nextLevelXp: 200, streak: 3, longestStreak: 5, dailiesDone: 1, dailiesTotal: 2, totalTasks: 3 } } };
    return { data: { ok: true, result: {} } };
  });
});
afterEach(() => cleanup());

describe('HabitHub task delete confirmation', () => {
  it('first trash click only arms the confirm; second click deletes', async () => {
    render(<HabitHub />);
    const trash = await screen.findByRole('button', { name: 'Delete task' });
    await act(async () => { fireEvent.click(trash); });
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'taskDelete')).toBe(false);
    const confirm = await screen.findByRole('button', { name: 'Confirm delete task' });
    await act(async () => { fireEvent.click(confirm); });
    const del = lensRunMock.mock.calls.find((c) => c[1] === 'taskDelete');
    expect(del?.[2]).toMatchObject({ id: 'task-1' });
  });
});
