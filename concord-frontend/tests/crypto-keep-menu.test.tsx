import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { CryptoKeepMenu } from '@/components/crypto/CryptoKeepMenu';
import type { CryptoLot } from '@/components/crypto/cryptoReport';

const lot: CryptoLot = {
  id: 'lot_1',
  number: 'H-00001',
  symbol: 'btc',
  ticker: 'BTC',
  chain: 'bitcoin',
  qty: 0.5,
  qtyRemaining: 0.5,
  costBasisUsd: 30000,
  unitCostUsd: 60000,
  acquiredAt: '2026-10-05',
};

const save = () => screen.getByRole('button', { name: /Save lot as DTU/i });
const draft = () => screen.getByRole('button', { name: /Draft in Thread/i });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('crypto lot handoff', () => {
  it('will not draft before the lot is saved', () => {
    render(<CryptoKeepMenu lot={lot} />);
    expect(draft()).toBeDisabled();
  });

  it('saves, reads back, then drafts citing that exact DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_k1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_k1' } } } };
      if (domain === 'thread' && action === 'thread-draft') {
        return { data: { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_k1' } } } };
      }
      return { data: { ok: true, result: {} } };
    });

    render(<CryptoKeepMenu lot={lot} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_k1\./)).toBeTruthy());

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_1, citing dtu_k1\. Not posted\./)).toBeTruthy());

    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect((draftCall?.[2] as Record<string, unknown>).citedDtuId).toBe('dtu_k1');
    expect(String((draftCall?.[2] as Record<string, unknown>).content)).toContain('H-00001');
  });

  it('does not claim a save when the read-back fails', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_k1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_other' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<CryptoKeepMenu lot={lot} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/read-back did not return it/)).toBeTruthy());
    expect(draft()).toBeDisabled();
  });

  it('does not claim a save when the store refuses', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: false, error: 'quota exceeded' } };
      return { data: { ok: true, result: {} } };
    });

    render(<CryptoKeepMenu lot={lot} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Not saved\. quota exceeded/)).toBeTruthy());
    expect(draft()).toBeDisabled();
  });

  it('renders nothing when there is no honest sentence', () => {
    const { container } = render(<CryptoKeepMenu lot={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the lot has no number', () => {
    const { container } = render(<CryptoKeepMenu lot={{ id: 'lot_1', number: '' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows already-drafted when Thread already cites this DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [{ id: 'th_9' }] } } };
      if (domain === 'thread' && action === 'draft-detail') {
        return { data: { ok: true, result: { draft: { id: 'th_9', status: 'draft', citedDtuId: 'dtu_k1' } } } };
      }
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_k1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_k1' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<CryptoKeepMenu lot={lot} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_k1\./)).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: /Drafted/i })).toBeDisabled());
    expect(screen.getByText(/Drafted in Thread as th_9/)).toBeTruthy();
  });
});