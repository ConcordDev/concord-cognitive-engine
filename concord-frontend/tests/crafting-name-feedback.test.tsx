/**
 * FIX-crafting-005 — starting a piece with an empty or whitespace name
 * used to be a silent no-op: the button stayed enabled, the click (or
 * Enter) dropped the name without a word. The create path now refuses
 * out loud with the same words the rename path uses, the button stays
 * disabled until the name is real, and a hint under the field says why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const lensRunMock = vi.fn(async (domain: string, action: string) => {
  if (domain === 'drafts' && action === 'load') return { data: { result: { ok: true, draft: null } } };
  if (domain === 'drafts' && action === 'save') return { data: { result: { ok: true, savedAt: 1700000000 } } };
  return { data: { result: { ok: true } } };
});
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: (...args: unknown[]) => apiPut(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  lensRun: (...args: unknown[]) => lensRunMock(...(args as [string, string])),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import CraftingPage from '@/app/lenses/crafting/page';

function ok(data: Record<string, unknown>) {
  return Promise.resolve({ data });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  apiPatch.mockReset();
  apiDelete.mockReset();
  lensRunMock.mockClear();
  window.localStorage.clear();
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/crafting/recipes') return ok({ ok: true, recipes: [] });
    if (url === '/api/lens/crafting') return ok({ ok: true, artifacts: [], total: 0 });
    return ok({});
  });
  apiPost.mockResolvedValue(ok({ ok: true }));
  apiPut.mockResolvedValue(ok({ ok: true }));
  apiPatch.mockResolvedValue(ok({ ok: true }));
  apiDelete.mockResolvedValue(ok({ ok: true }));
});

describe('crafting name feedback (FIX-crafting-005)', () => {
  it('the start button is disabled with a hint while the new name is blank, and enables when it is real', async () => {
    const { getByRole, getByLabelText, getByText } = render(<CraftingPage />);
    const button = await waitFor(() => getByRole('button', { name: '+ Start a piece' }));
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(getByText('Give the piece a name to put it on the bench.')).toBeInTheDocument());
    expect((getByRole('button', { name: '+ Start a piece' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(getByLabelText('Piece name'), { target: { value: '   ' } });
    expect((getByRole('button', { name: '+ Start a piece' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(getByLabelText('Piece name'), { target: { value: 'Bench hook' } });
    expect((getByRole('button', { name: '+ Start a piece' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('submitting the form with a whitespace name refuses out loud and posts nothing', async () => {
    const { getByRole, getByLabelText, getByText, container } = render(<CraftingPage />);
    const button = await waitFor(() => getByRole('button', { name: '+ Start a piece' }));
    await act(async () => { fireEvent.click(button); });
    const input = await waitFor(() => getByLabelText('Piece name') as HTMLInputElement);
    fireEvent.change(input, { target: { value: '   ' } });
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    await act(async () => { fireEvent.submit(form as HTMLFormElement); });
    expect(getByText('A piece needs a name.')).toBeInTheDocument();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('crafting-name-error');
    expect(apiPost).not.toHaveBeenCalledWith('/api/crafting/design', expect.anything());
  });
});
