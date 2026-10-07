/**
 * /lenses/creative-writing — one page.
 *
 * + New page calls creative-writing.project-create and shows the title
 * only after creative-writing.project-list contains that id and title.
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
    expect(view.getByRole('heading', { name: 'The page' })).toBeInTheDocument();
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

  it('GREETING: title-cases the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    expect(await view.findByRole('heading', { name: 'The page, Ramaj' })).toBeInTheDocument();
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
});
