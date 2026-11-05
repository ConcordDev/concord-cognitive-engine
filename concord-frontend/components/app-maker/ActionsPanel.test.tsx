/**
 * ActionsPanel — the scaffoldApp/uiComplexity/wireframeValidate bench,
 * tested directly against F4's fix (lens-reviews/app-maker.md): compute
 * actions must resolve the real Studio project from AppMakerProjectContext
 * and run against its real pages, never a disconnected auto-created
 * artifact.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensCreate = vi.fn();
const lensUpdate = vi.fn();
const lensRunMock = vi.fn();
const runArtifactMutateAsync = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: {
      create: (...a: unknown[]) => lensCreate(...a),
      update: (...a: unknown[]) => lensUpdate(...a),
    },
  },
  lensRun: (...a: unknown[]) => lensRunMock(...a),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: runArtifactMutateAsync }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [] }),
}));

let mockActiveProjectId: string | null = null;
vi.mock('@/components/app-maker/AppMakerProjectContext', () => ({
  useAppMakerProject: () => ({ activeProjectId: mockActiveProjectId, setActiveProjectId: vi.fn() }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
}));

import { ActionsPanel } from './ActionsPanel';

const PROJECT = {
  id: 'proj-1',
  name: 'My App',
  pages: [
    { id: 'pg-1', name: 'Home', route: '/', elements: [{ id: 'el-1', type: 'button', x: 0, y: 0, w: 10, h: 10, props: { label: 'Go' } }] },
  ],
};

describe('ActionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveProjectId = null;
    lensCreate.mockResolvedValue({ data: { artifact: { id: 'artifact-1' } } });
    lensUpdate.mockResolvedValue({ data: { ok: true } });
  });

  it('reports an honest stop when no Studio project is open, without auto-creating an artifact', async () => {
    mockActiveProjectId = null;
    render(<ActionsPanel />);
    fireEvent.click(screen.getByText('Scaffold App'));
    expect(await screen.findByText(/No project open/i)).toBeTruthy();
    expect(lensCreate).not.toHaveBeenCalled();
    expect(runArtifactMutateAsync).not.toHaveBeenCalled();
  });

  it('runs scaffoldApp against the real open project\'s pages, converted into a spec', async () => {
    mockActiveProjectId = 'proj-1';
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { project: PROJECT } } });
    runArtifactMutateAsync.mockResolvedValue({ ok: true, result: { routes: [{ name: 'Home', path: '/', componentCount: 1, dynamic: false }], totalComponents: 1, fileStructure: [], deepestNesting: 1 } });

    render(<ActionsPanel />);
    fireEvent.click(screen.getByText('Scaffold App'));

    await waitFor(() => expect(runArtifactMutateAsync).toHaveBeenCalled());

    expect(lensRunMock).toHaveBeenCalledWith('app-maker', 'projectGet', { projectId: 'proj-1' });
    expect(lensCreate).toHaveBeenCalledWith('app-maker', expect.objectContaining({
      data: expect.objectContaining({
        spec: expect.objectContaining({
          pages: [expect.objectContaining({
            name: 'Home',
            path: '/',
            components: [expect.objectContaining({ type: 'button', props: { label: 'Go' } })],
          })],
          auth: false,
        }),
      }),
    }));
    expect(runArtifactMutateAsync).toHaveBeenCalledWith({ id: 'artifact-1', action: 'scaffoldApp' });
    expect(await screen.findByText('Home')).toBeTruthy();
  });

  it('reports an honest stop when the open project has no pages', async () => {
    mockActiveProjectId = 'proj-empty';
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { project: { ...PROJECT, id: 'proj-empty', pages: [] } } } });
    render(<ActionsPanel />);
    fireEvent.click(screen.getByText('UI Complexity'));
    expect(await screen.findByText(/no pages yet/i)).toBeTruthy();
    expect(runArtifactMutateAsync).not.toHaveBeenCalled();
  });
});
