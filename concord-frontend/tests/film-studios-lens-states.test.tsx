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
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));
vi.mock('@/components/lens/DTUExportButton', () => ({
  DTUExportButton: () => React.createElement('button', { title: 'Export as .dtu' }, '↓ .dtu'),
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
    expect(view.getByRole('heading', { name: 'Film Studios' })).toBeInTheDocument();
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

  it('SCENE: shows the slugline only after scene-list contains the id and location, sending the structured fields', async () => {
    const projects = [{ id: 'prj_1', title: 'Door production' }];
    const scenes: { id: string; location: string; slugline: string; intExt?: string; timeOfDay?: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { location?: string; projectId?: string; intExt?: string; timeOfDay?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf(scenes);
      if (action === 'scene-add') {
        scenes.push({
          id: 'scn_1',
          location: input?.location || '',
          slugline: `${input?.intExt}. ${input?.location} - ${input?.timeOfDay}`,
          intExt: input?.intExt,
          timeOfDay: input?.timeOfDay,
        });
        return { data: { ok: true, result: { scene: { id: 'scn_1', location: input?.location } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Door production' }));
    fireEvent.click(await view.findByRole('button', { name: 'Add scene' }));
    fireEvent.change(view.getByTestId('film-location'), { target: { value: '  Kitchen  ' } });
    fireEvent.change(view.getByTestId('film-intext'), { target: { value: 'EXT' } });
    fireEvent.change(view.getByTestId('film-timeofday'), { target: { value: 'NIGHT' } });
    fireEvent.click(view.getByRole('button', { name: 'Add scene' }));
    expect(await view.findByRole('heading', { name: 'EXT. Kitchen - NIGHT' })).toBeInTheDocument();
    expect(view.queryByText('Nothing selected.')).toBeNull();
    expect(view.getByTestId('film-scene-location')).toHaveTextContent('Kitchen');
    expect(view.getByTestId('film-scene-intext')).toHaveTextContent('EXT');
    expect(view.getByTestId('film-scene-timeofday')).toHaveTextContent('NIGHT');
    const save = lensRun.mock.calls.find((call) => call[1] === 'scene-add');
    expect(save?.[2]).toEqual({ projectId: 'prj_1', location: 'Kitchen', intExt: 'EXT', timeOfDay: 'NIGHT' });
  });

  it('PRODUCTION: rename calls project-update and shows the new title only after it reads back', async () => {
    const projects = [{ id: 'prj_1', title: 'Door production' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf([]);
      if (action === 'project-update') {
        projects[0] = { ...projects[0], title: input?.title || '' };
        return { data: { ok: true, result: { project: { id: 'prj_1', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Door production' }));
    fireEvent.click(await view.findByRole('button', { name: 'Rename' }));
    fireEvent.change(view.getByTestId('film-rename-production'), { target: { value: 'Rain production' } });
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(await view.findByRole('button', { name: 'Rain production' })).toBeInTheDocument();
    const save = lensRun.mock.calls.find((call) => call[1] === 'project-update');
    expect(save?.[2]).toEqual({ id: 'prj_1', title: 'Rain production' });
  });

  it('PRODUCTION: rename rejects a blank title without calling project-update', async () => {
    const projects = [{ id: 'prj_1', title: 'Door production' }];
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf([]);
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Door production' }));
    fireEvent.click(await view.findByRole('button', { name: 'Rename' }));
    fireEvent.change(view.getByTestId('film-rename-production'), { target: { value: '   ' } });
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('project-update');
  });

  it('PRODUCTION: delete is a two-step arm then confirm, and calls project-delete', async () => {
    const projects = [{ id: 'prj_1', title: 'Door production' }];
    let deleted = false;
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed(deleted ? [] : projects);
      if (action === 'scene-list') return scenesOf([]);
      if (action === 'project-delete') {
        deleted = true;
        return { data: { ok: true, result: { deleted: 'prj_1' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Door production' }));
    const deleteButton = await view.findByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButton);
    expect(await view.findByRole('button', { name: 'Delete this production?' })).toBeInTheDocument();
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('project-delete');
    fireEvent.click(view.getByRole('button', { name: 'Delete this production?' }));
    await view.findByText('No production open.');
    expect(lensRun.mock.calls.map((call) => call[1])).toContain('project-delete');
  });

  it('SCENE: edit calls scene-update and delete is a two-step arm then confirm', async () => {
    const projects = [{ id: 'prj_1', title: 'Door production' }];
    const scenes = [{ id: 'scn_1', location: 'Kitchen', slugline: 'INT. Kitchen - DAY', intExt: 'INT', timeOfDay: 'DAY' }];
    let removed = false;
    lensRun.mockImplementation(async (_d: string, action: string, input?: { location?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf(removed ? [] : scenes);
      if (action === 'scene-update') {
        scenes[0] = { ...scenes[0], location: input?.location || scenes[0].location, slugline: `INT. ${input?.location} - DAY` };
        return { data: { ok: true, result: { scene: { id: 'scn_1' } }, error: null } };
      }
      if (action === 'scene-delete') {
        removed = true;
        return { data: { ok: true, result: { deleted: 'scn_1' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Door production' }));
    fireEvent.click(await view.findByRole('button', { name: 'INT. Kitchen - DAY' }));
    fireEvent.click(await view.findByRole('button', { name: 'Edit' }));
    fireEvent.change(view.getByTestId('film-edit-location'), { target: { value: 'Hallway' } });
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(await view.findByRole('heading', { name: 'INT. Hallway - DAY' })).toBeInTheDocument();
    const deleteButtons = view.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(await view.findByRole('button', { name: 'Delete this scene?' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Delete this scene?' }));
    expect(await view.findByText('Nothing selected.')).toBeInTheDocument();
    expect(lensRun.mock.calls.map((call) => call[1])).toContain('scene-delete');
  });

  it('EXPORT: the export control appears only when a production is open', async () => {
    const projects = [{ id: 'prj_1', title: 'Door production' }];
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'scene-list') return scenesOf([]);
      throw new Error(action);
    });
    const view = render(<FilmStudiosPage />);
    await view.findByRole('button', { name: 'Door production' });
    expect(view.queryByTitle('Export as .dtu')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Door production' }));
    expect(await view.findByTitle('Export as .dtu')).toBeInTheDocument();
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

  it('HEADER: shows the lens name signed-in', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<FilmStudiosPage />);
    expect(await view.findByRole('heading', { name: 'Film Studios' })).toBeInTheDocument();
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
