/**
 * /lenses/poetry — one poem.
 *
 * Save poem calls poetry.poem-create and shows the title only after
 * poem-list contains that id and the same title, and the lines only
 * after poem-detail returns that same body. Form and status stay off
 * the page. The numbered comment is empty chrome, not an input.
 *
 * D1: the commit button relabels "+ New poem" -> "Save poem" while
 * composing, and an in-progress draft is mirrored to localStorage so a
 * remount restores it instead of losing it.
 * D2: Edit (inline, pre-filled, poem-update) and Delete (two-click
 * confirm, poem-delete) are real per-poem controls.
 * D3: a truthful "N lines · M words" count is shown per poem.
 * D5: the ↓.dtu control (DTUExportButton) is present on the page.
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
vi.mock('@/components/lens/DTUExportButton', () => ({
  DTUExportButton: ({ domain }: { domain: string }) =>
    React.createElement('button', { 'data-testid': 'po-dtu-export', type: 'button' }, `↓ .dtu (${domain})`),
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

const DRAFT_KEY = 'concord:poetry:draft:v1';

function listed(poems: { id: string; title: string; form?: string | null; status?: string | null }[]) {
  return { data: { ok: true, result: { poems, count: poems.length }, error: null } };
}

function detail(id: string, title: string, body: string, form: string | null = null, status: string | null = null) {
  return { data: { ok: true, result: { poem: { id, title, body, form, status, tags: [] } }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
  window.localStorage.clear();
});

describe('poetry page', () => {
  it('EMPTY: shows the numbered comment, + New poem, and the ↓.dtu control', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    expect(await view.findByText('// the page is empty.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Poetry' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New poem' })).toBeEnabled();
    expect(view.getByTestId('po-caret')).toBeInTheDocument();
    expect(view.getByTestId('po-dtu-export')).toBeInTheDocument();
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
    fireEvent.click(view.getByRole('button', { name: 'Save poem' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('poem-create');
  });

  it('POEM: a blank body does not call poem-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New poem' }));
    fireEvent.change(view.getByTestId('po-title'), { target: { value: 'Door poem' } });
    fireEvent.click(view.getByRole('button', { name: 'Save poem' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A line is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('poem-create');
  });

  it('D1: the button relabels "+ New poem" -> "Save poem" while composing, and Cancel discards the draft', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    fireEvent.click(await view.findByRole('button', { name: '+ New poem' }));
    expect(view.queryByRole('button', { name: '+ New poem' })).toBeNull();
    expect(view.getByRole('button', { name: 'Save poem' })).toBeInTheDocument();
    fireEvent.change(view.getByTestId('po-title'), { target: { value: 'Door poem' } });
    fireEvent.change(view.getByTestId('po-body'), { target: { value: 'The hinge held.' } });
    fireEvent.click(view.getByTestId('po-cancel'));
    expect(view.getByRole('button', { name: '+ New poem' })).toBeInTheDocument();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('D1: an in-progress draft is mirrored to localStorage and restored on remount', async () => {
    lensRun.mockResolvedValue(listed([]));
    const first = render(<PoetryLens />);
    fireEvent.click(await first.findByRole('button', { name: '+ New poem' }));
    fireEvent.change(first.getByTestId('po-title'), { target: { value: 'Unsaved title' } });
    fireEvent.change(first.getByTestId('po-body'), { target: { value: 'Unsaved line.' } });
    expect(window.localStorage.getItem(DRAFT_KEY)).toContain('Unsaved title');
    first.unmount();

    const second = render(<PoetryLens />);
    expect(await second.findByTestId('po-title')).toHaveValue('Unsaved title');
    expect(second.getByTestId('po-body')).toHaveValue('Unsaved line.');
    expect(second.getByRole('button', { name: 'Save poem' })).toBeInTheDocument();
  });

  it('POEM: shows the title, body and a truthful line/word count only after list and detail match', async () => {
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
    fireEvent.change(view.getByTestId('po-body'), { target: { value: '  The hinge held.\nIt opened wide.  ' } });
    fireEvent.click(view.getByRole('button', { name: 'Save poem' }));
    expect(await view.findByRole('heading', { name: 'Door poem' })).toBeInTheDocument();
    expect(view.getByText('The hinge held.')).toBeInTheDocument();
    expect(view.getByTestId('po-counts')).toHaveTextContent('2 lines · 6 words');
    expect(view.queryByText('// the page is empty.')).toBeNull();
    expect(view.queryByText('free-verse')).toBeNull();
    expect(view.queryByText('draft')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'poem-create');
    expect(save?.[0]).toBe('poetry');
    expect(save?.[2]).toEqual({ title: 'Door poem', body: 'The hinge held.\nIt opened wide.' });
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
    fireEvent.click(view.getByRole('button', { name: 'Save poem' }));
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
    fireEvent.click(view.getByRole('button', { name: 'Save poem' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.getAllByTestId('po-line').map((node) => node.textContent)).toEqual(['Other line.']);
  });

  it('HEADER: shows the lens name signed-in', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PoetryLens />);
    expect(await view.findByRole('heading', { name: 'Poetry' })).toBeInTheDocument();
    expect(await view.findByText('// the page is empty.')).toBeInTheDocument();
  });

  it('LOAD: shows a stored title, body and count and hides form and status', async () => {
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
    expect(view.getByTestId('po-counts')).toHaveTextContent('1 line · 3 words');
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
    fireEvent.click(view.getByRole('button', { name: 'Save poem' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/poem_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad poem' })).toBeNull();
    expect(view.getByTestId('po-title')).toBeInTheDocument();
  });

  it('D2: Edit pre-fills, calls poem-update, and verifies by reread', async () => {
    const poem = { id: 'pm_1', title: 'Door poem', body: 'The hinge held.' };
    lensRun.mockImplementation(async (_d: string, action: string, input?: { id?: string; title?: string; body?: string }) => {
      if (action === 'poem-list') return listed([{ id: poem.id, title: poem.title }]);
      if (action === 'poem-detail') return detail(poem.id, poem.title, poem.body);
      if (action === 'poem-update') {
        poem.title = input?.title || poem.title;
        poem.body = input?.body || poem.body;
        return { data: { ok: true, result: { poem: { id: poem.id, title: poem.title, body: poem.body } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PoetryLens />);
    expect(await view.findByRole('heading', { name: 'Door poem' })).toBeInTheDocument();
    fireEvent.click(view.getByTestId('po-edit'));
    expect(view.getByTestId('po-edit-title')).toHaveValue('Door poem');
    expect(view.getByTestId('po-edit-body')).toHaveValue('The hinge held.');
    fireEvent.change(view.getByTestId('po-edit-body'), { target: { value: 'The hinge held firm.' } });
    fireEvent.click(view.getByTestId('po-edit-save'));
    await waitFor(() => { expect(view.queryByText('The hinge held firm.')).toBeInTheDocument(); });
    expect(view.queryByTestId('po-edit-title')).toBeNull();
    const update = lensRun.mock.calls.find((call) => call[1] === 'poem-update');
    expect(update?.[2]).toEqual({ id: 'pm_1', title: 'Door poem', body: 'The hinge held firm.' });
  });

  it('D2: Edit with a blank title shows role=alert and does not call poem-update', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'poem-list') return listed([{ id: 'pm_1', title: 'Door poem' }]);
      if (action === 'poem-detail') return detail('pm_1', 'Door poem', 'The hinge held.');
      throw new Error(action);
    });
    const view = render(<PoetryLens />);
    expect(await view.findByRole('heading', { name: 'Door poem' })).toBeInTheDocument();
    fireEvent.click(view.getByTestId('po-edit'));
    fireEvent.change(view.getByTestId('po-edit-title'), { target: { value: '   ' } });
    fireEvent.click(view.getByTestId('po-edit-save'));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('poem-update');
  });

  it('D2: Edit Cancel discards changes without calling poem-update', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'poem-list') return listed([{ id: 'pm_1', title: 'Door poem' }]);
      if (action === 'poem-detail') return detail('pm_1', 'Door poem', 'The hinge held.');
      throw new Error(action);
    });
    const view = render(<PoetryLens />);
    expect(await view.findByRole('heading', { name: 'Door poem' })).toBeInTheDocument();
    fireEvent.click(view.getByTestId('po-edit'));
    fireEvent.change(view.getByTestId('po-edit-title'), { target: { value: 'Changed title' } });
    fireEvent.click(view.getByTestId('po-edit-cancel'));
    expect(view.queryByTestId('po-edit-title')).toBeNull();
    expect(view.getByRole('heading', { name: 'Door poem' })).toBeInTheDocument();
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('poem-update');
  });

  it('D2: Delete requires a two-click confirm, calls poem-delete, and verifies removal', async () => {
    let deleted = false;
    lensRun.mockImplementation(async (_d: string, action: string, input?: { id?: string }) => {
      if (action === 'poem-list') return listed(deleted ? [] : [{ id: 'pm_1', title: 'Door poem' }]);
      if (action === 'poem-detail') return detail('pm_1', 'Door poem', 'The hinge held.');
      if (action === 'poem-delete') {
        expect(input?.id).toBe('pm_1');
        deleted = true;
        return { data: { ok: true, result: { deleted: 'pm_1' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PoetryLens />);
    expect(await view.findByRole('heading', { name: 'Door poem' })).toBeInTheDocument();
    fireEvent.click(view.getByTestId('po-delete'));
    expect(view.queryByTestId('po-delete')).toBeNull();
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('poem-delete');
    fireEvent.click(view.getByTestId('po-delete-confirm'));
    expect(await view.findByText('// the page is empty.')).toBeInTheDocument();
    expect(view.queryByRole('heading', { name: 'Door poem' })).toBeNull();
  });

  it('D2: a delete that does not actually remove the poem shows role=alert', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'poem-list') return listed([{ id: 'pm_1', title: 'Door poem' }]);
      if (action === 'poem-detail') return detail('pm_1', 'Door poem', 'The hinge held.');
      if (action === 'poem-delete') return { data: { ok: true, result: { deleted: 'pm_1' }, error: null } };
      throw new Error(action);
    });
    const view = render(<PoetryLens />);
    expect(await view.findByRole('heading', { name: 'Door poem' })).toBeInTheDocument();
    fireEvent.click(view.getByTestId('po-delete'));
    fireEvent.click(view.getByTestId('po-delete-confirm'));
    expect(await view.findByRole('alert')).toHaveTextContent(/still listed/);
    expect(view.getByRole('heading', { name: 'Door poem' })).toBeInTheDocument();
  });
});
