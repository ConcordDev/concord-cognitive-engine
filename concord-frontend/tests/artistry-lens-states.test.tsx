/**
 * /lenses/artistry — one study.
 *
 * + New study calls artistry.projectCreate and shows the title only after
 * artistry.projectList contains that id and the same title.
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

import ArtistryLens from '@/app/lenses/artistry/page';

function listed(projects: { id: string; title: string }[]) {
  return { data: { ok: true, result: { projects, count: projects.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('artistry study', () => {
  it('EMPTY: says the study is empty and offers + New study', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<ArtistryLens />);
    expect(await view.findByText('The study is empty.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The study' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New study' })).toBeEnabled();
    expect(view.queryByText('Feed')).toBeNull();
    expect(view.queryByText('Sketchpad')).toBeNull();
    expect(view.queryByText('Untitled Project')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<ArtistryLens />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('The study is empty.')).toBeInTheDocument();
  });

  it('STUDY: a blank title does not call projectCreate', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<ArtistryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New study' }));
    fireEvent.click(view.getByRole('button', { name: '+ New study' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('projectCreate');
  });

  it('STUDY: shows the title only after projectList contains the id and title', async () => {
    const projects: { id: string; title: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'projectList') return listed(projects);
      if (action === 'projectCreate') {
        projects.unshift({ id: 'proj_1', title: input?.title || '' });
        return { data: { ok: true, result: { project: { id: 'proj_1', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<ArtistryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New study' }));
    fireEvent.change(view.getByTestId('artistry-title'), { target: { value: '  Door study  ' } });
    fireEvent.click(view.getByRole('button', { name: '+ New study' }));
    expect(await view.findByRole('heading', { name: 'Door study' })).toBeInTheDocument();
    expect(view.queryByText('The study is empty.')).toBeNull();
    expect(view.queryByText('Untitled Project')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'projectCreate');
    expect(save?.[0]).toBe('artistry');
    expect(save?.[2]).toEqual({ title: 'Door study' });
  });

  it('STUDY: a list miss does not show the title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'projectList') return listed([]);
      if (action === 'projectCreate') {
        return { data: { ok: true, result: { project: { id: 'proj_missing', title: 'Lost study' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<ArtistryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New study' }));
    fireEvent.change(view.getByTestId('artistry-title'), { target: { value: 'Lost study' } });
    fireEvent.click(view.getByRole('button', { name: '+ New study' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost study' })).toBeNull();
  });

  it('GREETING: title-cases the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<ArtistryLens />);
    expect(await view.findByRole('heading', { name: 'The study, Ramaj' })).toBeInTheDocument();
    expect(await view.findByText('The study is empty.')).toBeInTheDocument();
  });

  it('LOAD: shows a title already on the list and skips a blank title', async () => {
    lensRun.mockResolvedValue(listed([
      { id: 'proj_a', title: 'First study' },
      { id: 'proj_b', title: '   ' },
    ]));
    const view = render(<ArtistryLens />);
    expect(await view.findByRole('heading', { name: 'First study' })).toBeInTheDocument();
    expect(view.queryByText('The study is empty.')).toBeNull();
  });

  it('STUDY: a refused create does not show the title', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<ArtistryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New study' }));
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'projectList') return listed([]);
      if (action === 'projectCreate') return { data: { ok: false, result: null, error: 'study_not_saved' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('artistry-title'), { target: { value: 'Bad study' } });
    fireEvent.click(view.getByRole('button', { name: '+ New study' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/study_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad study' })).toBeNull();
    expect(view.getByTestId('artistry-title')).toBeInTheDocument();
  });

  it('STUDY: a second study stays beside the first', async () => {
    const projects: { id: string; title: string }[] = [{ id: 'proj_1', title: 'First study' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'projectList') return listed(projects);
      if (action === 'projectCreate') {
        projects.unshift({ id: 'proj_2', title: input?.title || '' });
        return { data: { ok: true, result: { project: { id: 'proj_2', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<ArtistryLens />);
    expect(await view.findByRole('heading', { name: 'First study' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '+ New study' }));
    fireEvent.change(view.getByTestId('artistry-title'), { target: { value: 'Second study' } });
    fireEvent.click(view.getByRole('button', { name: '+ New study' }));
    expect(await view.findByRole('heading', { name: 'Second study' })).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'First study' })).toBeInTheDocument();
  });
});
