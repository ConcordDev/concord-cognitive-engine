import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ProjectsKeepMenu } from '@/components/projects/ProjectsKeepMenu';

const project = { id: 'prj_1', name: 'Bridge', key: 'BR', status: 'started', health: 'on_track' };

function renderMenu() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectsKeepMenu project={project} />
    </QueryClientProvider>,
  );
}

beforeEach(() => { lensRunMock.mockReset(); });

describe('ProjectsKeepMenu', () => {
  it('saves a DTU only after read-back, records it on the project, then drafts citing that id', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string, input?: { dtuId?: string }) => {
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      if (domain === 'projects' && action === 'project-get') return { data: { ok: true, result: { project: { ...project } } } };
      if (domain === 'projects' && action === 'project-note-dtu-save') {
        return { data: { ok: true, result: { id: 'prj_1', savedDtuId: input?.dtuId, savedDtuAt: '2026-11-06T00:00:00.000Z' } } };
      }
      if (domain === 'thread') {
        return { data: { ok: true, result: { draft: { id: 'dr_1', citedDtuId: 'dtu_9', status: 'draft' } } } };
      }
      return { data: { ok: false, error: 'unexpected' } };
    });
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Save project as DTU' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved as private DTU dtu_9'));
    // F17: the verified save is written onto the project record.
    const noteCall = lensRunMock.mock.calls.find((c) => c[0] === 'projects' && c[1] === 'project-note-dtu-save');
    expect(noteCall?.[2]).toEqual({ id: 'prj_1', dtuId: 'dtu_9' });
    fireEvent.click(screen.getByRole('button', { name: 'Draft in Thread' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('citing dtu_9'));
    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread');
    expect(draftCall?.[2].citedDtuId).toBe('dtu_9');
  });

  it('F17: a project whose record already carries a saved DTU shows the receipt and enables Draft on mount — no new save', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'projects' && action === 'project-get') {
        return { data: { ok: true, result: { project: { ...project, savedDtuId: 'dtu_kept', savedDtuAt: '2026-11-05T00:00:00.000Z' } } } };
      }
      if (domain === 'thread') {
        return { data: { ok: true, result: { draft: { id: 'dr_2', citedDtuId: 'dtu_kept', status: 'draft' } } } };
      }
      return { data: { ok: false, error: 'unexpected' } };
    });
    renderMenu();
    // The persistent receipt: the record's truth, not view-local state.
    expect(await screen.findByRole('status')).toHaveTextContent('Saved as private DTU dtu_kept');
    const draftBtn = screen.getByRole('button', { name: 'Draft in Thread' }) as HTMLButtonElement;
    expect(draftBtn.disabled).toBe(false);
    fireEvent.click(draftBtn);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('citing dtu_kept'));
    // No DTU was created in this mount: the record alone grounded the flow.
    expect(lensRunMock.mock.calls.some((c) => c[0] === 'dtu' && c[1] === 'create')).toBe(false);
  });

  it('F17: an unsaved record keeps Draft honestly disabled', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'projects' && action === 'project-get') return { data: { ok: true, result: { project: { ...project } } } };
      return { data: { ok: false, error: 'unexpected' } };
    });
    renderMenu();
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[0] === 'projects' && c[1] === 'project-get')).toBe(true));
    const draftBtn = screen.getByRole('button', { name: 'Draft in Thread' }) as HTMLButtonElement;
    expect(draftBtn.disabled).toBe(true);
    expect(draftBtn.title).toBe('Save the project first');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
