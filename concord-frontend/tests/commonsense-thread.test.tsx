/**
 * /lenses/commonsense — the obvious check.
 *
 * Ask stores a question. The finding and the exception show only after
 * check-detail returns them. A second question stays in the thread.
 * ConceptNet and the fact desk stay off this card. The action-panel
 * contract stays in commonsense-lens-states.test.tsx.
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

import CommonsenseLensPage from '@/app/lenses/commonsense/page';

interface Stored {
  id: string;
  question: string;
  finding: string;
  exception: string | null;
}

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function install(checks: Stored[], extra?: (name: string, input: Record<string, unknown>) => unknown) {
  lensRun.mockImplementation(async (_domain: string, name: string, input: Record<string, unknown> = {}) => {
    if (extra) {
      const overridden = extra(name, input);
      if (overridden) return overridden;
    }
    if (name === 'check-list') {
      return ok({
        checks: checks.map((item) => ({ id: item.id, question: item.question })),
        count: checks.length,
      });
    }
    if (name === 'check-detail') {
      const row = checks.find((item) => item.id === input.id);
      if (!row) return { data: { ok: false, result: null, error: 'check_not_found' } };
      return ok({
        check: { id: row.id, question: row.question, finding: row.finding, exception: row.exception },
      });
    }
    return { data: { ok: false, result: null, error: `unexpected ${name}` } };
  });
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('commonsense thread', () => {
  it('EMPTY: says the thread is empty and offers Ask', async () => {
    install([]);
    const view = render(<CommonsenseLensPage />);
    expect(await view.findByText('The thread is empty.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The obvious check' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Ask' })).toBeEnabled();
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.queryByText('ConceptNet')).toBeNull();
    expect(view.queryByText('Facts')).toBeNull();
    expect(view.queryByText('Workbench')).toBeNull();
  });

  it('WARMING: a shed list retries and then shows the empty card', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockImplementation(async () => ok({ checks: [], count: 0 }));
    const view = render(<CommonsenseLensPage />);
    expect(await view.findByText('The thread is empty.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<CommonsenseLensPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    install([]);
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('The thread is empty.')).toBeInTheDocument();
  });

  it('does not send a blank question', async () => {
    install([]);
    const view = render(<CommonsenseLensPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Ask' }));
    fireEvent.click(view.getByRole('button', { name: 'Ask this' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/question is required/i);
    expect(lensRun).not.toHaveBeenCalledWith('commonsense', 'check-ask', expect.anything());
  });

  it('shows the question only after list matches, with no finding yet', async () => {
    const checks: Stored[] = [];
    install(checks, (name, input) => {
      if (name !== 'check-ask') return undefined;
      checks.push({
        id: 'ck_1',
        question: String(input.question),
        finding: '',
        exception: null,
      });
      return ok({ checkId: 'ck_1', check: { id: 'ck_1', question: input.question } });
    });
    const view = render(<CommonsenseLensPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Ask' }));
    fireEvent.change(view.getByTestId('cs-question'), { target: { value: 'Is the door shut?' } });
    fireEvent.click(view.getByRole('button', { name: 'Ask this' }));
    expect(await view.findByRole('heading', { name: 'Is the door shut?' })).toBeInTheDocument();
    expect(view.queryByTestId('cs-finding')).toBeNull();
    expect(view.queryByTestId('cs-exception')).toBeNull();
    expect(view.queryByText('The thread is empty.')).toBeNull();
    expect(view.getByRole('button', { name: 'State the obvious' })).toBeInTheDocument();
    expect(view.container.querySelector('input')).toBeNull();
  });

  it('stays on the composer when the list does not echo the question', async () => {
    install([], (name) => {
      if (name === 'check-ask') return ok({ checkId: 'ck_1', check: { id: 'ck_1', question: 'Is the door shut?' } });
      if (name === 'check-list') return ok({ checks: [], count: 0 });
      return undefined;
    });
    const view = render(<CommonsenseLensPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Ask' }));
    fireEvent.change(view.getByTestId('cs-question'), { target: { value: 'Is the door shut?' } });
    fireEvent.click(view.getByRole('button', { name: 'Ask this' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.getByTestId('cs-question')).toBeInTheDocument();
    expect(view.queryByRole('heading', { name: 'Is the door shut?' })).toBeNull();
  });

  it('states and edits the finding only after detail reads it', async () => {
    const checks: Stored[] = [{ id: 'ck_1', question: 'Is the door shut?', finding: '', exception: null }];
    install(checks, (name, input) => {
      if (name !== 'check-finding') return undefined;
      const row = checks.find((item) => item.id === input.id);
      if (row) row.finding = String(input.finding);
      return ok({ checkId: 'ck_1', check: { id: 'ck_1', question: 'Is the door shut?' } });
    });
    const view = render(<CommonsenseLensPage />);
    expect(await view.findByRole('heading', { name: 'Is the door shut?' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'State the obvious' }));
    fireEvent.click(view.getByRole('button', { name: 'Save the finding' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/finding is required/i);
    expect(lensRun).not.toHaveBeenCalledWith('commonsense', 'check-finding', expect.anything());
    fireEvent.change(view.getByTestId('cs-finding-input'), { target: { value: 'The latch is down.' } });
    fireEvent.click(view.getByRole('button', { name: 'Save the finding' }));
    expect(await view.findByTestId('cs-finding')).toHaveTextContent('The latch is down.');
    fireEvent.click(view.getByRole('button', { name: 'Edit the finding' }));
    fireEvent.change(view.getByTestId('cs-finding-input'), { target: { value: 'The latch is still down.' } });
    fireEvent.click(view.getByRole('button', { name: 'Save the finding' }));
    expect(await view.findByTestId('cs-finding')).toHaveTextContent('The latch is still down.');
    expect(lensRun).toHaveBeenCalledWith('commonsense', 'check-finding', { id: 'ck_1', finding: 'The latch is still down.' });
  });

  it('notes an exception only after detail returns it, and keeps a second question', async () => {
    const checks: Stored[] = [{ id: 'ck_1', question: 'Is the door shut?', finding: 'The latch is down.', exception: null }];
    install(checks, (name, input) => {
      if (name === 'check-exception') {
        const row = checks.find((item) => item.id === input.id);
        if (row) row.exception = String(input.exception);
        return ok({ checkId: input.id, check: { id: input.id, question: row?.question } });
      }
      if (name === 'check-ask') {
        checks.push({ id: 'ck_2', question: String(input.question), finding: '', exception: null });
        return ok({ checkId: 'ck_2', check: { id: 'ck_2', question: input.question } });
      }
      return undefined;
    });
    const view = render(<CommonsenseLensPage />);
    expect(await view.findByTestId('cs-finding')).toHaveTextContent('The latch is down.');
    fireEvent.click(view.getByRole('button', { name: 'Note an exception' }));
    fireEvent.click(view.getByRole('button', { name: 'Save the exception' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/exception is required/i);
    fireEvent.change(view.getByTestId('cs-exception-input'), { target: { value: 'Unless the wind has it.' } });
    fireEvent.click(view.getByRole('button', { name: 'Save the exception' }));
    expect(await view.findByTestId('cs-exception')).toHaveTextContent('Unless the wind has it.');
    fireEvent.click(view.getByRole('button', { name: 'Ask' }));
    fireEvent.change(view.getByTestId('cs-question'), { target: { value: 'Is the light on?' } });
    fireEvent.click(view.getByRole('button', { name: 'Ask this' }));
    expect(await view.findByRole('heading', { name: 'Is the light on?' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Is the door shut?' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Is the door shut?' }));
    expect(await view.findByTestId('cs-finding')).toHaveTextContent('The latch is down.');
    expect(view.getByTestId('cs-exception')).toHaveTextContent('Unless the wind has it.');
  });
});
