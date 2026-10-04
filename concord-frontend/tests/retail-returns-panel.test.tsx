/** ReturnsPanel — opens an RMA on a real order and walks it through the allowed transitions. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { ReturnsPanel } from '@/components/retail/ReturnsPanel';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => {
    if (action === 'orders-list') return Promise.resolve({ data: { ok: true, result: { orders: [{ id: 'o1', number: '#1001', total: 59.5 }] } } });
    if (action === 'returns-list') return Promise.resolve({ data: { ok: true, result: { returns: [
      { id: 'r1', orderId: 'o1', orderNumber: '#1001', reason: 'defective', restock: true, status: 'pending', rmaNumber: 'RMA-ABC123', initiatedAt: '2026-10-03' },
    ] } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
});

describe('ReturnsPanel', () => {
  it('opens a return on the selected order', async () => {
    render(<ReturnsPanel />);
    await screen.findByText('RMA-ABC123');
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'o1' } });
    fireEvent.change(screen.getByLabelText('Return reason'), { target: { value: 'wrong_item' } });
    fireEvent.click(screen.getByRole('button', { name: /open rma/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('retail', 'returns-create', expect.objectContaining({ orderId: 'o1', reason: 'wrong_item', restock: true })));
  });

  it('offers only the allowed next steps for a pending return', async () => {
    render(<ReturnsPanel />);
    await screen.findByText('RMA-ABC123');
    expect(screen.queryByRole('button', { name: /goods received/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('retail', 'returns-update', { id: 'r1', status: 'approved' }));
  });
});
