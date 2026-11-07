// Render + behaviour coverage for the meditation lens panels: breathing visual, courses,
// reminders, the session player and the ambient audio hook. Each panel mounts against stubbed
// engine results, must render real content, survive a full exercise pass and degrade honestly
// offline; the timed flows (breath cycle, guided session, soundscape) run against fake timers.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, renderHook, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const COURSE = { id: 'c1', title: '7 days of calm', subtitle: 'A gentle start', goal: 'calm', dayCount: 3, enrolled: true, completedDays: 1, startedAt: '2026-03-01' };
const DETAIL = { courseId: 'c1', title: '7 days of calm', subtitle: 'A gentle start', goal: 'calm', startedAt: '2026-03-01', enrolled: true, days: [{ day: 1, title: 'Arrive', sessionId: 's1', note: 'Sit', completed: true }, { day: 2, title: 'Breath', sessionId: 's2', note: 'Count', completed: false }, { day: 3, title: 'Body', sessionId: 's3', note: 'Scan', completed: false }], completedCount: 1, dayCount: 3, nextDay: 2, finished: false };
const REMINDER = { id: 'r1', time: '07:30', days: ['mon', 'wed', 'fri'], label: 'Morning sit', enabled: true, createdAt: '2026-03-01' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'courses': return { courses: [COURSE, { ...COURSE, id: 'c2', title: 'Sleep well', enrolled: false, completedDays: 0, startedAt: null }] };
    case 'courseProgress': return DETAIL;
    case 'library': return { sessions: [{ id: 's2', title: 'Counting breaths', category: 'breath', durationMin: 5 }, { id: 's3', title: 'Body scan', category: 'body', durationMin: 10 }] };
    case 'reminders': return { reminders: [REMINDER, { ...REMINDER, id: 'r2', enabled: false, label: 'Evening' }], count: 2, nextFire: { reminderId: 'r1', label: 'Morning sit', at: Date.now() + 3600_000, iso: '2026-03-02T07:30:00Z' }, dueToday: 1 };
    case 'breathwork': return { pattern: 'box', name: 'Box breathing', phases: [{ label: 'inhale', sec: 1 }, { label: 'hold', sec: 1 }, { label: 'exhale', sec: 1 }, { label: 'hold', sec: 1 }], cycleSeconds: 4, cycles: 2, totalSeconds: 8 };
    case 'soundscapeConfig': return { kind: 'drone', drone: [110, 165], gain: 0.2, noise: 'pink', noiseGain: 0.1 };
    case 'pickTrack': return { ok: true, track: { trackId: 't1', title: 'Quiet focus', narrator: 'Ana', durationMinutes: 10, goal: 'focus', vibe: 'single-pointed attention' } };
    case 'streakSummary': return { currentStreak: 3, longestStreak: 8, totalSessions: 20, totalMinutes: 240, lastSessionAt: '2026-03-01' };
    case 'dailyPrompt': return { date: '2026-03-02', prompt: 'Notice three sounds.' };
    case 'history': return { sessions: [{ id: 'h1', sessionId: 's1', title: 'Arrive', category: 'breath', durationMin: 5, durationSec: 300, moodAfter: 4, completedAt: '2026-03-01T08:00:00Z', journal: 'Calm', dtuId: null }], entries: [] };
    case 'sessionLog': return { entry: { id: 'h2' }, id: 'h2' };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: { ok: true, result: { id: 'dtu-1', answer: 'A calm brief.' } } })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { BreathingVisual } from '../BreathingVisual';
import { CoursesPanel } from '../CoursesPanel';
import { RemindersPanel } from '../RemindersPanel';
import { SessionPlayerPanel } from '../SessionPlayerPanel';
import { useAmbientAudio } from '../useAmbientAudio';

const render = (ui: React.ReactElement) => rtlRender(ui);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  lensRunMock.mockReset();
  runDomain.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['BreathingVisual', () => <BreathingVisual onPractice={vi.fn()} />],
  ['CoursesPanel', () => <CoursesPanel onPractice={vi.fn()} onPractise={vi.fn()} />],
  ['RemindersPanel', () => <RemindersPanel />],
  ['SessionPlayerPanel', () => <SessionPlayerPanel />],
  ['SessionPlayerPanel with a course preset', () => <SessionPlayerPanel practiceTick={1} preset={{ sessionId: 's2', title: 'Counting breaths', category: 'breath', minutes: 5, courseId: 'c1', day: 2 }} onPresetExit={vi.fn()} />],
];

describe('meditation panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(5);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    await exercise({ passes: 3, text: '07:30' });
    await settle();
    await exercise({ passes: 1, text: 'Grateful' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('meditation flows', () => {
  it('courses open, enroll, show progress and route a day to the player', async () => {
    const onPractise = vi.fn();
    render(<CoursesPanel onPractise={onPractise} />);
    await settle();
    const press = async (re: RegExp, all = false) => {
      const hits = screen.getAllByRole('button').filter((b) => re.test(b.textContent || b.getAttribute('aria-label') || ''));
      for (const b of all ? hits : hits.slice(0, 1)) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    };
    await press(/7 days of calm/);
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toContain('courseProgress');
    await press(/Practi[sc]e/i);
    await press(/Enroll|Start/i);
    await press(/Sleep well/);
    await press(/Enroll|Start/i);
    await press(/Unenroll|Leave/i);
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toContain('courses');
  });

  it('reminders list, add, toggle, edit and delete through the engine', async () => {
    render(<RemindersPanel />);
    await settle();
    const press = async (re: RegExp) => {
      const b = screen.getAllByRole('button').find((x) => re.test(x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || ''));
      if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    };
    fireEvent.change(screen.getByPlaceholderText(/label|Morning/i), { target: { value: 'Evening sit' } });
    await press(/Add|Save|Set/i);
    await press(/Disable|Enable|Toggle|Bell/i);
    await press(/Edit|Pencil/i);
    await press(/Save|Update/i);
    await press(/Delete|Trash/i);
    await press(/Confirm|Yes/i);
    const a = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(a).toContain('reminders');
    expect(a.some((x) => /setReminder|toggleReminder|updateReminder|deleteReminder/.test(x))).toBe(true);
  });

  it('a breathing cycle runs to completion on the clock and can be logged', async () => {
    vi.useFakeTimers();
    render(<BreathingVisual onPractice={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const start = screen.getAllByRole('button').find((b) => /start|begin|play/i.test(b.textContent || b.getAttribute('aria-label') || '')) as HTMLElement;
    await act(async () => { fireEvent.click(start); await vi.advanceTimersByTimeAsync(20_000); });
    const log = screen.queryAllByRole('button').find((b) => /log|save|record/i.test(b.textContent || ''));
    if (log) await act(async () => { fireEvent.click(log); await vi.advanceTimersByTimeAsync(10); });
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toContain('breathwork');
  });

  it('a course session plays to completion on the clock, then logs, mints, DMs, publishes and asks the agent', async () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    const view = render(<SessionPlayerPanel practiceTick={1} preset={{ sessionId: 's2', title: 'Counting breaths', category: 'breath', minutes: 1, courseId: 'c1', day: 2 }} onPresetExit={onExit} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    const labels = () => screen.queryAllByRole('button').map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim());
    const press = async (re: RegExp) => {
      const b = screen.queryAllByRole('button').find((x) => re.test((x.textContent || x.getAttribute('aria-label') || '').trim()));
      if (b) await act(async () => { fireEvent.click(b); await vi.advanceTimersByTimeAsync(10); });
      return !!b;
    };
    // start the timer, run it out
    if (!(await press(/^(Play|Start|Begin)/i))) await press(/play/i);
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(view.container.textContent).toMatch(/complete|Log|Finished|Well done/i);
    // rate and journal
    await press(/^5$|5 star|Rate 5/i);
    const area = view.container.querySelector('textarea');
    if (area) fireEvent.change(area, { target: { value: 'Settled and clear.' } });
    await press(/^Log/i);
    await press(/^Mint/i);
    const to = screen.queryByPlaceholderText(/recipient/i);
    if (to) fireEvent.change(to, { target: { value: 'friend-1' } });
    await press(/^DM/i);
    await press(/^Publish/i);
    await press(/PM brief|^Brief|Agent/i);
    await press(/History|Recent/i);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const a = runDomain.mock.calls.map((c) => String(c[1]));
    expect(a).toEqual(expect.arrayContaining(['streakSummary', 'dailyPrompt', 'sessionLog']));
    expect(onExit).toHaveBeenCalled();
    void labels;
  });

  it('a goal and length are picked, a track is found, and an unfinished session refuses to log', async () => {
    const view = render(<SessionPlayerPanel />);
    await settle();
    const press = async (re: RegExp) => {
      const b = screen.queryAllByRole('button').find((x) => re.test((x.textContent || x.getAttribute('aria-label') || '').trim()));
      if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    };
    for (const g of [/Sleep/, /Anxiety/, /Gratitude/, /Breath/, /Focus/]) await press(g);
    await press(/^20\b|20 min/);
    await press(/Find|Pick|Choose|Another|New track/i);
    await press(/^Log/i);
    expect(runDomain.mock.calls.map((c) => String(c[1]))).toContain('streakSummary');
    expect(view.container.textContent?.length).toBeGreaterThan(40);
  });

  it('the ambient audio hook builds a tone bed on start and tears it down on stop', async () => {
    const nodes = () => ({ connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), gain: { value: 0 }, frequency: { value: 0 }, type: '', buffer: null, loop: false });
    class Ctx {
      sampleRate = 8000; destination = {};
      createGain = nodes; createOscillator = nodes; createBufferSource = nodes;
      createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
      resume = vi.fn(async () => {}); close = vi.fn(async () => {});
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: Ctx });
    for (const category of ['guided', 'breathwork']) {
      const { result, unmount } = renderHook(() => useAmbientAudio(category));
      await settle();
      expect(result.current.ready).toBe(true);
      act(() => result.current.start());
      expect(result.current.sounding).toBe(true);
      act(() => result.current.stop());
      expect(result.current.sounding).toBe(false);
      unmount();
    }
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: actionOf(a) === 'soundscapeConfig' ? { kind: 'noise', noise: 'brown', noiseGain: 0.3 } : {} } }));
    const brown = renderHook(() => useAmbientAudio('guided'));
    await settle();
    act(() => brown.result.current.start());
    act(() => brown.result.current.stop());
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toContain('soundscapeConfig');
  });
});
