/**
 * /lenses/cognition — one trace.
 *
 * Open a trace calls cognition.exportTrace and shows the title only
 * after listExports contains that id and the same title, and the
 * question only after getExport returns it on the stored trace. Mode
 * stays off the card. The rules are empty chrome, not inputs.
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

import CognitionLens from '@/app/lenses/cognition/page';

function listed(rows: { id: string; title: string; mode?: string | null }[]) {
  return { data: { ok: true, result: { exports: rows, count: rows.length }, error: null } };
}

function opened(id: string, question: string) {
  return {
    data: {
      ok: true,
      result: { export: { id, trace: { input: { question } } } },
      error: null,
    },
  };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('cognition card', () => {
  it('EMPTY: says no trace yet, draws three rules, and offers Open a trace', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitionLens />);
    expect(await view.findByText('No trace yet.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The trace' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Open a trace' })).toBeEnabled();
    expect(view.getAllByTestId('cg-rule')).toHaveLength(3);
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.queryByText('Reasoning')).toBeNull();
    expect(view.queryByText('Drift')).toBeNull();
  });

  it('WARMING: a shed listExports retries and then shows the empty card', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockResolvedValue(listed([]));
    const view = render(<CognitionLens />);
    expect(await view.findByText('No trace yet.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<CognitionLens />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No trace yet.')).toBeInTheDocument();
  });

  it('TRACE: a blank title does not call exportTrace', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitionLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a trace' }));
    expect(view.queryByText('No trace yet.')).toBeNull();
    expect(view.queryByTestId('cg-rule')).toBeNull();
    fireEvent.change(view.getByTestId('cg-question-input'), { target: { value: 'What held?' } });
    fireEvent.click(view.getByRole('button', { name: 'Open a trace' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('exportTrace');
  });

  it('TRACE: a blank question does not call exportTrace', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitionLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a trace' }));
    fireEvent.change(view.getByTestId('cg-title'), { target: { value: 'Door trace' } });
    fireEvent.click(view.getByRole('button', { name: 'Open a trace' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A question is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('exportTrace');
  });

  it('TRACE: shows the title and question only after list and get match', async () => {
    const rows: { id: string; title: string; question: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { exportId?: string; title?: string; trace?: { input?: { question?: string } } }) => {
      if (action === 'listExports') return listed(rows);
      if (action === 'getExport') {
        const row = rows.find((item) => item.id === input?.exportId);
        return opened(row?.id || '', row?.question || '');
      }
      if (action === 'exportTrace') {
        rows.unshift({ id: 'cogexp_1', title: input?.title || '', question: input?.trace?.input?.question || '' });
        return { data: { ok: true, result: { exportId: 'cogexp_1', export: { title: input?.title } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<CognitionLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a trace' }));
    fireEvent.change(view.getByTestId('cg-title'), { target: { value: '  Door trace  ' } });
    fireEvent.change(view.getByTestId('cg-question-input'), { target: { value: '  What did the door hinge on?  ' } });
    fireEvent.click(view.getByRole('button', { name: 'Open a trace' }));
    expect(await view.findByRole('heading', { name: 'Door trace' })).toBeInTheDocument();
    expect(view.getByText('What did the door hinge on?')).toBeInTheDocument();
    expect(view.queryByText('No trace yet.')).toBeNull();
    expect(view.queryByText('abductive')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'exportTrace');
    expect(save?.[0]).toBe('cognition');
    expect(save?.[2]).toEqual({
      title: 'Door trace',
      trace: { input: { question: 'What did the door hinge on?' } },
    });
  });

  it('TRACE: a list miss does not show the title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'listExports') return listed([]);
      if (action === 'exportTrace') {
        return { data: { ok: true, result: { exportId: 'cogexp_missing' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<CognitionLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a trace' }));
    fireEvent.change(view.getByTestId('cg-title'), { target: { value: 'Lost trace' } });
    fireEvent.change(view.getByTestId('cg-question-input'), { target: { value: 'Gone?' } });
    fireEvent.click(view.getByRole('button', { name: 'Open a trace' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost trace' })).toBeNull();
  });

  it('GREETING: title-cases the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitionLens />);
    expect(await view.findByRole('heading', { name: 'The trace, Ramaj' })).toBeInTheDocument();
    expect(await view.findByText('No trace yet.')).toBeInTheDocument();
  });

  it('LOAD: shows a stored title and question and hides mode', async () => {
    lensRun.mockImplementation(async (_d: string, action: string, input?: { exportId?: string }) => {
      if (action === 'listExports') {
        return listed([
          { id: 'cogexp_a', title: 'First trace', mode: 'abductive' },
          { id: 'cogexp_b', title: '   ' },
        ]);
      }
      if (action === 'getExport' && input?.exportId === 'cogexp_a') {
        return opened('cogexp_a', 'A stored question.');
      }
      throw new Error(action);
    });
    const view = render(<CognitionLens />);
    expect(await view.findByRole('heading', { name: 'First trace' })).toBeInTheDocument();
    expect(view.getByText('A stored question.')).toBeInTheDocument();
    expect(view.queryByText('No trace yet.')).toBeNull();
    expect(view.queryByText('abductive')).toBeNull();
  });

  it('TRACE: a refused create does not show the title', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CognitionLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a trace' }));
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'listExports') return listed([]);
      if (action === 'exportTrace') return { data: { ok: false, result: null, error: 'trace_not_saved' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('cg-title'), { target: { value: 'Bad trace' } });
    fireEvent.change(view.getByTestId('cg-question-input'), { target: { value: 'No?' } });
    fireEvent.click(view.getByRole('button', { name: 'Open a trace' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/trace_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad trace' })).toBeNull();
    expect(view.getByTestId('cg-title')).toBeInTheDocument();
  });
});
