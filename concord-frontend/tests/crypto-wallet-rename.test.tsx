/**
 * WalletsPanel — wallet-rename wiring (HANDOFF-3 batch L16b).
 *
 * A user could create and delete a wallet but never rename one or
 * change its kind from the UI: the backend `wallet-rename` macro
 * (which updates both name and kind) had no caller. This pins the
 * inline edit flow: Rename opens name+kind fields seeded from the
 * wallet, Save dispatches wallet-rename, and the list refreshes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ lensRun: mocks.lensRun }));

import { WalletsPanel } from '@/components/crypto/CryptoTradePanels';

const WALLET = { id: 'w-1', name: 'Main Hot', kind: 'hot', address: null };

describe('WalletsPanel rename flow', () => {
  beforeEach(() => {
    mocks.lensRun.mockReset();
    mocks.lensRun.mockImplementation((req: { action: string }) => {
      if (req.action === 'wallet-list') return Promise.resolve({ data: { ok: true, result: { wallets: [WALLET] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
  });

  it('renames a wallet through the real wallet-rename macro', async () => {
    render(<WalletsPanel />);
    const renameBtn = await screen.findByRole('button', { name: 'Rename' });
    fireEvent.click(renameBtn);

    const nameInput = screen.getByLabelText('Wallet name');
    expect((nameInput as HTMLInputElement).value).toBe('Main Hot');
    fireEvent.change(nameInput, { target: { value: 'Ledger Nano' } });
    fireEvent.change(screen.getByLabelText('Wallet kind'), { target: { value: 'hardware' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.lensRun).toHaveBeenCalledWith({
        domain: 'crypto',
        action: 'wallet-rename',
        input: { id: 'w-1', name: 'Ledger Nano', kind: 'hardware' },
      });
    });
    // Save closes the editor and refreshes the list.
    await waitFor(() => {
      expect(mocks.lensRun.mock.calls.filter((c) => c[0]?.action === 'wallet-list').length).toBeGreaterThan(1);
    });
  });
});
