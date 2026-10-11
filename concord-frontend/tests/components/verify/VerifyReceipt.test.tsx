/**
 * /verify posts a receipt with no CSRF header. A 403 from that endpoint is
 * the gate refusing the call, not a signature verdict.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VerifyReceipt from '@/components/verify/VerifyReceipt';

const RECEIPT = JSON.stringify({
  solver: 'fea-solver@5.0.0',
  signature: { keyId: '53078bd870dc2e17', digest: 'ab', signature: 'c2ln' },
});

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as Response);
}

async function submit() {
  fireEvent.change(screen.getByLabelText('Receipt JSON'), { target: { value: RECEIPT } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VerifyReceipt', () => {
  it('shows a valid verdict when the server checked the signature', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, {
      valid: true,
      reason: null,
      keyId: '53078bd870dc2e17',
      digest: 'ab',
    })));
    render(<VerifyReceipt />);
    await submit();
    expect(await screen.findByText('Valid')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows invalid when the server actually checked and rejected the signature', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, {
      valid: false,
      reason: 'bad_signature',
    })));
    render(<VerifyReceipt />);
    await submit();
    expect(await screen.findByText('Invalid')).toBeInTheDocument();
    expect(screen.getByText('bad_signature')).toBeInTheDocument();
  });

  it('says the receipt was not checked when the server returns 403 CSRF_FAILED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(403, {
      ok: false,
      error: 'CSRF token invalid or missing',
      code: 'CSRF_FAILED',
      valid: false,
    })));
    render(<VerifyReceipt />);
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/CSRF/);
    expect(alert.textContent).toMatch(/Nothing was verified/);
    expect(screen.queryByText('Valid')).not.toBeInTheDocument();
    expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
  });

  it('says the receipt was not checked on any other 403', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(403, { error: 'nope' })));
    render(<VerifyReceipt />);
    await submit();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/403/);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Nothing was verified/);
    expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
  });
});
