// Behavior test for XpActivityFeed — the real per-event XP/gold activity
// feed that replaced the game lens History tab's old "not tracked yet"
// honest-note placeholder. Backed by `lensRun('game', 'xpLogList', …)`
// (server/domains/game.js). Covers: render, entry ordering + source/label/
// delta display, the lifetime-total summary, the honest empty state, the
// source filter re-fetching with the right param, and the error path.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { XpActivityFeed } from '@/components/game/XpActivityFeed';

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'xplog_1', source: 'task', label: 'Write tests', refId: 'task_1',
  xpDelta: 37, goldDelta: 15, xpAfter: 137, levelAfter: 1,
  at: new Date().toISOString(),
  ...over,
});

describe('XpActivityFeed', () => {
  beforeEach(() => lensRun.mockReset());

  it('shows the honest empty state when the log has no entries yet', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { entries: [], count: 0, totalXpAllTime: 0, totalGoldAllTime: 0 } } });
    render(<XpActivityFeed />);
    expect(await screen.findByText(/No XP earned yet/i)).toBeInTheDocument();
  });

  it('renders entries in the order the server returned them, with real label/source', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          entries: [
            entry({ id: 'xplog_2', source: 'challenge_prize', label: 'Sprint to 5', xpDelta: 100, goldDelta: 50 }),
            entry({ id: 'xplog_1', source: 'task', label: 'Write tests', xpDelta: 37, goldDelta: 15 }),
          ],
          count: 2, totalXpAllTime: 137, totalGoldAllTime: 65,
        },
      },
    });
    render(<XpActivityFeed />);
    const rows = await screen.findAllByText(/Sprint to 5|Write tests/);
    expect(rows[0].textContent).toBe('Sprint to 5');
    expect(rows[1].textContent).toBe('Write tests');
  });

  it('shows a positive xpDelta with a + sign and its goldDelta', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { entries: [entry({ xpDelta: 37, goldDelta: 15 })], count: 1, totalXpAllTime: 37, totalGoldAllTime: 15 } },
    });
    render(<XpActivityFeed />);
    expect(await screen.findByText('+37 XP')).toBeInTheDocument();
    expect(screen.getByText('+15 gold')).toBeInTheDocument();
  });

  it('shows a negative xpDelta (task-undone penalty) as a plain negative number, no + sign', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { entries: [entry({ label: 'Skip the gym', xpDelta: -12, goldDelta: 0 })], count: 1, totalXpAllTime: -12, totalGoldAllTime: 0 } },
    });
    render(<XpActivityFeed />);
    const xpText = await screen.findByText('-12 XP');
    expect(xpText).toBeInTheDocument();
    // goldDelta === 0 → this row's own gold line is not rendered (the
    // lifetime-total summary boxes above still legitimately say "gold", so
    // scope the assertion to the row itself, not the whole document).
    const row = xpText.closest('.lens-card');
    expect(row).not.toBeNull();
    expect(row?.textContent).not.toMatch(/gold/i);
  });

  it('renders the lifetime XP + gold totals summary from the server, not a client-side sum', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          entries: [entry({ xpDelta: 10, goldDelta: 5 })], // page total (10) differs from lifetime total (999)
          count: 1, totalXpAllTime: 999, totalGoldAllTime: 444,
        },
      },
    });
    render(<XpActivityFeed />);
    expect(await screen.findByText('999')).toBeInTheDocument();
    expect(screen.getByText('444')).toBeInTheDocument();
    expect(screen.getByText(/Lifetime XP earned/i)).toBeInTheDocument();
    expect(screen.getByText(/Lifetime gold earned/i)).toBeInTheDocument();
  });

  it('labels each source distinctly (task / party_quest / challenge_prize)', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          entries: [
            entry({ id: 'a', source: 'task', label: 'Do dishes' }),
            entry({ id: 'b', source: 'party_quest', label: 'Clear the vault' }),
            entry({ id: 'c', source: 'challenge_prize', label: 'Sprint to 5' }),
          ],
          count: 3, totalXpAllTime: 200, totalGoldAllTime: 100,
        },
      },
    });
    render(<XpActivityFeed />);
    await screen.findByText('Do dishes');
    // The row's meta tag ("Party Quest · 3m ago") is distinct from the
    // "Party" filter button — match the exact combined tag text.
    expect(screen.getByText((_, node) => node?.textContent === 'Party Quest · just now')).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === 'Challenge · just now')).toBeInTheDocument();
  });

  it('falls back to "Other" for an unrecognized source without crashing', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { entries: [entry({ source: 'mystery_source', label: 'Weird event' })], count: 1, totalXpAllTime: 37, totalGoldAllTime: 15 } },
    });
    render(<XpActivityFeed />);
    expect(await screen.findByText('Weird event')).toBeInTheDocument();
    expect(screen.getByText(/Other/)).toBeInTheDocument();
  });

  it('a null label falls back to the source display name', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { entries: [entry({ label: null, source: 'task' })], count: 1, totalXpAllTime: 37, totalGoldAllTime: 15 } },
    });
    render(<XpActivityFeed />);
    // Two "Task" strings render: the row title fallback + the meta tag.
    expect((await screen.findAllByText('Task')).length).toBeGreaterThanOrEqual(1);
  });

  it('clicking a source filter re-fetches with the matching source param', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { entries: [], count: 0, totalXpAllTime: 0, totalGoldAllTime: 0 } } });
    render(<XpActivityFeed />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));
    expect(lensRun).toHaveBeenLastCalledWith('game', 'xpLogList', { limit: 25 });

    fireEvent.click(screen.getByRole('button', { name: 'Challenges' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));
    expect(lensRun).toHaveBeenLastCalledWith('game', 'xpLogList', { source: 'challenge_prize', limit: 25 });
  });

  it('clicking "All" after a filter re-fetches without a source param', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { entries: [], count: 0, totalXpAllTime: 0, totalGoldAllTime: 0 } } });
    render(<XpActivityFeed />);
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(3));
    expect(lensRun).toHaveBeenLastCalledWith('game', 'xpLogList', { limit: 25 });
  });

  it('renders a real error message when the backend returns ok:false', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'boom' } });
    render(<XpActivityFeed />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('handles a malformed/empty response without crashing (falls into the honest error path)', async () => {
    lensRun.mockResolvedValue({ data: {} });
    render(<XpActivityFeed />);
    // `data.ok` is undefined (falsy) → the component treats this the same
    // as an explicit ok:false and surfaces the fallback error message,
    // rather than silently rendering as if zero XP had genuinely loaded.
    expect(await screen.findByText('Failed to load activity')).toBeInTheDocument();
  });

  it('renders every distinct entry as its own row (no dedup/collapse)', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          entries: [entry({ id: 'x1' }), entry({ id: 'x2' }), entry({ id: 'x3' })],
          count: 3, totalXpAllTime: 111, totalGoldAllTime: 45,
        },
      },
    });
    const { container } = render(<XpActivityFeed />);
    await screen.findByText(/Lifetime XP earned/i);
    const rows = within(container).getAllByText('Write tests');
    expect(rows.length).toBe(3);
  });
});
