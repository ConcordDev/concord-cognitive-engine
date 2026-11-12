// FIX-death-insurance-006 — a beneficiary is picked by name/handle, and the
// writer's own user id is visible and copyable. Pins for PactWriter:
//  1. The signed-in user's own id renders beside a Copy control.
//  2. Typing a handle prefix queries the mention search and offers matches.
//  3. Picking a match fills the row with that user's id (not the typed text)
//     and marks the row as picked from the directory.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const apiGet = vi.fn();
const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn(async () => ({ data: {} })) },
  lensRun: (...a: unknown[]) => lensRunMock(...a),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-me-123', username: 'ramaj' }, isLoading: false }) }));

import { PactWriter } from '@/components/death-insurance/PactWriter';

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  apiGet.mockReset();
  lensRunMock.mockReset();
  apiGet.mockResolvedValue({ data: { ok: true, results: [{ userId: 'u-kayli-9', username: 'kayli', displayName: 'Kayli' }] } });
  lensRunMock.mockResolvedValue({ data: { ok: true, result: {} } });
});
afterEach(() => cleanup());

describe('PactWriter beneficiary picker', () => {
  it('shows the signed-in user their own copyable id', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
    render(<PactWriter onWritten={() => {}} />);
    expect(screen.getByText('u-me-123')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copy/ })); });
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('u-me-123');
    expect(screen.getByRole('button', { name: /Copied/ })).toBeTruthy();
  });

  it('searches by handle and fills the row with the picked user id', async () => {
    render(<PactWriter onWritten={() => {}} />);
    const input = screen.getByLabelText('Beneficiary 1') as HTMLInputElement;
    expect(input.placeholder).toMatch(/Search by name/);
    await act(async () => { fireEvent.focus(input); });
    await act(async () => { fireEvent.change(input, { target: { value: 'kay' } }); });
    await wait(300);
    expect(apiGet.mock.calls.some((c) => String(c[0]).includes('/api/social/mention-search?q=kay'))).toBe(true);
    const option = await screen.findByRole('button', { name: /Kayli/ });
    await act(async () => { fireEvent.click(option); });
    expect(input.value).toBe('u-kayli-9');
    expect(screen.getByText(/picked from the directory/)).toBeTruthy();
  });
});
