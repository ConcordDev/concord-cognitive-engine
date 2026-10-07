/**
 * /lenses/maker — one bench.
 *
 * + New make calls app-maker.projectCreate and shows the name only after
 * app-maker.projectList contains that id and the same name.
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

import MakerPage from '@/app/lenses/maker/page';

function listed(projects: { id: string; name: string }[]) {
  return { data: { ok: true, result: { projects, count: projects.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('maker bench', () => {
  it('EMPTY: says nothing is on the bench and offers + New make', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<MakerPage />);
    expect(await view.findByText('Nothing on the bench.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The make' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New make' })).toBeEnabled();
    expect(view.queryByText('Builder')).toBeNull();
    expect(view.queryByText('Quest Designer')).toBeNull();
    expect(view.queryByText('Untitled App')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<MakerPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('Nothing on the bench.')).toBeInTheDocument();
  });

  it('MAKE: a blank name does not call projectCreate', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<MakerPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New make' }));
    fireEvent.click(view.getByRole('button', { name: '+ New make' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A name is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('projectCreate');
  });

  it('MAKE: shows the name only after projectList contains the id and name', async () => {
    const projects: { id: string; name: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { name?: string }) => {
      if (action === 'projectList') return listed(projects);
      if (action === 'projectCreate') {
        projects.unshift({ id: 'proj_1', name: input?.name || '' });
        return { data: { ok: true, result: { project: { id: 'proj_1', name: input?.name } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<MakerPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New make' }));
    fireEvent.change(view.getByTestId('maker-name'), { target: { value: '  Bench lamp  ' } });
    fireEvent.click(view.getByRole('button', { name: '+ New make' }));
    expect(await view.findByRole('heading', { name: 'Bench lamp' })).toBeInTheDocument();
    expect(view.queryByText('Nothing on the bench.')).toBeNull();
    expect(view.queryByText('Untitled App')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'projectCreate');
    expect(save?.[2]).toEqual({ name: 'Bench lamp' });
  });

  it('MAKE: a list miss does not show the name', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'projectList') return listed([]);
      if (action === 'projectCreate') {
        return { data: { ok: true, result: { project: { id: 'proj_missing', name: 'Lost make' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<MakerPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New make' }));
    fireEvent.change(view.getByTestId('maker-name'), { target: { value: 'Lost make' } });
    fireEvent.click(view.getByRole('button', { name: '+ New make' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost make' })).toBeNull();
  });

  it('GREETING: title-cases the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<MakerPage />);
    expect(await view.findByRole('heading', { name: 'The make, Ramaj' })).toBeInTheDocument();
    expect(await view.findByText('Nothing on the bench.')).toBeInTheDocument();
  });

  it('LOAD: shows a name already on the bench and skips a blank name', async () => {
    lensRun.mockResolvedValue(listed([
      { id: 'proj_a', name: 'First make' },
      { id: 'proj_b', name: '   ' },
    ]));
    const view = render(<MakerPage />);
    expect(await view.findByRole('heading', { name: 'First make' })).toBeInTheDocument();
    expect(view.queryByText('Nothing on the bench.')).toBeNull();
  });

  it('MAKE: a refused create does not show the name', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'projectList') return listed([]);
      if (action === 'projectCreate') return { data: { ok: false, result: null, error: 'state_unavailable' } };
      throw new Error(action);
    });
    const view = render(<MakerPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New make' }));
    fireEvent.change(view.getByTestId('maker-name'), { target: { value: 'Refused' } });
    fireEvent.click(view.getByRole('button', { name: '+ New make' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    expect(view.queryByRole('heading', { name: 'Refused' })).toBeNull();
  });

  it('MAKE: a second make stays beside the first when the list returns both', async () => {
    const projects: { id: string; name: string }[] = [{ id: 'proj_1', name: 'First make' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { name?: string }) => {
      if (action === 'projectList') return listed(projects);
      if (action === 'projectCreate') {
        projects.unshift({ id: 'proj_2', name: input?.name || '' });
        return { data: { ok: true, result: { project: { id: 'proj_2' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<MakerPage />);
    expect(await view.findByRole('heading', { name: 'First make' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '+ New make' }));
    fireEvent.change(view.getByTestId('maker-name'), { target: { value: 'Second make' } });
    fireEvent.click(view.getByRole('button', { name: '+ New make' }));
    expect(await view.findByRole('heading', { name: 'Second make' })).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'First make' })).toBeInTheDocument();
  });
});
