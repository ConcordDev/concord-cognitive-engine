// FIX-platform-001 — Scope DTU cards gain Edit and Delete alongside
// Promote. Edit saves title/tags via dtus.update; delete is two-step
// via dtus.delete. A card positively owned by someone else shows
// neither control.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const updateMock = vi.fn(async () => ({ data: { ok: true } }));
const deleteMock = vi.fn(async () => ({ data: { ok: true } }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user_me' } }) }));
vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    scope: {
      metrics: vi.fn(async () => ({ data: { globalCount: 0, marketplaceCount: 0, localCount: 2 } })),
      dtus: vi.fn(async () => ({ data: { dtus: [], total: 0 } })),
      promote: vi.fn(async () => ({ data: { ok: true } })),
    },
    dtus: {
      list: vi.fn(async () => ({
        data: {
          total: 2,
          dtus: [
            { id: 'dtu_mine', title: 'My scope item', scope: 'local', tags: ['a'], creatorId: 'user_me', createdAt: '2026-11-09T00:00:00.000Z' },
            { id: 'dtu_theirs', title: 'Their scope item', scope: 'local', tags: [], creatorId: 'user_other', createdAt: '2026-11-09T00:00:00.000Z' },
          ],
        },
      })),
      update: (...a: unknown[]) => updateMock(...(a as [])),
      delete: (...a: unknown[]) => deleteMock(...(a as [])),
    },
  },
}));

import { ScopeControls } from '@/components/platform/ScopeControls';

beforeEach(() => { updateMock.mockClear(); deleteMock.mockClear(); });
afterEach(() => cleanup());

function renderControls() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScopeControls />
    </QueryClientProvider>,
  );
}

describe('scope controls edit/delete', () => {
  it('edits and deletes my DTU; offers neither on someone else\u2019s', async () => {
    renderControls();
    const edit = await screen.findByRole('button', { name: 'Edit My scope item' });
    expect(screen.queryByRole('button', { name: 'Edit Their scope item' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Their scope item' })).toBeNull();

    await act(async () => { fireEvent.click(edit); });
    const titleInput = screen.getByLabelText('DTU title');
    await act(async () => { fireEvent.change(titleInput, { target: { value: 'Renamed item' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0][0]).toBe('dtu_mine');
    expect((updateMock.mock.calls[0][1] as { title: string }).title).toBe('Renamed item');

    const del = await screen.findByRole('button', { name: 'Delete My scope item' });
    await act(async () => { fireEvent.click(del); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' })); });
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('dtu_mine'));
  });
});
