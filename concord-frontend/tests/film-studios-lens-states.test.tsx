/**
 * /lenses/film-studios — one production.
 *
 * + New production calls film-studios.project-create and shows the title
 * only after project-list contains that id and title. Opening it calls
 * scene-list. Add scene calls scene-add and shows the slugline only after
 * scene-list contains that id and location. Choosing the scene reads
 * scene-list again.
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

import FilmStudiosPage from '@/app/lenses/film-studios/page';

function listed(projects: { id: string; title: string }[]) {
  return { data: { ok: true, result: { projects, count: projects.length }, error: null } };
}
function scenesOf(scenes: { id: string; location: string; slugline: string }[]) {
  return { data: { ok: true, result: { scenes, count: scenes.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('film studios production', () => {
  it('EMPTY: shows both panes and offers + New production', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<FilmStudiosPage />);
    expect(await view.findByText('No production open.')).toBeInTheDocument();
    expect(view.getByText('Nothing selected.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The production' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New production' })).toBeEnabled();
    expect(view.queryByRole('button', { name: 'Add scene' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Discover' })).toBeNull();
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    const view = render(<FilmStudiosPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/STATE unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No production open.')).toBeInTheDocument();
  });

  it('PRODUCTION: a blank title does not call project-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New production' }));
    fireEvent.click(view.getByRole('button', { name: '+ New production' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('project-create');
  });

  it('PRODUCTION: shows the title only after project-list contains the id and title', async () => {
    const projects: { id: string; title: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf([]);
      if (action === 'project-create') {
        projects.push({ id: 'prj_1', title: input?.title || '' });
        return { data: { ok: true, result: { project: { id: 'prj_1', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New production' }));
    fireEvent.change(view.getByTestId('film-title'), { target: { value: '  Door production  ' } });
    fireEvent.click(view.getByRole('button', { name: '+ New production' }));
    expect(await view.findByRole('button', { name: 'Door production' })).toHaveAttribute('aria-pressed', 'true');
    expect(view.getByText('Nothing selected.')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Add scene' })).toBeEnabled();
    const save = lensRun.mock.calls.find((call) => call[1] === 'project-create');
    expect(save?.[0]).toBe('film-studios');
    expect(save?.[2]).toEqual({ title: 'Door production' });
  });

  it('PRODUCTION: a list miss does not show the title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed([]);
      if (action === 'project-create') {
        return { data: { ok: true, result: { project: { id: 'prj_missing', title: 'Lost production' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New production' }));
    fireEvent.change(view.getByTestId('film-title'), { target: { value: 'Lost production' } });
    fireEvent.click(view.getByRole('button', { name: '+ New production' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('button', { name: 'Lost production' })).toBeNull();
  });

  it('SCENE: a blank location does not call scene-add', async () => {
    const projects = [{ id: 'prj_1', title: 'Door production' }];
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf([]);
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Door production' }));
    expect(await view.findByRole('button', { name: 'Add scene' })).toBeEnabled();
    fireEvent.click(view.getByRole('button', { name: 'Add scene' }));
    fireEvent.click(view.getByRole('button', { name: 'Add scene' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A location is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('scene-add');
  });

  it('SCENE: shows the slugline only after scene-list contains the id and location', async () => {
    const projects = [{ id: 'prj_1', title: 'Door production' }];
    const scenes: { id: string; location: string; slugline: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { location?: string; projectId?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf(scenes);
      if (action === 'scene-add') {
        scenes.push({ id: 'scn_1', location: input?.location || '', slugline: `INT. ${input?.location} - DAY` });
        return { data: { ok: true, result: { scene: { id: 'scn_1', location: input?.location } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Door production' }));
    fireEvent.click(await view.findByRole('button', { name: 'Add scene' }));
    fireEvent.change(view.getByTestId('film-location'), { target: { value: '  Kitchen  ' } });
    fireEvent.click(view.getByRole('button', { name: 'Add scene' }));
    expect(await view.findByRole('heading', { name: 'INT. Kitchen - DAY' })).toBeInTheDocument();
    expect(view.queryByText('Nothing selected.')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'scene-add');
    expect(save?.[2]).toEqual({ projectId: 'prj_1', location: 'Kitchen' });
  });

  it('SCENE: choosing a scene reads scene-list again', async () => {
    const projects = [{ id: 'prj_1', title: 'Door production' }];
    const scenes = [{ id: 'scn_1', location: 'Kitchen', slugline: 'INT. Kitchen - DAY' }];
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf(scenes);
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Door production' }));
    const sceneButton = await view.findByRole('button', { name: 'INT. Kitchen - DAY' });
    expect(view.getByText('Nothing selected.')).toBeInTheDocument();
    const before = lensRun.mock.calls.filter((call) => call[1] === 'scene-list').length;
    fireEvent.click(sceneButton);
    expect(await view.findByRole('heading', { name: 'INT. Kitchen - DAY' })).toBeInTheDocument();
    expect(lensRun.mock.calls.filter((call) => call[1] === 'scene-list').length).toBeGreaterThan(before);
  });

  it('GREETING: names the signed-in person', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<FilmStudiosPage />);
    expect(await view.findByRole('heading', { name: 'The production, Ramaj' })).toBeInTheDocument();
  });

  it('LOAD: skips a row with a blank title', async () => {
    lensRun.mockResolvedValue(listed([{ id: 'prj_blank', title: '   ' } as { id: string; title: string }]));
    const view = render(<FilmStudiosPage />);
    expect(await view.findByText('No production open.')).toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'prj_blank' })).toBeNull();
  });

  it('PRODUCTION: a second production stays beside the first', async () => {
    const projects: { id: string; title: string }[] = [{ id: 'prj_1', title: 'Door production' }];
    let n = 1;
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf([]);
      if (action === 'project-create') {
        n += 1;
        const id = `prj_${n}`;
        projects.push({ id, title: input?.title || '' });
        return { data: { ok: true, result: { project: { id, title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    expect(await view.findByRole('button', { name: 'Door production' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '+ New production' }));
    fireEvent.change(view.getByTestId('film-title'), { target: { value: 'Night production' } });
    fireEvent.click(view.getByRole('button', { name: '+ New production' }));
    expect(await view.findByRole('button', { name: 'Night production' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Door production' })).toBeInTheDocument();
  });
});
