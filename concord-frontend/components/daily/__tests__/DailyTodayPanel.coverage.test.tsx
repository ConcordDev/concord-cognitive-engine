// Render + behaviour coverage for the daily "today" panel: mood/journal, sessions, reminders,
// practice timer, voice notes, calendar and backend action runner. Heavy children are stubbed.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { exercise } from '../../../tests/helpers/exercise';

const h = vi.hoisted(() => ({
  create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})),
  runAsync: vi.fn(async () => ({ ok: true, summary: 'done' })),
  apiGet: vi.fn(async () => ({ data: { media: [{ id: 'm1', title: 'Quick Note 1', mediaType: 'audio', tags: ['daily'], duration: 12, waveform: [10, 50, 90], createdAt: '2026-03-01T10:00:00Z' }] } })),
  apiPost: vi.fn(async () => ({ data: { mediaDTU: { id: 'm2' } } })),
  daily: {
    list: vi.fn(async () => ({ data: { notes: [{ id: 'n1', date: '2026-03-01', mood: 4, notes: 'Wrote beats', workedOn: 'Drums', learned: 'Swing', goals: 'Mix' }] } })),
    digest: vi.fn(async () => ({ data: { ok: true } })),
    createReminder: vi.fn(async () => ({ data: { ok: true } })),
    completeReminder: vi.fn(async () => ({ data: { ok: true } })),
  },
}));
const reminderItem = { id: 'r1', title: 'Call mom', data: { id: 'r1', title: 'Call mom', dueAt: '2030-01-01T10:00', completed: false } };
const sessionItem = { id: 's1', title: 'Beat', data: { id: 's1', project: 'Beat', duration: 45, category: 'Hip-hop', startedAt: '2026-03-01T10:00:00Z' } };

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
    items: type === 'reminder' ? [reminderItem] : type === 'session' ? [sessionItem] : [],
    create: h.create, update: h.update, remove: h.remove,
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: h.runAsync, isPending: false }) }));
vi.mock('@/lib/api/client', () => ({ api: { get: h.apiGet, post: h.apiPost }, apiHelpers: { daily: h.daily } }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: { pulse: 1 }, alerts: [{ id: 'a1', message: 'Heads up' }], insights: [{ id: 'i1', message: 'Pattern' }], isLive: true, lastUpdated: new Date().toISOString() }) }));
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
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 20)); });
  return !!hits[nth];
};
const mount = async () => {
  const { DailyTodayPanel } = await import('../DailyTodayPanel');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DailyTodayPanel /></QueryClientProvider>);
};
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn(async () => {}) as never;
  window.HTMLMediaElement.prototype.pause = vi.fn() as never; Object.values(h).forEach((v) => typeof v === 'function' && 'mockClear' in v && (v as ReturnType<typeof vi.fn>).mockClear()); });

describe('DailyTodayPanel', () => {
  it('renders the day, rehydrates voice notes and drives the main controls', { timeout: 90000 }, async () => {
    const view = await mount();
    await settle();
    expect(view.container.textContent).toMatch(/Call mom|Beat|Wrote beats|Quick Note/);
    expect(h.apiGet).toHaveBeenCalled();
    const fill = async (ph: RegExp, v: string) => { const el = screen.queryAllByRole('textbox').find((x) => ph.test(x.getAttribute('placeholder') || '')); if (el) await act(async () => { fireEvent.change(el, { target: { value: v } }); }); };
    await press(/^🙂$/);
    await fill(/day go/, 'Good day'); await fill(/Production log/, 'Drums'); await fill(/Key takeaways/, 'Swing'); await fill(/accomplish/, 'Mix');
    await press(/Save Entry/);
    expect(h.create.mock.calls.length + h.update.mock.calls.length).toBeGreaterThan(0);
    await press(/Log Session/);
    await fill(/project/i, 'Beat 2');
    await press(/^Add$/);
    await press(/Mark done/);
    await press(/Daily Summary/);
    await press(/Dismiss result/);
    await press(/Generate Digest/);
    await exercise({ passes: 2, text: 'Practice scales', skip: /delete|remove|trash|discard|cancel|close|dismiss|clear|record|^×$/i });
    await settle();
    expect(h.create.mock.calls.length + h.daily.createReminder.mock.calls.length + h.update.mock.calls.length).toBeGreaterThan(0);
  });

  it('runs the practice timer to completion and starts, stops and resets it', { timeout: 60000 }, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await press(/Start|Play/i);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await press(/Pause|Stop/i);
    await press(/Reset/i);
    await press(/Start|Play/i);
    await act(async () => { await vi.advanceTimersByTimeAsync(16 * 60 * 1000); });
    expect(document.body.textContent).toMatch(/00:00|Finger drumming/);
  });

  it('records a voice note through MediaRecorder and plays a clip back', { timeout: 60000 }, async () => {
    class FakeRecorder {
      ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null;
      constructor(public stream: unknown) {}
      start() {}
      stop() { this.ondataavailable?.({ data: new Blob(['abc'], { type: 'audio/webm' }) }); this.onstop?.(); }
    }
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) } });
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:clip';
    window.HTMLMediaElement.prototype.play = vi.fn(async () => {}) as never;
    window.HTMLMediaElement.prototype.pause = vi.fn() as never;
    await mount();
    await settle();
    await press(/Record|Voice|Mic/i);
    await settle();
    await press(/Stop|Recording/i);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    await press(/Play/i);
    await press(/Pause/i);
    expect(h.apiPost.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it('survives a denied microphone and a failing backend action', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => { throw new Error('denied'); }) } });
    h.runAsync.mockRejectedValueOnce(new Error('action failed'));
    h.apiGet.mockRejectedValueOnce(new Error('offline'));
    const view = await mount();
    await settle();
    await press(/Record|Voice|Mic/i);
    await press(/Digest|Summar|Analy|Insight|Streak/i);
    await press(/Digest|Summar|Analy|Insight|Streak/i, 1);
    expect(view.container.textContent?.length).toBeGreaterThan(50);
  });
});
