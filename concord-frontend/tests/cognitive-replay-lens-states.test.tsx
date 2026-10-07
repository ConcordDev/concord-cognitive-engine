/**
 * /lenses/cognitive-replay — one moment.
 *
 * Choose a moment calls cognitive-replay.moment-choose and shows the
 * title only after moment-list contains that id and the same title, and
 * the line only after moment-detail returns it. Role and brain stay off
 * the card.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: null as { username: string } | null },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import CognitiveReplayPage from '@/app/lenses/cognitive-replay/page';
import { StatsBar } from '@/components/cognitive-replay/StatsBar';

function listed(rows: { id: string; title: string }[]) {
  return { data: { ok: true, result: { moments: rows, count: rows.length }, error: null } };
}

function opened(id: string, line: string) {
  return { data: { ok: true, result: { moment: { id, title: 'kept', line } }, error: null } };
}

function lensReply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('cognitive replay card', () => {
  it('EMPTY: says no moment chosen and offers Choose a moment', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitiveReplayPage />);
    expect(await view.findByText('No moment chosen.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Replay the moment' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Choose a moment' })).toBeEnabled();
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.queryByText('Wrapped')).toBeNull();
    expect(view.queryByText('Heatmap')).toBeNull();
  });

  it('WARMING: a shed moment-list retries and then shows the empty card', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockResolvedValue(listed([]));
    const view = render(<CognitiveReplayPage />);
    expect(await view.findByText('No moment chosen.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<CognitiveReplayPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No moment chosen.')).toBeInTheDocument();
  });

  it('does not send a blank title', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitiveReplayPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Choose a moment' }));
    fireEvent.click(view.getByRole('button', { name: 'Choose a moment' }));
    expect(view.getByText('A title is required.')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('does not send a blank line', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitiveReplayPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Choose a moment' }));
    fireEvent.change(view.getByTestId('cr-title'), { target: { value: 'Door moment' } });
    fireEvent.click(view.getByRole('button', { name: 'Choose a moment' }));
    expect(view.getByText('A line is required.')).toBeInTheDocument();
    expect(lensRun.mock.calls.some((call) => call[1] === 'moment-choose')).toBe(false);
  });

  it('shows the title and the line only after list and detail match', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitiveReplayPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Choose a moment' }));
    fireEvent.change(view.getByTestId('cr-title'), { target: { value: 'Door moment' } });
    fireEvent.change(view.getByTestId('cr-line-input'), { target: { value: 'the hinge question' } });
    lensRun.mockImplementation((domain: string, name: string) => {
      if (name === 'moment-choose') {
        return Promise.resolve({ data: { ok: true, result: { momentId: 'cr_door' }, error: null } });
      }
      if (name === 'moment-list') return Promise.resolve(listed([{ id: 'cr_door', title: 'Door moment' }]));
      if (name === 'moment-detail') return Promise.resolve(opened('cr_door', 'the hinge question'));
      return Promise.resolve({ data: { ok: false, result: null, error: `unexpected ${domain}.${name}` } });
    });
    fireEvent.click(view.getByRole('button', { name: 'Choose a moment' }));
    expect(await view.findByRole('heading', { name: 'Door moment' })).toBeInTheDocument();
    expect(view.getByTestId('cr-line')).toHaveTextContent('the hinge question');
    const choose = lensRun.mock.calls.find((call) => call[1] === 'moment-choose');
    expect(choose?.[2]).toEqual({ title: 'Door moment', line: 'the hinge question' });
    expect(view.queryByText('conscious')).toBeNull();
  });

  it('stays on the composer when the list does not contain the new id', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitiveReplayPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Choose a moment' }));
    fireEvent.change(view.getByTestId('cr-title'), { target: { value: 'Door moment' } });
    fireEvent.change(view.getByTestId('cr-line-input'), { target: { value: 'the hinge question' } });
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'moment-choose') {
        return Promise.resolve({ data: { ok: true, result: { momentId: 'cr_door' }, error: null } });
      }
      if (name === 'moment-list') return Promise.resolve(listed([]));
      return Promise.resolve(opened('cr_door', 'the hinge question'));
    });
    fireEvent.click(view.getByRole('button', { name: 'Choose a moment' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.getByTestId('cr-title')).toBeInTheDocument();
  });

  it('greets the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitiveReplayPage />);
    expect(await view.findByRole('heading', { name: 'Replay the moment, Ramaj' })).toBeInTheDocument();
  });

  it('loads a stored moment and does not render a brain', async () => {
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'moment-list') return Promise.resolve(listed([{ id: 'cr_door', title: 'Door moment' }]));
      if (name === 'moment-detail') return Promise.resolve(opened('cr_door', 'the hinge question'));
      return Promise.resolve(listed([]));
    });
    const view = render(<CognitiveReplayPage />);
    expect(await view.findByRole('heading', { name: 'Door moment' })).toBeInTheDocument();
    expect(view.getByTestId('cr-line')).toHaveTextContent('the hinge question');
    expect(view.queryByText('No moment chosen.')).toBeNull();
    expect(view.queryByText('conscious')).toBeNull();
  });

  it('stays on the composer when choose is refused', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitiveReplayPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Choose a moment' }));
    fireEvent.change(view.getByTestId('cr-title'), { target: { value: 'Door moment' } });
    fireEvent.change(view.getByTestId('cr-line-input'), { target: { value: 'the hinge question' } });
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'moment_not_saved' } });
    fireEvent.click(view.getByRole('button', { name: 'Choose a moment' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/moment_not_saved/);
    expect(view.getByTestId('cr-title')).toBeInTheDocument();
  });
});

describe('cognitive-replay lens — StatsBar child four UX states', () => {
  it('LOADING: StatsBar shows a role=status indicator while stats is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {}));
    const { container, getByText } = render(<StatsBar sinceDays={7} />);
    await waitFor(() => expect(getByText(/Computing aggregate stats/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('ERROR: a failed stats load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation(() => {
      if (fail) return Promise.resolve({ data: { ok: false, error: 'stats offline' } });
      return lensReply({
        sinceDays: 7, turns: 3, sessions: 2, totalTokens: 320, avgTokensPerTurn: 107,
        totalToolCalls: 3, totalCitations: 3, topBrain: { brain: 'conscious', turns: 2 },
        topTool: null, busiestDay: { day: '2023-11-14', turns: 2 }, brainCounts: { conscious: 2 }, spanDays: 4,
      });
    });
    const { container, getByText } = render(<StatsBar sinceDays={7} />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/stats offline/i)).toBeInTheDocument();
    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(getByText('320')).toBeInTheDocument());
  });

  it('POPULATED: renders the real aggregate values from the stats macro', async () => {
    lensRun.mockImplementation(() => lensReply({
      sinceDays: 7, turns: 3, sessions: 2, totalTokens: 320, avgTokensPerTurn: 107,
      totalToolCalls: 3, totalCitations: 3, topBrain: { brain: 'conscious', turns: 2 },
      topTool: null, busiestDay: { day: '2023-11-14', turns: 2 }, brainCounts: { conscious: 2 }, spanDays: 4,
    }));
    const { getByText } = render(<StatsBar sinceDays={7} />);
    await waitFor(() => expect(getByText('320')).toBeInTheDocument());
    expect(getByText('conscious')).toBeInTheDocument();
    expect(getByText(/2 sessions/i)).toBeInTheDocument();
  });
});
