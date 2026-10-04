/** ProjectStudio — edit an existing project through artistry.projectUpdate, prefilled from the project. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast: vi.fn() }) } }));

import { ProjectStudio } from '@/components/artistry/ProjectStudio';

const PROJECT = {
  id: 'p1', title: 'Harbor Study', description: 'Gouache', discipline: 'painting', tools: ['gouache'], tags: ['sea'],
  images: [{ url: 'https://example.org/a.jpg', caption: 'dawn', order: 0 }], processSteps: [{ title: 'Sketch', detail: 'thumbnails' }],
  coverUrl: '', published: true, views: 3, appreciations: 1, commentCount: 0, createdAt: '2026-10-01',
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) =>
    Promise.resolve({ data: { ok: true, result: action === 'projectList' ? { projects: [PROJECT] } : {} } }));
});

describe('ProjectStudio edit', () => {
  it('prefills the form and saves through projectUpdate', async () => {
    render(<ProjectStudio />);
    fireEvent.click(await screen.findByRole('button', { name: /^edit$/i }));
    expect(screen.getByRole('dialog', { name: 'Edit project' })).toBeTruthy();
    const title = screen.getByDisplayValue('Harbor Study');
    fireEvent.change(title, { target: { value: 'Harbor Study II' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('artistry', 'projectUpdate', expect.objectContaining({
      projectId: 'p1', title: 'Harbor Study II', tools: ['gouache'], tags: ['sea'],
      images: [{ url: 'https://example.org/a.jpg', caption: 'dawn', order: 0 }],
      processSteps: [{ title: 'Sketch', detail: 'thumbnails' }],
    })));
    expect(lensRunMock).not.toHaveBeenCalledWith('artistry', 'projectCreate', expect.anything());
  });
});
