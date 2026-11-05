/**
 * /lenses/creative-writing — one page.
 *
 * + New page calls creative-writing.project-create and shows the title
 * only after creative-writing.project-list contains that id and title.
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
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import CreativeWritingPage from '@/app/lenses/creative-writing/page';

function listed(projects: { id: string; title: string }[]) {
  return { data: { ok: true, result: { projects, count: projects.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('creative writing page', () => {
  it('EMPTY: shows the numbered comment and offers + New page', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    expect(await view.findByText('// the page is empty.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Creative Writing' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New page' })).toBeEnabled();
    expect(view.queryByText('Studio')).toBeNull();
    expect(view.queryByText('Gutenberg')).toBeNull();
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    const view = render(<CreativeWritingPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/STATE unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('// the page is empty.')).toBeInTheDocument();
  });

  it('PAGE: a blank title does not call project-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New page' }));
    fireEvent.click(view.getByRole('button', { name: '+ New page' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('project-create');
  });

  it('PAGE: shows the title only after project-list contains the id and title', async () => {
    const projects: { id: string; title: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'project-create') {
        projects.push({ id: 'man_1', title: input?.title || '' });
        return { data: { ok: true, result: { project: { id: 'man_1', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<CreativeWritingPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New page' }));
    fireEvent.change(view.getByTestId('creative-writing-title'), { target: { value: '  Door page  ' } });
    fireEvent.click(view.getByRole('button', { name: '+ New page' }));
    expect(await view.findByRole('heading', { name: 'Door page' })).toBeInTheDocument();
    expect(view.queryByText('// the page is empty.')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'project-create');
    expect(save?.[0]).toBe('creative-writing');
    expect(save?.[2]).toEqual({ title: 'Door page' });
  });

  it('PAGE: a list miss does not show the title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed([]);
      if (action === 'project-create') {
        return { data: { ok: true, result: { project: { id: 'man_missing', title: 'Lost page' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<CreativeWritingPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New page' }));
    fireEvent.change(view.getByTestId('creative-writing-title'), { target: { value: 'Lost page' } });
    fireEvent.click(view.getByRole('button', { name: '+ New page' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost page' })).toBeNull();
  });

  it('HEADER: shows the lens name signed-in', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    expect(await view.findByRole('heading', { name: 'Creative Writing' })).toBeInTheDocument();
    expect(await view.findByText('// the page is empty.')).toBeInTheDocument();
  });

  it('LOAD: shows a title already on the list and skips a blank title', async () => {
    lensRun.mockResolvedValue(listed([
      { id: 'man_a', title: 'First page' },
      { id: 'man_b', title: '   ' },
    ]));
    const view = render(<CreativeWritingPage />);
    expect(await view.findByRole('heading', { name: 'First page' })).toBeInTheDocument();
    expect(view.queryByText('// the page is empty.')).toBeNull();
  });

  it('PAGE: a refused create does not show the title', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New page' }));
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed([]);
      if (action === 'project-create') return { data: { ok: false, result: null, error: 'page_not_saved' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('creative-writing-title'), { target: { value: 'Bad page' } });
    fireEvent.click(view.getByRole('button', { name: '+ New page' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/page_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad page' })).toBeNull();
    expect(view.getByTestId('creative-writing-title')).toBeInTheDocument();
  });

  it('PAGE: a second page stays beside the first', async () => {
    const projects: { id: string; title: string }[] = [{ id: 'man_1', title: 'First page' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'project-create') {
        projects.push({ id: 'man_2', title: input?.title || '' });
        return { data: { ok: true, result: { project: { id: 'man_2', title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<CreativeWritingPage />);
    expect(await view.findByRole('heading', { name: 'First page' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '+ New page' }));
    fireEvent.change(view.getByTestId('creative-writing-title'), { target: { value: 'Second page' } });
    fireEvent.click(view.getByRole('button', { name: '+ New page' }));
    expect(await view.findByRole('heading', { name: 'Second page' })).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'First page' })).toBeInTheDocument();
  });

  it('EXPORT JSON: downloads a real file built from project-get, not a silent no-op', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let capturedBlob: Blob | null = null;
    createObjectURL.mockImplementation((blob: Blob) => { capturedBlob = blob; return 'blob:mock-url'; });

    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed([{ id: 'man_1', title: 'Door page' }]);
      if (action === 'project-get') {
        return {
          data: {
            ok: true,
            result: {
              project: { id: 'man_1', title: 'Door page', genre: null, targetWords: 0 },
              chapters: [], scenes: [], characters: [], threads: [], wordCount: 0,
            },
            error: null,
          },
        };
      }
      throw new Error(action);
    });
    const view = render(<CreativeWritingPage />);
    fireEvent.click(await view.findByTestId('export-json-man_1'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(capturedBlob).not.toBeNull();
    expect((capturedBlob as unknown as Blob).type).toBe('application/json');
    const text = await (capturedBlob as unknown as Blob).text();
    const parsed = JSON.parse(text);
    expect(parsed.project.title).toBe('Door page');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    clickSpy.mockRestore();
  });

  it('EXPORT CSV: downloads a real summary row when there are no scenes', async () => {
    const createObjectURL = vi.fn();
    let capturedBlob: Blob | null = null;
    createObjectURL.mockImplementation((blob: Blob) => { capturedBlob = blob; return 'blob:mock-url'; });
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed([{ id: 'man_1', title: 'Door page' }]);
      if (action === 'project-get') {
        return {
          data: {
            ok: true,
            result: {
              project: { id: 'man_1', title: 'Door page', genre: 'noir', targetWords: 5000, createdAt: 1, updatedAt: 2 },
              chapters: [], scenes: [], characters: [], threads: [], wordCount: 0,
            },
            error: null,
          },
        };
      }
      throw new Error(action);
    });
    const view = render(<CreativeWritingPage />);
    fireEvent.click(await view.findByTestId('export-csv-man_1'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const text = await (capturedBlob as unknown as Blob).text();
    expect(text.split('\n')[0]).toBe('id,title,genre,targetWords,wordCount,createdAt,updatedAt');
    expect(text.split('\n')[1]).toBe('man_1,Door page,noir,5000,0,1,2');
    clickSpy.mockRestore();
  });

  it('EXPORT: a failed project-get surfaces a real error, never a silent no-op', async () => {
    const createObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed([{ id: 'man_1', title: 'Door page' }]);
      if (action === 'project-get') return { data: { ok: false, result: null, error: 'project not found' } };
      throw new Error(action);
    });
    const view = render(<CreativeWritingPage />);
    fireEvent.click(await view.findByTestId('export-json-man_1'));
    expect(await view.findByTestId('creative-writing-export-error')).toHaveTextContent(/project not found/);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
