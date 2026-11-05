/**
 * /lenses/game-design — the workbench shell.
 *
 * The page's own responsibility is just the admission-gate warm-up
 * retry on the first game-list call (loading/error/retry) — once that
 * clears it hands off entirely to <GameDesignSection>, which owns the
 * design roster, lifecycle (rename/delete), and every workbench tab.
 * GameDesignSection is mocked here (it's a large pre-existing,
 * independently-maintained component) so this file stays focused on the
 * page's own phase-gating contract and the "+ New design" affordance.
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
vi.mock('@/components/game-design/GameDesignSection', () => ({
  GameDesignSection: () =>
    React.createElement('div', { 'data-testid': 'gd-section' },
      React.createElement('input', { id: 'gd-new-game-title', placeholder: 'New game title' })),
}));

import GameDesignLens from '@/app/lenses/game-design/page';

function listed(ok = true, error: string | null = null) {
  return { data: { ok, result: ok ? { games: [], count: 0 } : null, error } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('game design workbench shell', () => {
  it('LOADING: shows a loading message and no workbench yet', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const view = render(<GameDesignLens />);
    expect(view.getByTestId('gd-loading')).toBeInTheDocument();
    expect(view.queryByTestId('gd-section')).toBeNull();
    expect(view.getByRole('button', { name: '+ New design' })).toBeDisabled();
  });

  it('READY: mounts GameDesignSection once game-list clears the admission gate', async () => {
    lensRun.mockResolvedValue(listed(true));
    const view = render(<GameDesignLens />);
    expect(await view.findByTestId('gd-section')).toBeInTheDocument();
    expect(view.queryByTestId('gd-loading')).toBeNull();
    expect(view.getByRole('heading', { name: 'Game Design' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New design' })).toBeEnabled();
  });

  it('WARMING: a shed game-list retries and then mounts the workbench', async () => {
    lensRun
      .mockResolvedValueOnce(listed(false, 'service_overloaded'))
      .mockResolvedValue(listed(true));
    const view = render(<GameDesignLens />);
    expect(await view.findByTestId('gd-section', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce(listed(false, 'state_unavailable'));
    const view = render(<GameDesignLens />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    expect(view.queryByTestId('gd-section')).toBeNull();
    lensRun.mockResolvedValue(listed(true));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByTestId('gd-section')).toBeInTheDocument();
  });

  it('+ New design focuses the roster\u2019s title input once ready', async () => {
    lensRun.mockResolvedValue(listed(true));
    const view = render(<GameDesignLens />);
    await view.findByTestId('gd-section');
    fireEvent.click(view.getByRole('button', { name: '+ New design' }));
    const input = view.container.querySelector('#gd-new-game-title');
    expect(input).toBe(document.activeElement);
  });

  it('HEADER: shows the lens name signed-in', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed(true));
    const view = render(<GameDesignLens />);
    expect(await view.findByRole('heading', { name: 'Game Design' })).toBeInTheDocument();
    expect(await view.findByTestId('gd-section')).toBeInTheDocument();
  });
});
