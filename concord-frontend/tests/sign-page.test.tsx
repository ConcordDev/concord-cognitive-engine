/** /sign/[token] — the public signing page: reads the document, needs consent + a typed name, posts to the public route. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useParams: () => ({ token: 'tok123456789012345678' }) }));

import SignPage from '@/app/sign/[token]/page';

const VIEW = {
  document: { title: 'Consulting agreement', text: 'Alice will consult for Bob.', hash: 'ab'.repeat(32) },
  signer: { name: 'Bob', email: 'bob@example.com', role: 'signer', status: 'pending', signedAt: null },
  envelopeStatus: 'out_for_signature',
  parties: [{ name: 'Alice', role: 'signer', status: 'signed' }, { name: 'Bob', role: 'signer', status: 'pending' }],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { signed: true } }) });
    const signed = fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST');
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: signed ? { ...VIEW, signer: { ...VIEW.signer, status: 'signed', signedAt: '2026-10-04T10:00:00Z' } } : VIEW }) });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('SignPage', () => {
  it('shows the document and only enables Sign after consent', async () => {
    render(<SignPage />);
    await screen.findByText('Consulting agreement');
    expect(screen.getByText('Alice will consult for Bob.')).toBeTruthy();
    const button = screen.getByRole('button', { name: /sign/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/esign/tok123456789012345678/sign', expect.objectContaining({ method: 'POST', body: JSON.stringify({ typedName: 'Bob', consent: true }) })));
    await screen.findByText(/You can close this page/);
  });

  it('explains an invalid link honestly', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false, error: 'link_not_found' }) }));
    render(<SignPage />);
    await screen.findByRole('alert');
    expect(screen.getByText(/invalid, was replaced/)).toBeTruthy();
  });
});
