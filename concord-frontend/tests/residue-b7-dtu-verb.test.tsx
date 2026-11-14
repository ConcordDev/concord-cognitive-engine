/**
 * RESIDUE B7 — the canonical DTU archive/delete verb (CB-0554 ruling (1)),
 * surface pins. The verb itself is server-side (lib/dtu-family.js +
 * dtu.archive); these pin the surfaces that finally CALL a delete:
 *  - ClaimVerificationPanel: the minted verification DTU can be deleted
 *    (FIX-grounding-010, delete leg).
 *  - MlActionPanel: the minted DTU can be deleted and the published model
 *    card unpublished/deleted past the 30s recall (FIX-ml-011,
 *    delete/unpublish leg).
 *  - QuickCapture (common): captures in the lens are listed and deletable
 *    where they were made (FIX-commonsense-003 · FIX-docs-006 ·
 *    FIX-strategic-adds-004 · FIX-ux-suite-007 capture leg).
 *  - RepoWatchlist: an ingested feed DTU can be removed (FIX-fork-011,
 *    remove leg).
 *  - MySubmissions: a declined work can be removed, like a withdrawn one
 *    (FIX-vault-001 carried leg).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { apiPost, apiGet, apiDelete, dtusDelete, lensRunDomain, lensRunFn, addToast, captureToggle } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  apiGet: vi.fn(),
  apiDelete: vi.fn(),
  dtusDelete: vi.fn(),
  lensRunDomain: vi.fn(),
  lensRunFn: vi.fn(),
  addToast: vi.fn(),
  captureToggle: { current: null as null | (() => void) },
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    post: (...args: unknown[]) => apiPost(...args),
    get: (...args: unknown[]) => apiGet(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  apiHelpers: {
    dtus: { delete: (...args: unknown[]) => dtusDelete(...args) },
    lens: {
      runDomain: (...args: unknown[]) => lensRunDomain(...args),
      create: vi.fn(async () => ({ data: { ok: true } })),
    },
  },
  lensRun: (...args: unknown[]) => lensRunFn(...args),
}));

vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));

vi.mock('@/lib/lens-dock', () => ({
  useLensTool: (_name: string, cb: () => void) => { captureToggle.current = cb; },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

import { ClaimVerificationPanel } from '@/components/grounding/ClaimVerificationPanel';
import { MlActionPanel } from '@/components/ml/MlActionPanel';
import { QuickCapture } from '@/components/common/QuickCapture';
import { RepoWatchlist } from '@/components/fork/RepoWatchlist';
import { MySubmissions, type MySubmission } from '@/components/vault/MySubmissions';

beforeEach(() => {
  apiPost.mockReset(); apiGet.mockReset(); apiDelete.mockReset();
  dtusDelete.mockReset(); lensRunDomain.mockReset(); lensRunFn.mockReset();
  addToast.mockClear();
  captureToggle.current = null;
  dtusDelete.mockResolvedValue({ data: { ok: true } });
  apiDelete.mockResolvedValue({ data: { ok: true } });
});

describe('FIX-grounding-010 delete leg — the verification DTU can be deleted', () => {
  it('mint shows the id with a delete; confirming removes it and re-arms Mint', async () => {
    apiPost.mockImplementation(async (_url: string, body: { input?: { source?: string } }) => {
      void body;
      return { data: { ok: true, result: { dtu: { id: 'dtu_verify_1' } } } };
    });
    lensRunFn.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<ClaimVerificationPanel />);
    fireEvent.change(screen.getByLabelText('Claim'), { target: { value: 'The fastest land animal is the cheetah.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Mint/ }));
    await waitFor(() => expect(screen.getByText('dtu_verify_1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete verification DTU' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(dtusDelete).toHaveBeenCalledWith('dtu_verify_1'));
    await waitFor(() => expect(screen.queryByText('dtu_verify_1')).toBeNull());
    expect((screen.getByRole('button', { name: /^Mint/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('FIX-ml-011 delete/unpublish leg', () => {
  function mockMl() {
    lensRunDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'modelEvaluate') return { data: { ok: true, result: { type: 'classification', accuracy: 91, avgF1: 0.9, samples: 4, perClass: [] } } };
      return { data: { ok: true, result: {} } };
    });
    apiPost.mockImplementation(async (url: string, body?: { input?: { source?: string } }) => {
      if (url === '/api/lens/run') {
        const src = body?.input?.source;
        return { data: { ok: true, result: { dtu: { id: src === 'ml:modelcard:publish' ? 'dtu_card_1' : 'dtu_mint_1' } } } };
      }
      return { data: { ok: true } }; // publish flag POST
    });
  }

  it('the minted DTU can be deleted from the bench', async () => {
    mockMl();
    render(<MlActionPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Mint/ }));
    await waitFor(() => expect(screen.getByText(/Minted DTU · dtu_mint_1/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete minted DTU' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(dtusDelete).toHaveBeenCalledWith('dtu_mint_1'));
    await waitFor(() => expect(screen.queryByText(/Minted DTU ·/)).toBeNull());
  });

  it('the published model card can be unpublished past the recall window', async () => {
    mockMl();
    render(<MlActionPanel />);
    // Drive eval through the panel's own fields: preds + actuals textareas.
    const boxes = screen.getAllByRole('textbox');
    fireEvent.change(boxes[0], { target: { value: '1,0,1' } });
    fireEvent.change(boxes[1], { target: { value: '1,0,0' } });
    fireEvent.click(screen.getByRole('button', { name: /Evaluate/ }));
    await waitFor(() => expect(screen.getAllByText(/91%/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Publish/ }));
    fireEvent.click(screen.getByRole('button', { name: /Publish/ }));
    await waitFor(() => expect(screen.getByText(/Model card · dtu_card_1/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/dtus/dtu_card_1/publish'));
    await waitFor(() => expect(screen.queryByText(/Model card ·/)).toBeNull());
  });
});

describe('capture riders — QuickCapture lists and deletes captures in the lens', () => {
  it('a capture shows in the modal list and deletes through the lens verb', async () => {
    let gets = 0;
    apiGet.mockImplementation(async () => {
      gets += 1;
      const artifacts = gets <= 1
        ? [{ id: 'lart_cap_1', title: 'qa capture one', data: { content: 'a thought worth keeping' }, meta: { tags: [], status: 'draft', visibility: 'private' }, createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z', version: 1 }]
        : [];
      return { data: { ok: true, artifacts, total: artifacts.length } };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <QuickCapture domain="commonsense" />
      </QueryClientProvider>,
    );
    expect(captureToggle.current).toBeTruthy();
    fireEvent.click(document.body); // settle
    captureToggle.current?.();
    await waitFor(() => expect(screen.getByText('Captures in this lens')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('qa capture one')).toBeTruthy());
    expect(screen.getByText('a thought worth keeping')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete capture qa capture one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/lens/commonsense/lart_cap_1'));
    await waitFor(() => expect(screen.queryByText('qa capture one')).toBeNull());
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: 'Capture deleted.' }));
  });
});

describe('FIX-fork-011 remove leg — an ingested feed DTU can be removed', () => {
  it('the ingested list offers delete; confirming removes the DTU and refreshes', async () => {
    let feedCalls = 0;
    lensRunFn.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'watch-list') return { data: { ok: true, result: { repos: [] } } };
      if (action === 'watch-dashboard') return { data: { ok: true, result: { repos: 0, totalStars: 0, refreshed: 0, byReason: {} } } };
      if (action === 'feed-list') {
        feedCalls += 1;
        const items = feedCalls <= 1
          ? [{ id: 'dtu_feed_1', title: 'Push to main', repo: 'nodejs/node', actor: 'octocat', publishedAt: '2026-11-12T00:00:00Z', type: 'PushEvent' }]
          : [];
        return { data: { ok: true, result: { items } } };
      }
      return { data: { ok: true, result: {} } };
    });
    render(<RepoWatchlist />);
    await waitFor(() => expect(screen.getByText('Push to main')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete Push to main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Push to main' }));
    await waitFor(() => expect(dtusDelete).toHaveBeenCalledWith('dtu_feed_1'));
    await waitFor(() => expect(screen.queryByText('Push to main')).toBeNull());
  });
});

describe('FIX-vault-001 carried leg — a declined work can be removed', () => {
  const BASE: MySubmission = {
    id: 'vsub_1',
    title: 'A small study of light',
    status: 'declined',
    workKind: 'other',
    description: 'A study in one movement.',
    body: 'The light arrives before the sentence does.',
    submittedAt: 1700000000,
  };
  const onWithdraw = vi.fn(async () => null);
  const onEdit = vi.fn(async () => null);
  const onRemove = vi.fn(async () => null);

  it('a declined work offers Remove and the confirm fires onRemove', async () => {
    render(<MySubmissions submissions={[BASE]} onWithdraw={onWithdraw} onEdit={onEdit} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /A small study of light/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove this declined work from your list for good?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove this work' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('vsub_1'));
  });

  it('a live submitted work offers no Remove', () => {
    render(<MySubmissions submissions={[{ ...BASE, status: 'submitted' }]} onWithdraw={onWithdraw} onEdit={onEdit} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /A small study of light/ }));
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});
