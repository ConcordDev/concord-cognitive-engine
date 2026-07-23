/**
 * ESignaturePanel — optimistic sign + real per-envelope progress.
 *
 * Pins the Fluidity-invariant rework: clicking "sign" reflects the new
 * state immediately (optimistic), reconciles quietly on success, and
 * rolls back visibly on failure — never a frozen button waiting on the
 * network, and never a fabricated success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
const addToast = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(
    (sel?: (s: unknown) => unknown) => (sel ? sel({ addToast, toasts: [] }) : { addToast, toasts: [] }),
    { getState: () => ({ addToast, toasts: [] }) }
  ),
}));

import { ESignaturePanel } from '@/components/legal/ESignaturePanel';

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: 'env-1',
    number: 'ENV-0001',
    documentId: 'doc-1',
    documentName: 'Retainer Agreement',
    matterId: 'm-1',
    status: 'sent' as const,
    sentAt: '2026-07-01T00:00:00.000Z',
    completedAt: null,
    recipients: [
      { id: 'r1', name: 'Alice Chen', email: 'alice@example.com', role: 'client', status: 'pending' as const, signedAt: null },
      { id: 'r2', name: 'Bo Reyes', email: 'bo@example.com', role: 'counsel', status: 'signed' as const, signedAt: '2026-07-02T00:00:00.000Z' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  lensRun.mockReset();
  addToast.mockReset();
});

describe('ESignaturePanel', () => {
  it('renders a real per-envelope progress bar reflecting signed/total', async () => {
    lensRun.mockResolvedValueOnce({ data: { result: { envelopes: [envelope()] } } });
    render(<ESignaturePanel />);
    await waitFor(() => expect(screen.getByText('1/2')).toBeInTheDocument());
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
  });

  it('signing a recipient is optimistic: the end state shows immediately, before the network resolves', async () => {
    lensRun.mockResolvedValueOnce({ data: { result: { envelopes: [envelope()] } } });
    render(<ESignaturePanel />);
    await waitFor(() => expect(screen.getByText('Alice Chen')).toBeInTheDocument());
    expect(screen.getByText('Simulate sign')).toBeInTheDocument();

    // Sign call never resolves during this assertion window — if the UI
    // waited for it, "signed" would not appear yet.
    let resolveSign!: (v: unknown) => void;
    lensRun.mockImplementationOnce(() => new Promise((res) => { resolveSign = res; }));

    fireEvent.click(screen.getByText('Simulate sign'));

    // Optimistic: the row already reads "signed" and progress is 2/2,
    // even though the network call above is still pending. A quiet
    // "saving…" affordance marks the still-unconfirmed state honestly.
    expect(screen.queryByText('Simulate sign')).not.toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByText(/saving…/)).toBeInTheDocument();

    // Reconcile refetch, once the sign call finally resolves.
    lensRun.mockResolvedValueOnce({ data: { result: { envelopes: [envelope({ recipients: [
      { id: 'r1', name: 'Alice Chen', email: 'alice@example.com', role: 'client', status: 'signed', signedAt: '2026-07-03T00:00:00.000Z' },
      { id: 'r2', name: 'Bo Reyes', email: 'bo@example.com', role: 'counsel', status: 'signed', signedAt: '2026-07-02T00:00:00.000Z' },
    ], status: 'completed', completedAt: '2026-07-03T00:00:00.000Z' })] } } });
    resolveSign({ data: { ok: true } });
    await waitFor(() => expect(screen.queryByText(/saving…/)).not.toBeInTheDocument());
    expect(screen.getByText('signed 2026-07-03')).toBeInTheDocument();
  });

  it('rolls back visibly and toasts an error when the sign call fails', async () => {
    lensRun.mockResolvedValueOnce({ data: { result: { envelopes: [envelope()] } } });
    render(<ESignaturePanel />);
    await waitFor(() => expect(screen.getByText('Alice Chen')).toBeInTheDocument());

    lensRun.mockRejectedValueOnce(new Error('network down'));

    fireEvent.click(screen.getByText('Simulate sign'));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' })
    ));
    // Rolled back: still 1/2, "Simulate sign" button is back.
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('Simulate sign')).toBeInTheDocument();
  });

  it('celebrates real completion only when every recipient has actually signed', async () => {
    const almostDone = envelope({
      recipients: [
        { id: 'r1', name: 'Alice Chen', email: 'alice@example.com', role: 'client', status: 'pending', signedAt: null },
      ],
    });
    lensRun.mockResolvedValueOnce({ data: { result: { envelopes: [almostDone] } } });
    render(<ESignaturePanel />);
    await waitFor(() => expect(screen.getByText('0/1')).toBeInTheDocument());

    lensRun.mockResolvedValueOnce({ data: { ok: true } });
    lensRun.mockResolvedValueOnce({ data: { result: { envelopes: [envelope({
      recipients: [{ id: 'r1', name: 'Alice Chen', email: 'alice@example.com', role: 'client', status: 'signed', signedAt: '2026-07-03T00:00:00.000Z' }],
      status: 'completed',
      completedAt: '2026-07-03T00:00:00.000Z',
    })] } } });

    fireEvent.click(screen.getByText('Simulate sign'));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: expect.stringMatching(/completed/i) })
    ));
  });
});
