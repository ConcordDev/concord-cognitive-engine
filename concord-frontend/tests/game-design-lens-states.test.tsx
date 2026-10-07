/**
 * /lenses/game-design — one design.
 *
 * + New design calls game-design.game-create and shows the title only
 * after game-list contains that id and the same title. The two rules are
 * empty-card chrome, not inputs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

import GameDesignLens from '@/app/lenses/game-design/page';

function listed(games: { id: string; title: string; genre?: string | null; platform?: string | null }[]) {
  return { data: { ok: true, result: { games, count: games.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('game design card', () => {
  it('EMPTY: says no design is open, draws two rules, and offers + New design', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<GameDesignLens />);
    expect(await view.findByText('No design open.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The design' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New design' })).toBeEnabled();
    expect(view.getAllByTestId('gd-rule')).toHaveLength(2);
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.queryByText('Discover')).toBeNull();
    expect(view.queryByText('GDD')).toBeNull();
    expect(view.queryByText('Mechanics')).toBeNull();
    expect(view.queryByText('platformer')).toBeNull();
  });

  it('WARMING: a shed game-list retries and then shows the empty card', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockResolvedValue(listed([]));
    const view = render(<GameDesignLens />);
    expect(await view.findByText('No design open.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<GameDesignLens />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No design open.')).toBeInTheDocument();
  });

  it('DESIGN: a blank title does not call game-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<GameDesignLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New design' }));
    expect(view.queryByText('No design open.')).toBeNull();
    expect(view.queryByTestId('gd-rule')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '+ New design' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('game-create');
  });

  it('DESIGN: shows the title only after game-list contains the id and title', async () => {
    const games: { id: string; title: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'game-list') return listed(games);
      if (action === 'game-create') {
        games.unshift({ id: 'gam_1', title: input?.title || '' });
        return { data: { ok: true, result: { game: { id: 'gam_1', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<GameDesignLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New design' }));
    fireEvent.change(view.getByTestId('gd-title'), { target: { value: '  Door design  ' } });
    fireEvent.click(view.getByRole('button', { name: '+ New design' }));
    expect(await view.findByRole('heading', { name: 'Door design' })).toBeInTheDocument();
    expect(view.queryByText('No design open.')).toBeNull();
    expect(view.queryByTestId('gd-rule')).toBeNull();
    expect(view.queryByText('platformer')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'game-create');
    expect(save?.[0]).toBe('game-design');
    expect(save?.[2]).toEqual({ title: 'Door design' });
  });

  it('DESIGN: a list miss does not show the title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'game-list') return listed([]);
      if (action === 'game-create') {
        return { data: { ok: true, result: { game: { id: 'gam_missing', title: 'Lost design' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<GameDesignLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New design' }));
    fireEvent.change(view.getByTestId('gd-title'), { target: { value: 'Lost design' } });
    fireEvent.click(view.getByRole('button', { name: '+ New design' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost design' })).toBeNull();
  });

  it('GREETING: title-cases the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<GameDesignLens />);
    expect(await view.findByRole('heading', { name: 'The design, Ramaj' })).toBeInTheDocument();
    expect(await view.findByText('No design open.')).toBeInTheDocument();
  });

  it('LOAD: shows a title already on the list, skips a blank title, and hides genre', async () => {
    lensRun.mockResolvedValue(listed([
      { id: 'gam_a', title: 'First design', genre: 'platformer', platform: 'pc' },
      { id: 'gam_b', title: '   ' },
    ]));
    const view = render(<GameDesignLens />);
    expect(await view.findByRole('heading', { name: 'First design' })).toBeInTheDocument();
    expect(view.queryByText('No design open.')).toBeNull();
    expect(view.queryByText('platformer')).toBeNull();
    expect(view.queryByText('pc')).toBeNull();
  });

  it('DESIGN: a refused create does not show the title', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<GameDesignLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New design' }));
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'game-list') return listed([]);
      if (action === 'game-create') return { data: { ok: false, result: null, error: 'design_not_saved' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('gd-title'), { target: { value: 'Bad design' } });
    fireEvent.click(view.getByRole('button', { name: '+ New design' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/design_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad design' })).toBeNull();
    expect(view.getByTestId('gd-title')).toBeInTheDocument();
  });

  it('DESIGN: a second design stays beside the first', async () => {
    const games: { id: string; title: string }[] = [{ id: 'gam_1', title: 'First design' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'game-list') return listed(games);
      if (action === 'game-create') {
        games.unshift({ id: 'gam_2', title: input?.title || '' });
        return { data: { ok: true, result: { game: { id: 'gam_2', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<GameDesignLens />);
    expect(await view.findByRole('heading', { name: 'First design' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '+ New design' }));
    fireEvent.change(view.getByTestId('gd-title'), { target: { value: 'Second design' } });
    fireEvent.click(view.getByRole('button', { name: '+ New design' }));
    expect(await view.findByRole('heading', { name: 'Second design' })).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'First design' })).toBeInTheDocument();
  });
});
