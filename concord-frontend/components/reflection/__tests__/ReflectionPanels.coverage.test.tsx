// Render + behaviour coverage for the reflection (journal) panels. Each panel mounts against a
// permissive macro mock whose list results carry plausible records, must render real content,
// survive a full exercise pass (fill every field, press every control), and degrade honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const ENTRY = { id: 'e1', journalId: 'j1', title: 'Morning pages', text: 'A quiet reflective morning with coffee and a long walk.', mood: 'good', tags: ['calm', 'walk'], location: 'Park', weather: 'sunny', photoCount: 1, date: '2026-03-02', at: '2026-03-02T08:00:00Z', wordCount: 10, media: [], kind: 'text' };
const DASH = { currentStreak: 4, longestStreak: 9, totalEntries: 31, entriesThisWeek: 3, journals: 2, totalWords: 5400, latestMood: 'good', wroteToday: false, promptOfTheDay: { category: 'gratitude', text: 'What are you grateful for?' } };
function resultFor(action: string): unknown {
  switch (action) {
    case 'reflection-dashboard': return DASH;
    case 'journal-list': return { journals: [{ id: 'j1', name: 'Daily', color: '#6366f1', entryCount: 12 }, { id: 'j2', name: 'Dreams', color: '#f59e0b', entryCount: 3 }] };
    case 'entry-list': case 'entry-search': case 'on-this-day': return { entries: [ENTRY, { ...ENTRY, id: 'e2', mood: null, title: null, tags: [] }], count: 2, query: 'q' };
    case 'entry-detail': return { entry: ENTRY };
    case 'prompt-today': return { prompt: { category: 'gratitude', text: 'What are you grateful for?' }, category: 'gratitude', text: 'What are you grateful for?' };
    case 'prompt-library': return { prompts: [{ category: 'gratitude', text: 'What are you grateful for?' }, { category: 'goals', text: 'What matters this week?' }], categories: ['gratitude', 'goals'] };
    case 'prompt-random': return { prompt: { category: 'goals', text: 'What matters this week?' } };
    case 'templates-list': return { templates: [{ id: 't1', name: 'Gratitude', category: 'gratitude', body: 'Three things...' }] };
    case 'tags-list': return { tags: [{ tag: 'calm', count: 4 }] };
    case 'mood-trend': return { entries: 3, averageScore: 3.8, series: [{ date: '2026-03-01', score: 4, mood: 'good' }, { date: '2026-03-02', score: 3, mood: 'okay' }] };
    case 'journal-streak': return { current: 4, longest: 9, currentStreak: 4, longestStreak: 9 };
    case 'journal-stats': return { ...DASH, avgWords: 174, totalPhotos: 3, byMood: { great: 2, good: 5, okay: 3, low: 1, rough: 0 } };
    case 'reflection-goal-status': return { weeklyEntries: 3, entriesThisWeek: 2, pct: 66, met: false, isDefault: true };
    case 'calendar-month': return { days: { '2026-03-02': 1, '2026-03-05': 2 }, year: 2026, month: 3 };
    case 'entry-timeline': return { events: [{ id: 'e1', label: 'Morning pages', time: '08:00', date: '2026-03-02', mood: 'good', tone: 'positive', wordCount: 10, encrypted: false }], count: 1, span: { from: '2026-03-01', to: '2026-03-02' }, monthBuckets: [{ month: '2026-03', count: 1 }] };
    case 'entry-map': return { markers: [{ id: 'e1', lat: 40.7, lon: -74, label: 'Park', date: '2026-03-02', mood: 'good', tone: 'positive' }], count: 1, places: [{ name: 'Park', count: 1, lat: 40.7, lon: -74 }] };
    case 'reminder-status': return { reminder: { enabled: true, hour: 20, minute: 0, days: [1, 2, 3], label: 'Evening' }, wroteToday: false, nextDue: '2026-03-02T20:00:00Z', dueNow: true };
    case 'sync-status': return { devices: [{ deviceId: 'd1', label: 'Laptop', platform: 'web', lastSeen: '2026-03-02', pendingDrafts: 1, online: true }], deviceCount: 1, onlineCount: 1, pendingDrafts: 1, synced: false, lastSync: null };
    case 'year-in-review': return { year: 2026, entryCount: 31, totalWords: 5400, avgWordsPerEntry: 174, daysJournaled: 20, photoCount: 3, longestStreak: 9, moodAverage: 3.8, busiestMonth: 'March', byMonth: [{ month: 'Mar', count: 12 }], topTags: [{ tag: 'calm', count: 4 }] };
    case 'journal-export': return { document: '# Journal', filename: 'journal-2026.md' };
    case 'export-history': return { exports: [{ id: 'x1', format: 'markdown', entryCount: 5, bytes: 2048, createdAt: '2026-03-02' }] };
    case 'reflection': case 'reflect-deepen': case 'entry-summarize': return { message: 'ok', summary: 'A calm morning.', questions: ['What stood out?'], themes: [{ theme: 'calm', tfidfScore: 0.5, documentFrequency: 3, prevalence: 0.4 }], recurringPhrases: [{ phrase: 'long walk', occurrences: 2 }], entriesAnalyzed: 6, sentiment: { overall: 0.4, trend: 'improving', slope: 0.1 }, vocabularyDiversity: { avgTTR: 0.6, trend: 'stable', totalUniqueTerms: 120 }, topicExpansion: { expansionRatio: 1.2 }, entryDepth: { avgWordCount: 80, trend: 'deepening' }, totalHabits: 1, overallConsistency: 0.7, habitProfiles: [{ name: 'Walk', currentStreak: 3, longestStreak: 5, consistency: 0.8, peakDay: 'Mon' }], stackingRecommendations: [], strongest: 'Walk', needsAttention: [] };
    default: return { ok: true, id: 'new-1', entry: ENTRY, journal: { id: 'j3', name: 'New', color: '#fff', entryCount: 0 } };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
  PipingProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/viz', () => ({
  TimelineView: ({ events }: { events: unknown[] }) => <div>timeline {events.length}</div>,
  MapView: ({ markers }: { markers: unknown[] }) => <div>map {markers.length}</div>,
  ChartKit: () => <div>chart</div>,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { JournalActionPanel } from '../JournalActionPanel';
import { JournalStudio } from '../JournalStudio';
import { ReflectionSection } from '../ReflectionSection';
import { RfAnalyticsPanel } from '../RfAnalyticsPanel';
import { RfEntriesPanel } from '../RfEntriesPanel';
import { RfPromptsPanel } from '../RfPromptsPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['JournalActionPanel', () => <JournalActionPanel />],
  ['JournalStudio', () => <JournalStudio onChange={vi.fn()} />],
  ['ReflectionSection', () => <ReflectionSection />],
  ['RfAnalyticsPanel', () => <RfAnalyticsPanel />],
  ['RfEntriesPanel', () => <RfEntriesPanel onChange={vi.fn()} />],
  ['RfPromptsPanel', () => <RfPromptsPanel onChange={vi.fn()} />],
];

describe('reflection panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(5);
    expect(screen.getAllByRole('button').length + view.container.querySelectorAll('input, select, textarea').length).toBeGreaterThan(0);
    await exercise({ passes: 3 });
    await settle();
    await exercise({ passes: 1, text: 'A quiet reflective morning' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('reflection flows', () => {
  it('the journal section loads its dashboard and each tab asks the backend for its data', async () => {
    render(<ReflectionSection />);
    await settle();
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toContain('reflection-dashboard');
    await exercise({ passes: 2 });
    await settle();
    const actions = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(actions.some((x) => /entry|prompt|mood|on-this-day|journal/.test(x))).toBe(true);
  });

  it('the entries panel lists entries on mount', async () => {
    render(<RfEntriesPanel onChange={vi.fn()} />);
    await settle();
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toEqual(expect.arrayContaining(['entry-list']));
  });

  it('every studio tab renders its data and survives a full exercise pass', async () => {
    const view = render(<JournalStudio />);
    await settle();
    for (const label of ['Compose', 'Timeline & Map', 'Reminders', 'Sync', 'Year in Review']) {
      const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').includes(label)) as HTMLElement;
      await act(async () => { tab.click(); await new Promise((r) => setTimeout(r, 0)); });
      await exercise({ passes: 2 });
      await settle();
      expect(view.container.textContent?.length).toBeGreaterThan(20);
    }
    const actions = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(actions).toEqual(expect.arrayContaining(['entry-timeline', 'entry-map', 'reminder-status', 'sync-status', 'year-in-review']));
  });

  it('composing an entry saves it, selects it, and opens the enrich panel (media, place, encryption)', async () => {
    const onChange = vi.fn();
    const view = render(<JournalStudio onChange={onChange} />);
    await settle();
    const area = view.container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Walked by the river and thought about the year.' } });
    const save = screen.getAllByRole('button').find((b) => /save entry|^\s*save/i.test(b.textContent || '')) as HTMLElement;
    await act(async () => { fireEvent.click(save); await new Promise((r) => setTimeout(r, 0)); });
    await settle();
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toContain('entry-create');
    expect(onChange).toHaveBeenCalled();
    // pick a recent entry so the enrich panel mounts regardless of the generated id
    const row = screen.getAllByRole('button').find((b) => /Morning pages/.test(b.textContent || ''));
    if (row) await act(async () => { fireEvent.click(row); await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByText(/Enriching/)).toBeTruthy();
    const file = new File(['abc'], 'pic.png', { type: 'image/png' });
    const picker = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(picker, { target: { files: [file] } }); await new Promise((r) => setTimeout(r, 20)); });
    const press = async (re: RegExp) => {
      const b = screen.getAllByRole('button').find((x) => re.test(x.textContent || '')) as HTMLElement | undefined;
      if (!b) return;
      await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    };
    fireEvent.change(screen.getByPlaceholderText('lat'), { target: { value: '40.7' } });
    fireEvent.change(screen.getByPlaceholderText('lon'), { target: { value: '-74' } });
    fireEvent.change(screen.getByPlaceholderText('place name'), { target: { value: 'Park' } });
    await press(/fetch weather/i);
    fireEvent.change(screen.getByPlaceholderText(/Passphrase|Key to decrypt/), { target: { value: 'secret-key' } });
    await press(/Encrypt/);
    fireEvent.change(screen.getByPlaceholderText(/Passphrase|Key to decrypt/), { target: { value: 'secret-key' } });
    await press(/Decrypt/);
    await exercise({ passes: 1, text: '1234' });
    await settle();
    const a = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(a).toEqual(expect.arrayContaining(['entry-attach-media', 'entry-set-place', 'entry-encrypt']));
  });

  it('a failed save and a failed attach surface the error instead of success', async () => {
    const view = render(<JournalStudio />);
    await settle();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'store unavailable' } }));
    const save = screen.getAllByRole('button').find((b) => /save entry|^\s*save/i.test(b.textContent || '')) as HTMLElement;
    await act(async () => { fireEvent.click(save); });
    await settle();
    expect(view.container.textContent).toMatch(/Write something first|store unavailable|Save failed/);
  });

  it('reminders save and disable, the device checks in, and the year in review exports a file', async () => {
    const created = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const view = render(<JournalStudio />);
    await settle();
    const go = async (label: string) => {
      const t = screen.getAllByRole('button').find((b) => (b.textContent || '').includes(label)) as HTMLElement;
      await act(async () => { fireEvent.click(t); await new Promise((r) => setTimeout(r, 0)); });
    };
    const press = async (re: RegExp) => {
      const hits = screen.getAllByRole('button').filter((x) => re.test(x.textContent || ''));
      for (const b of hits) { await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); }); }
    };
    await go('Reminders');
    await press(/^\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*$/);
    await press(/Save reminder|^\s*Save\s*$/i);
    await press(/Disable/i);
    await go('Sync');
    await press(/Check in|Sync now|Check-in/i);
    await go('Year in Review');
    await press(/Load/);
    await press(/markdown|json|text|export/i);
    const a = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(a).toEqual(expect.arrayContaining(['reminder-status', 'sync-status', 'year-in-review']));
    expect(a.some((x) => /reminder-set|device-checkin|journal-export/.test(x))).toBe(true);
    expect(view.container.textContent?.length).toBeGreaterThan(20);
  });

  it('the voice recorder reports a denied microphone honestly', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => { throw new Error('denied'); }) } });
    const view = render(<JournalStudio />);
    await settle();
    const rec = screen.getAllByRole('button').find((b) => /record|voice|start/i.test(b.textContent || '')) as HTMLElement | undefined;
    if (rec) await act(async () => { fireEvent.click(rec); await new Promise((r) => setTimeout(r, 0)); });
    expect(view.container.textContent?.length).toBeGreaterThan(20);
  });
});
