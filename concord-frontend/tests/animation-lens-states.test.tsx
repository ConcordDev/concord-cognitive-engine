/**
 * /lenses/animation — one shot.
 *
 * + New shot calls animation.anim-create and shows the title only after
 * animation.anim-list contains that id and the same title.
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
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import AnimationPage from '@/app/lenses/animation/page';

function listed(animations: { id: string; title: string }[]) {
  return { data: { ok: true, result: { animations, count: animations.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('animation shot', () => {
  it('EMPTY: says no shot is open and offers + New shot', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<AnimationPage />);
    expect(await view.findByText('No shot open.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The shot' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New shot' })).toBeEnabled();
    expect(view.queryByText('Studio')).toBeNull();
    expect(view.queryByText('Motion Toolkit')).toBeNull();
    expect(view.queryByText('Untitled animation')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    const view = render(<AnimationPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/STATE unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No shot open.')).toBeInTheDocument();
  });

  it('SHOT: a blank title does not call anim-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<AnimationPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New shot' }));
    fireEvent.click(view.getByRole('button', { name: '+ New shot' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('anim-create');
  });

  it('SHOT: shows the title only after anim-list contains the id and title', async () => {
    const animations: { id: string; title: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'anim-list') return listed(animations);
      if (action === 'anim-create') {
        animations.unshift({ id: 'anm_1', title: input?.title || '' });
        return { data: { ok: true, result: { animation: { id: 'anm_1', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<AnimationPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New shot' }));
    fireEvent.change(view.getByTestId('animation-title'), { target: { value: '  Door slam  ' } });
    fireEvent.click(view.getByRole('button', { name: '+ New shot' }));
    expect(await view.findByRole('heading', { name: 'Door slam' })).toBeInTheDocument();
    expect(view.queryByText('No shot open.')).toBeNull();
    expect(view.queryByText('Untitled animation')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'anim-create');
    expect(save?.[0]).toBe('animation');
    expect(save?.[2]).toEqual({ title: 'Door slam' });
  });

  it('SHOT: a list miss does not show the title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'anim-list') return listed([]);
      if (action === 'anim-create') {
        return { data: { ok: true, result: { animation: { id: 'anm_missing', title: 'Lost shot' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<AnimationPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New shot' }));
    fireEvent.change(view.getByTestId('animation-title'), { target: { value: 'Lost shot' } });
    fireEvent.click(view.getByRole('button', { name: '+ New shot' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost shot' })).toBeNull();
  });

  it('GREETING: title-cases the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<AnimationPage />);
    expect(await view.findByRole('heading', { name: 'The shot, Ramaj' })).toBeInTheDocument();
    expect(await view.findByText('No shot open.')).toBeInTheDocument();
  });

  it('LOAD: shows a title already on the list and skips a blank title', async () => {
    lensRun.mockResolvedValue(listed([
      { id: 'anm_a', title: 'First shot' },
      { id: 'anm_b', title: '   ' },
    ]));
    const view = render(<AnimationPage />);
    expect(await view.findByRole('heading', { name: 'First shot' })).toBeInTheDocument();
    expect(view.queryByText('No shot open.')).toBeNull();
  });

  it('SHOT: a refused create does not show the title', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<AnimationPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New shot' }));
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'anim-list') return listed([]);
      if (action === 'anim-create') return { data: { ok: false, result: null, error: 'shot_not_saved' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('animation-title'), { target: { value: 'Bad shot' } });
    fireEvent.click(view.getByRole('button', { name: '+ New shot' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/shot_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad shot' })).toBeNull();
    expect(view.getByTestId('animation-title')).toBeInTheDocument();
  });

  it('SHOT: a second shot stays beside the first', async () => {
    const animations: { id: string; title: string }[] = [{ id: 'anm_1', title: 'First shot' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'anim-list') return listed(animations);
      if (action === 'anim-create') {
        animations.unshift({ id: 'anm_2', title: input?.title || '' });
        return { data: { ok: true, result: { animation: { id: 'anm_2', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<AnimationPage />);
    expect(await view.findByRole('heading', { name: 'First shot' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '+ New shot' }));
    fireEvent.change(view.getByTestId('animation-title'), { target: { value: 'Second shot' } });
    fireEvent.click(view.getByRole('button', { name: '+ New shot' }));
    expect(await view.findByRole('heading', { name: 'Second shot' })).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'First shot' })).toBeInTheDocument();
  });
});
