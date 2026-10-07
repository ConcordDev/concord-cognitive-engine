import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRun = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ lensRun }));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (input: unknown) => input }));

import { WalletReceiptMenu } from '@/components/wallet/WalletReceiptMenu';

describe('WalletReceiptMenu', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders nothing without a batch identifier', () => {
    const { container } = render(<WalletReceiptMenu receipt={{ kind: 'request', sourceId: 'r1', amount: 1, batchId: '', counterparty: 'u2' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('saves, verifies, and sends the receipt DTU to Finance', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { dtu: { id: 'dtu_1' } } } })
      .mockResolvedValueOnce({ data: { ok: true, result: { dtu: { id: 'dtu_1' } } } })
      .mockResolvedValueOnce({ data: { ok: true, result: { receipt: { id: 'fin_1', citedDtuId: 'dtu_1' } } } });
    render(<WalletReceiptMenu receipt={{ kind: 'request', sourceId: 'r1', amount: 12, batchId: 'batch-1', counterparty: 'u2' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Save receipt/i }));
    expect(await screen.findByText(/Saved as private DTU dtu_1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send this DTU/i }));
    expect(await screen.findByRole('link', { name: /Open Finance receipt fin_1/i })).toHaveAttribute('href', '/lenses/finance');
  });

  it('surfaces save failures without a success-shaped fallback', async () => {
    lensRun.mockRejectedValueOnce(new Error('network down'));
    render(<WalletReceiptMenu receipt={{ kind: 'split', sourceId: 's1', amount: 4, batchId: 'batch-2', counterparty: 'u3' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Save receipt/i }));
    await waitFor(() => expect(screen.getByText(/Not saved. network down/)).toBeInTheDocument());
  });
});
