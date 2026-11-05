/**
 * /lenses/creative-writing — one page.
 *
 * Writing starts the moment the page is empty (no click needed); the
 * body field is real and every keystroke lands, including the
 * review's re-pass fixture (S2 regression guard below).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser, lensCommandCalls } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: null as { username: string } | null },
  lensCommandCalls: [] as Array<{ id: string; enabled?: boolean }[]>,
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (commands: Array<{ id: string; enabled?: boolean }>) => {
    lensCommandCalls.push(commands);
  },
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import CreativeWritingPage from '@/app/lenses/creative-writing/page';

function listed(projects: { id: string; title: string; body?: string }[]) {
  return { data: { ok: true, result: { projects, count: projects.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
  lensCommandCalls.length = 0;
});

describe('creative writing page', () => {
  it('EMPTY: the composer is open immediately — title and body are real, focused fields', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    const bodyField = await view.findByTestId('creative-writing-body-input');
    expect(view.getByRole('heading', { name: 'Creative Writing' })).toBeInTheDocument();
    expect(view.getByTestId('creative-writing-title')).toBeInTheDocument();
    expect(bodyField).toBeInTheDocument();
    expect(bodyField).toHaveFocus();
    expect(view.getByRole('button', { name: 'Save page' })).toBeEnabled();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    const view = render(<CreativeWritingPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/STATE unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByTestId('creative-writing-body-input')).toBeInTheDocument();
  });

  it('PAGE: a blank title does not call project-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    await view.findByTestId('creative-writing-body-input');
    fireEvent.click(view.getByRole('button', { name: 'Save page' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('project-create');
  });

  it('PAGE: typing the four-line fixture lands character-for-character and reads back exact (S2 regression guard)', async () => {
    const FIXTURE = [
      'The harbour light went out at dawn.',
      'Nobody on the quay believed it.',
      'The ferry came anyway, empty.',
      'We counted the gulls and left.',
    ].join('\n');
    const projects: { id: string; title: string; body: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string; body?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'project-create') {
        projects.push({ id: 'man_1', title: input?.title || '', body: input?.body || '' });
        return { data: { ok: true, result: { project: { id: 'man_1', title: input?.title, body: input?.body } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<CreativeWritingPage />);
    const bodyField = await view.findByTestId('creative-writing-body-input');
    fireEvent.change(bodyField, { target: { value: FIXTURE } });
    fireEvent.change(view.getByTestId('creative-writing-title'), { target: { value: 'Harbour notes' } });
    fireEvent.click(view.getByRole('button', { name: 'Save page' }));
    const heading = await view.findByRole('heading', { name: 'Harbour notes' });
    expect(heading).toBeInTheDocument();
    const savedBody = await view.findByTestId('creative-writing-body-man_1');
    expect(savedBody).toHaveTextContent(FIXTURE.replace(/\n/g, ' '));
    for (const line of FIXTURE.split('\n')) {
      expect(savedBody.textContent).toContain(line);
    }
    const save = lensRun.mock.calls.find((call) => call[1] === 'project-create');
    expect(save?.[2]).toEqual({ title: 'Harbour notes', body: FIXTURE });
  });

  it('SHORTCUT: the "n" command is disabled for the whole composing session (defense in depth)', async () => {
    lensRun.mockResolvedValue(listed([{ id: 'man_1', title: 'First page', body: 'Body one.' }]));
    const view = render(<CreativeWritingPage />);
    await view.findByRole('heading', { name: 'First page' });
    const lastCallBeforeCompose = lensCommandCalls[lensCommandCalls.length - 1];
    expect(lastCallBeforeCompose.find((c) => c.id === 'creative-writing-new')?.enabled).toBe(true);
    fireEvent.click(view.getByRole('button', { name: '+ New page' }));
    await view.findByTestId('creative-writing-body-input');
    const lastCallWhileComposing = lensCommandCalls[lensCommandCalls.length - 1];
    expect(lastCallWhileComposing.find((c) => c.id === 'creative-writing-new')?.enabled).toBe(false);
    // Typing "went" (embeds the shortcut letter) must still land whole in the body.
    fireEvent.change(view.getByTestId('creative-writing-body-input'), { target: { value: 'went' } });
    expect(view.getByTestId('creative-writing-body-input')).toHaveValue('went');
  });

  it('HEADER: shows the lens name signed-in', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    expect(await view.findByRole('heading', { name: 'Creative Writing' })).toBeInTheDocument();
    expect(await view.findByTestId('creative-writing-body-input')).toBeInTheDocument();
  });

  it('LOAD: shows a page already on the list, with its body, and skips a blank title', async () => {
    lensRun.mockResolvedValue(listed([
      { id: 'man_a', title: 'First page', body: 'Once upon a time.' },
      { id: 'man_b', title: '   ' },
    ]));
    const view = render(<CreativeWritingPage />);
    expect(await view.findByRole('heading', { name: 'First page' })).toBeInTheDocument();
    expect(view.getByTestId('creative-writing-body-man_a')).toHaveTextContent('Once upon a time.');
    expect(view.queryByTestId('creative-writing-body-input')).toBeNull();
  });

  it('PAGE: a refused create does not show the title and keeps the composer open', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    await view.findByTestId('creative-writing-body-input');
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'project-list') return listed([]);
      if (action === 'project-create') return { data: { ok: false, result: null, error: 'page_not_saved' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('creative-writing-title'), { target: { value: 'Bad page' } });
    fireEvent.click(view.getByRole('button', { name: 'Save page' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/page_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad page' })).toBeNull();
    expect(view.getByTestId('creative-writing-title')).toBeInTheDocument();
  });

  it('PAGE: a second page stays beside the first, and "+ New page" reopens a fresh composer', async () => {
    const projects: { id: string; title: string; body?: string }[] = [{ id: 'man_1', title: 'First page', body: 'Body one.' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string; body?: string }) => {
      if (action === 'project-list') return listed(projects);
      if (action === 'project-create') {
        projects.push({ id: 'man_2', title: input?.title || '', body: input?.body || '' });
        return { data: { ok: true, result: { project: { id: 'man_2', title: input?.title, body: input?.body } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<CreativeWritingPage />);
    expect(await view.findByRole('heading', { name: 'First page' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '+ New page' }));
    const bodyField = await view.findByTestId('creative-writing-body-input');
    expect(bodyField).toHaveFocus();
    fireEvent.change(view.getByTestId('creative-writing-title'), { target: { value: 'Second page' } });
    fireEvent.change(bodyField, { target: { value: 'Body two.' } });
    fireEvent.click(view.getByRole('button', { name: 'Save page' }));
    expect(await view.findByRole('heading', { name: 'Second page' })).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'First page' })).toBeInTheDocument();
  });

  it('PAGE: Cancel returns to the list without saving, once a first page exists', async () => {
    lensRun.mockResolvedValue(listed([{ id: 'man_1', title: 'First page', body: 'Body one.' }]));
    const view = render(<CreativeWritingPage />);
    await view.findByRole('heading', { name: 'First page' });
    fireEvent.click(view.getByRole('button', { name: '+ New page' }));
    await view.findByTestId('creative-writing-body-input');
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(view.queryByTestId('creative-writing-body-input')).toBeNull();
    expect(view.getByRole('heading', { name: 'First page' })).toBeInTheDocument();
  });

  it('PAGE: the line gutter renumbers off the body\'s own line count', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CreativeWritingPage />);
    const bodyField = await view.findByTestId('creative-writing-body-input');
    fireEvent.change(bodyField, { target: { value: 'one\ntwo\nthree' } });
    const list = view.getAllByRole('listitem').filter((li) => /^\d+$/.test(li.textContent || ''));
    expect(list.map((li) => li.textContent)).toEqual(['1', '2', '3']);
  });
});
