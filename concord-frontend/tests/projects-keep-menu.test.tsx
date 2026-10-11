import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ProjectsKeepMenu } from '@/components/projects/ProjectsKeepMenu';

const project = { id: 'prj_1', name: 'Bridge', key: 'BR', status: 'started', health: 'on_track' };

beforeEach(() => { lensRunMock.mockReset(); });

describe('ProjectsKeepMenu', () => {
  it('saves a DTU only after read-back, then drafts it in Thread citing that id', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      if (domain === 'thread') {
        return { data: { ok: true, result: { draft: { id: 'dr_1', citedDtuId: 'dtu_9', status: 'draft' } } } };
      }
      return { data: { ok: false, error: 'unexpected' } };
    });
    render(<ProjectsKeepMenu project={project} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save project as DTU' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved as private DTU dtu_9'));
    fireEvent.click(screen.getByRole('button', { name: 'Draft in Thread' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('citing dtu_9'));
    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread');
    expect(draftCall?.[2].citedDtuId).toBe('dtu_9');
  });
});
