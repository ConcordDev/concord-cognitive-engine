/**
 * /lenses/artistry — the page-level shell contract.
 *
 * <ProjectStudio> (the real gallery/create/edit/draw panel) and its
 * create-form "+ New project" affordance are covered by their own test
 * files (artistry-project-edit.test.tsx,
 * tests/components/ProjectStudio-image-upload.test.tsx, and a
 * study-canvas.test.tsx for the new drawing medium) — it is mocked here
 * as a black box so this file only exercises the page's own admission-
 * gate warm-up retry, phase gating, and the 'n' shortcut's forwarding to
 * ProjectStudio's own "+ New project" button.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: null as { username: string } | null },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

let lastCommandAction: (() => void) | null = null;
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (commands: { action: () => void }[]) => {
    lastCommandAction = commands[0]?.action || null;
  },
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

const projectStudioNewClicked = vi.fn();
vi.mock('@/components/artistry', () => ({
  ProjectStudio: () =>
    React.createElement(
      'div',
      { 'data-testid': 'project-studio-mock' },
      React.createElement(
        'button',
        { 'data-artistry-new-project': true, onClick: projectStudioNewClicked },
        '+ New Project',
      ),
    ),
}));

import ArtistryLens from '@/app/lenses/artistry/page';

function listedOk() {
  return { data: { ok: true, result: { projects: [], count: 0 }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  projectStudioNewClicked.mockClear();
  authUser.current = null;
  lastCommandAction = null;
  vi.useRealTimers();
});

describe('artistry page shell', () => {
  it('WARMING: shows the opening state while projectList is pending', async () => {
    let resolveList: (v: unknown) => void = () => {};
    lensRun.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    const view = render(<ArtistryLens />);
    expect(view.getByTestId('artistry-warming')).toBeInTheDocument();
    expect(view.getByRole('status')).toHaveTextContent('Opening the study.');
    resolveList(listedOk());
    expect(await view.findByTestId('artistry-ready')).toBeInTheDocument();
  });

  it('READY: mounts the real ProjectStudio once projectList succeeds', async () => {
    lensRun.mockResolvedValue(listedOk());
    const view = render(<ArtistryLens />);
    expect(await view.findByTestId('project-studio-mock')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Artistry' })).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('artistry', 'projectList', {});
  });

  it('ERROR: a hard failure (not a warm-up 503) shows role=alert with Retry', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<ArtistryLens />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listedOk());
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByTestId('project-studio-mock')).toBeInTheDocument();
  });

  it('WARM-UP: a transient 503 retries and then clears into ready', async () => {
    let calls = 0;
    lensRun.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return { data: { ok: false, result: null, error: '503 not ready yet' } };
      return listedOk();
    });
    const view = render(<ArtistryLens />);
    expect(await view.findByTestId('project-studio-mock')).toBeInTheDocument();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('SHORTCUT: the "n" command forwards to ProjectStudio\'s own + New project button', async () => {
    lensRun.mockResolvedValue(listedOk());
    render(<ArtistryLens />);
    await waitFor(() => expect(lastCommandAction).not.toBeNull());
    lastCommandAction?.();
    await waitFor(() => expect(projectStudioNewClicked).toHaveBeenCalledTimes(1));
  });

  it('HEADER: shows the lens name signed-in', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listedOk());
    const view = render(<ArtistryLens />);
    expect(view.getByRole('heading', { name: 'Artistry' })).toBeInTheDocument();
    expect(await view.findByTestId('project-studio-mock')).toBeInTheDocument();
  });
});
