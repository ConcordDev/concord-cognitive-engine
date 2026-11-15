// FIX-daily-003 — Today form validation: Save Entry stayed enabled on an
// empty journal (a silent no-op click), and Session Log accepted a
// 300-character project name and -1 minutes (stored verbatim). Pins the
// disabled states, the length cap, and the duration range.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})),
  runAsync: vi.fn(async () => ({ ok: true, summary: 'done' })),
  apiGet: vi.fn(async () => ({ data: { media: [] } })),
  apiPost: vi.fn(async () => ({ data: { mediaDTU: { id: 'm2' } } })),
  daily: {
    list: vi.fn(async () => ({ data: { notes: [] } })),
    digest: vi.fn(async () => ({ data: { ok: true } })),
    createReminder: vi.fn(async () => ({ data: { ok: true } })),
    completeReminder: vi.fn(async () => ({ data: { ok: true } })),
  },
}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
    items: [],
    create: h.create, update: h.update, remove: h.remove,
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: h.runAsync, isPending: false }) }));
vi.mock('@/lib/api/client', () => ({ api: { get: h.apiGet, post: h.apiPost }, apiHelpers: { daily: h.daily } }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', timeZone: 'UTC' } }) }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: (p: Record<string, unknown>) => <textarea aria-label={String(p.placeholder || 'draft')} defaultValue={String(p.initial ?? '')} onChange={(e) => (p.onValueChange as (v: string) => void)?.(e.target.value)} placeholder={String(p.placeholder || '')} /> }));
vi.mock('@/components/daily/QuotablePanel', () => ({ QuotablePanel: () => <span>quotable-stub</span> }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => <span>feed-stub</span> }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => <span>live-stub</span> }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => <span>export-stub</span> }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => <span>realtime-stub</span> }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => <div onClick={p.onClick as React.MouseEventHandler}>{children}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const mount = async () => {
  const { DailyTodayPanel } = await import('../DailyTodayPanel');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DailyTodayPanel /></QueryClientProvider>);
};
afterEach(() => { cleanup(); });
beforeEach(() => { Object.values(h).forEach((v) => { if (typeof v === 'function' && 'mockClear' in v) (v as ReturnType<typeof vi.fn>).mockClear(); }); });

describe('DailyTodayPanel validation (FIX-daily-003)', () => {
  it('Save Entry is disabled while the journal is empty and enables on text', { timeout: 90000 }, async () => {
    await mount();
    await settle();
    const save = screen.getByRole('button', { name: 'Save Entry' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('How did your day go?'), { target: { value: 'Shipped the fix' } });
    await settle();
    expect((screen.getByRole('button', { name: 'Save Entry' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Session Log: Add gates on project + duration range; project is length-capped', { timeout: 90000 }, async () => {
    await mount();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Log Session/ }));
    await settle();
    const add = () => screen.getAllByRole('button', { name: 'Add' }).find((b) => b.classList.contains('w-full')) as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    // The framer-motion stub remounts subtrees between renders, so inputs
    // are re-queried after every change (the coverage suite's convention).
    const project = () => screen.getByPlaceholderText('Project name...') as HTMLInputElement;
    const minutes = () => screen.getByPlaceholderText('Minutes') as HTMLInputElement;
    expect(project().maxLength).toBe(120);
    fireEvent.change(project(), { target: { value: 'Mixing' } });
    await settle();
    expect(add().disabled).toBe(false);
    fireEvent.change(minutes(), { target: { value: '-1' } });
    await settle();
    expect(add().disabled).toBe(true);
    expect(minutes().getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(minutes(), { target: { value: '45' } });
    await settle();
    expect(add().disabled).toBe(false);
    expect(minutes().getAttribute('aria-invalid')).toBe('false');
  });
});
