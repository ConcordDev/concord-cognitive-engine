/**
 * Classroom, Forecast, Productivity north stars.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'ramaj', email: 'r@x', role: 'owner' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { TheRoom } from '@/components/classroom/TheRoom';
import { TheNextReading } from '@/components/forecast/TheNextReading';
import { ShortList } from '@/components/productivity/ShortList';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function renderInShell(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeyboardProvider>{ui}</KeyboardProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => { lensRunMock.mockReset(); });

describe('room north stars', () => {
  it('classroom opens a returned cohort and refuses an empty room', async () => {
    lensRunMock.mockResolvedValue(ok({ ok: true, teaching: [], studying: [] }));
    const view = renderInShell(<TheRoom onOpenDesk={() => {}} />);
    expect(await screen.findByText('No class open.')).toBeTruthy();
    expect(screen.getByText('Nothing selected.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open a class' }));
    expect(await screen.findByText('No class to open.')).toBeTruthy();
    view.unmount();

    lensRunMock.mockResolvedValue(ok({ ok: true, teaching: [{ id: 3, name: 'Beams', enrolled: 4 }], studying: [] }));
    renderInShell(<TheRoom onOpenDesk={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Beams/ }));
    expect(await screen.findByTestId('classroom-open')).toBeTruthy();
    expect(screen.getByText('4 enrolled')).toBeTruthy();
  });

  it('forecast does not call the feed until a series is named', async () => {
    renderInShell(<TheNextReading onOpenDesk={() => {}} />);
    expect(screen.getByText('No series yet. Nothing is drawn until a feed answers.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a series' }));
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'concordia-hub' } });
    lensRunMock.mockResolvedValue(ok({ ok: true, forecast: { weather: { kind: 'clear', temperature_c: 18 } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose a series' }));
    expect(await screen.findByText('clear · 18°C')).toBeTruthy();
    expect(lensRunMock).toHaveBeenCalledWith('forecast', 'recent', { worldId: 'concordia-hub' });
  });

  it('productivity adds a due-today task only after text', async () => {
    lensRunMock.mockImplementation((_d: string, name: string) => {
      if (name === 'today-view') return Promise.resolve(ok({ tasks: [], overdue: 0, dueToday: 0 }));
      if (name === 'task-add') return Promise.resolve(ok({ task: { id: 'tsk_1', content: 'File the note' } }));
      return Promise.resolve(ok({}));
    });
    renderInShell(<ShortList onOpenDesk={() => {}} />);
    expect(await screen.findByText('Nothing on the list.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    const task = await screen.findByLabelText('Task');
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'task-add')).toBe(false);
    fireEvent.change(task, { target: { value: 'File the note' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'task-add')).toBe(true);
    });
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'task-add');
    expect(call?.[2]).toMatchObject({ content: 'File the note' });
    expect(typeof (call?.[2] as { dueDate?: string }).dueDate).toBe('string');
  });
});
