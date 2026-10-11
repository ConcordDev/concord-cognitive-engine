import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '@/lib/api/client';
import { TransferFlow } from '@/components/wallet/TransferFlow';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

describe('TransferFlow clarity', () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("shows the insufficient-balance label when the amount is above the balance", () => {
    render(<TransferFlow balance={12} onSuccess={() => {}} />);
    expect(screen.getByRole('button', { name: 'Enter transfer details' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '13' } });

    const button = screen.getByRole('button', { name: 'Insufficient balance (12 CC available)' });
    expect(button).toBeDisabled();
    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('resolves @username and shows the display name before confirm', async () => {
    mockedApi.get.mockResolvedValue({
      data: { ok: true, user: { id: 'user_ada', displayName: 'Ada Lovelace' } },
    });
    render(<TransferFlow balance={100} onSuccess={() => {}} />);

    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: '@ada' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send 5 CC' }));

    expect(await screen.findByRole('heading', { name: 'Confirm transfer' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(mockedApi.get).toHaveBeenCalledWith('/api/economy/resolve-recipient', {
      params: { q: '@ada' },
    });
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('shows an inline error when the recipient is unknown', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: false, error: 'unknown_user' } });
    render(<TransferFlow balance={100} onSuccess={() => {}} />);

    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'nobody@example.com' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send 5 CC' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown user');
    expect(screen.queryByRole('heading', { name: 'Confirm transfer' })).not.toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});
