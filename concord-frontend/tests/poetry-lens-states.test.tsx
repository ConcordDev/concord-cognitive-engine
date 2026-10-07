/**
 * /lenses/poetry — one poem.
 *
 * + New poem calls poetry.poem-create and shows the title only after
 * poem-list contains that id and the same title, and the lines only
 * after poem-detail returns that same body. Form and status stay off
 * the page. The numbered comment is empty chrome, not an input.
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

import PoetryLens from '@/app/lenses/poetry/page';

function listed(poems: { id: string; title: string; form?: string | null; status?: string | null }[]) {
  return { data: { ok: true, result: { poems, count: poems.length }, error: null } };
}

function detail(id: string, title: string, body: string, form: string | null = null, status: string | null = null) {
  return { data: { ok: true, result: { poem: { id, title, body, form, status, tags: [] } }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('poetry page', () => {
  it('EMPTY: shows the numbered comment and + New poem', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    expect(await view.findByText('// the page is empty.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The poem' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New poem' })).toBeEnabled();
    expect(view.getByTestId('po-caret')).toBeInTheDocument();
    expect(view.container.querySelector('input, textarea')).toBeNull();
    expect(view.queryByText('Discover')).toBeNull();
    expect(view.queryByText('Workshop')).toBeNull();
  });

  it('WARMING: a shed poem-list retries and then shows the empty page', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    expect(await view.findByText('// the page is empty.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<PoetryLens />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('// the page is empty.')).toBeInTheDocument();
  });

  it('POEM: a blank title does not call poem-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New poem' }));
    expect(view.queryByText('// the page is empty.')).toBeNull();
    fireEvent.change(view.getByTestId('po-body'), { target: { value: 'The hinge held.' } });
    fireEvent.click(view.getByRole('button', { name: '+ New poem' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('poem-create');
  });

  it('POEM: a blank body does not call poem-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New poem' }));
    fireEvent.change(view.getByTestId('po-title'), { target: { value: 'Door poem' } });
    fireEvent.click(view.getByRole('button', { name: '+ New poem' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A line is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('poem-create');
  });

  it('POEM: shows the title and body only after list and detail match', async () => {
    const poems: { id: string; title: string; body: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { id?: string; title?: string; body?: string }) => {
      if (action === 'poem-list') return listed(poems);
      if (action === 'poem-detail') {
        const poem = poems.find((item) => item.id === input?.id);
        return detail(poem?.id || '', poem?.title || '', poem?.body || '');
      }
      if (action === 'poem-create') {
        poems.unshift({ id: 'pm_1', title: input?.title || '', body: input?.body || '' });
        return { data: { ok: true, result: { poem: { id: 'pm_1', title: input?.title, body: input?.body } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PoetryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New poem' }));
    fireEvent.change(view.getByTestId('po-title'), { target: { value: '  Door poem  ' } });
    fireEvent.change(view.getByTestId('po-body'), { target: { value: '  The hinge held.  ' } });
    fireEvent.click(view.getByRole('button', { name: '+ New poem' }));
    expect(await view.findByRole('heading', { name: 'Door poem' })).toBeInTheDocument();
    expect(view.getByText('The hinge held.')).toBeInTheDocument();
    expect(view.queryByText('// the page is empty.')).toBeNull();
    expect(view.queryByText('free-verse')).toBeNull();
    expect(view.queryByText('draft')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'poem-create');
    expect(save?.[0]).toBe('poetry');
    expect(save?.[2]).toEqual({ title: 'Door poem', body: 'The hinge held.' });
  });

  it('POEM: a list miss does not show the title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'poem-list') return listed([]);
      if (action === 'poem-create') {
        return { data: { ok: true, result: { poem: { id: 'pm_missing', title: 'Lost poem', body: 'Gone.' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PoetryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New poem' }));
    fireEvent.change(view.getByTestId('po-title'), { target: { value: 'Lost poem' } });
    fireEvent.change(view.getByTestId('po-body'), { target: { value: 'Gone.' } });
    fireEvent.click(view.getByRole('button', { name: '+ New poem' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost poem' })).toBeNull();
    expect(view.queryByTestId('po-line')).toBeNull();
  });

  it('POEM: a body mismatch does not show the new line', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'poem-list') return listed([{ id: 'pm_1', title: 'Door poem' }]);
      if (action === 'poem-detail') return detail('pm_1', 'Door poem', 'Other line.');
      if (action === 'poem-create') {
        return { data: { ok: true, result: { poem: { id: 'pm_1', title: 'Door poem', body: 'The hinge held.' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PoetryLens />);
    // initial load shows the stored other line
    expect(await view.findByText('Other line.')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '+ New poem' }));
    fireEvent.change(view.getByTestId('po-title'), { target: { value: 'Door poem' } });
    fireEvent.change(view.getByTestId('po-body'), { target: { value: 'The hinge held.' } });
    fireEvent.click(view.getByRole('button', { name: '+ New poem' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.getAllByTestId('po-line').map((node) => node.textContent)).toEqual(['Other line.']);
  });

  it('GREETING: title-cases the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    expect(await view.findByRole('heading', { name: 'The poem, Ramaj' })).toBeInTheDocument();
    expect(await view.findByText('// the page is empty.')).toBeInTheDocument();
  });

  it('LOAD: shows a stored title and body and hides form and status', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'poem-list') {
        return listed([
          { id: 'pm_a', title: 'First poem', form: 'free-verse', status: 'draft' },
          { id: 'pm_b', title: '   ' },
        ]);
      }
      if (action === 'poem-detail') return detail('pm_a', 'First poem', 'A stored line.', 'free-verse', 'draft');
      throw new Error(action);
    });
    const view = render(<PoetryLens />);
    expect(await view.findByRole('heading', { name: 'First poem' })).toBeInTheDocument();
    expect(view.getByText('A stored line.')).toBeInTheDocument();
    expect(view.queryByText('// the page is empty.')).toBeNull();
    expect(view.queryByText('free-verse')).toBeNull();
    expect(view.queryByText('draft')).toBeNull();
  });

  it('POEM: a refused create does not show the title', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New poem' }));
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'poem-list') return listed([]);
      if (action === 'poem-create') return { data: { ok: false, result: null, error: 'poem_not_saved' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('po-title'), { target: { value: 'Bad poem' } });
    fireEvent.change(view.getByTestId('po-body'), { target: { value: 'No.' } });
    fireEvent.click(view.getByRole('button', { name: '+ New poem' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/poem_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad poem' })).toBeNull();
    expect(view.getByTestId('po-title')).toBeInTheDocument();
  });
});
