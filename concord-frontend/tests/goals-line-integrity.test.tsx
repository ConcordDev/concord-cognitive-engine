// S2 — line integrity (Review 5 F2): the review's exact flow, run
// against the REAL components. The Steps field is the real
// DraftedTextarea over the real useLensDraft hook; only the network
// (lensRun drafts backend) and the lens-data store are mocked, both
// losslessly. Four lines typed must reach the store as four steps.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// In-memory drafts backend with exact JSON-string semantics.
const draftStore = vi.hoisted(() => new Map<string, string>());
const lensRunMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiHelpers: {},
}));

const stores = vi.hoisted(() => ({ goal: null as unknown as Record<string, unknown> }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => stores.goal,
}));
vi.mock('@/components/lens/KeepRecordActions', () => ({ KeepRecordActions: () => null }));
vi.mock('@/components/lens/recordKeep', () => ({ goalKeepRecord: () => null }));

import { GoalsListPanel } from '@/components/goals/GoalsListPanel';

// The panels use react-query mutations, so every render needs a client.
function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  draftStore.clear();
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string, input: Record<string, unknown>) => {
    if (domain === 'drafts' && action === 'load') {
      const raw = draftStore.get(`${input.lensId}:${input.draftKey}`);
      return { data: { ok: true, result: { ok: true, draft: raw === undefined ? null : { payload: JSON.parse(raw), schemaVersion: 1, createdAt: 1, updatedAt: 1 } } } };
    }
    if (domain === 'drafts' && action === 'save') {
      draftStore.set(`${input.lensId}:${input.draftKey}`, JSON.stringify(input.payload));
      return { data: { ok: true, result: { ok: true, savedAt: 1 } } };
    }
    if (domain === 'drafts' && action === 'delete') {
      draftStore.delete(`${input.lensId}:${input.draftKey}`);
      return { data: { ok: true, result: { ok: true } } };
    }
    return { data: { ok: true, result: {} } };
  });
  stores.goal = {
    items: [], total: 0, isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
  };
});

describe('line-structured input keeps its lines (F2)', () => {
  it('four step lines become four stored steps with exact labels', async () => {
    renderWithClient(<GoalsListPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'New goal' }));
    fireEvent.change(await screen.findByPlaceholderText('What do you want to achieve?'), { target: { value: 'Line test' } });
    const steps = await screen.findByPlaceholderText(/Steps, one per line/);
    fireEvent.change(steps, { target: { value: 'Step one\nStep two\nStep three\nStep four' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }));
    await waitFor(() => expect(stores.goal.create).toHaveBeenCalled());
    const [created] = (stores.goal.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created.data.subtasks.map((s: { label: string }) => s.label)).toEqual([
      'Step one', 'Step two', 'Step three', 'Step four',
    ]);
  });
});
