// FIX-goddess-009 + FIX-forecast-007 — the Save-as-DTU receipt is the
// only in-lens handle on a just-saved DTU. It now links to the DTU and
// offers a two-step Delete (undo) that removes it and re-arms the save.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const createMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { dtus: { create: (...a: unknown[]) => createMock(...a), delete: (...a: unknown[]) => deleteMock(...a) } },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SaveAsDtuButton apiSource="wikipedia-goddess" title="Athena — goddess" content="Athena extract" confirm={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createMock.mockReset();
  deleteMock.mockReset();
  createMock.mockResolvedValue({ data: { ok: true, id: 'dtu_test123' } });
  deleteMock.mockResolvedValue({ data: { ok: true } });
});
afterEach(() => cleanup());

describe('SaveAsDtuButton receipt', () => {
  it('after save: Open links to the DTU and Delete undoes the save in two steps', async () => {
    renderButton();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as DTU' })); });
    const open = await screen.findByRole('link', { name: /Open/ });
    expect(open.getAttribute('href')).toBe('/dtu/dtu_test123');
    const del = screen.getByRole('button', { name: 'Delete' });
    await act(async () => { fireEvent.click(del); });
    expect(deleteMock).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('button', { name: 'Confirm delete' });
    await act(async () => { fireEvent.click(confirm); });
    expect(deleteMock).toHaveBeenCalledWith('dtu_test123');
    // The save is undone: the receipt is gone and saving is possible again.
    expect(await screen.findByRole('button', { name: 'Save as DTU' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open/ })).toBeNull();
  });
});
