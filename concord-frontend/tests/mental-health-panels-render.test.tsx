/**
 * /lenses/mental-health — render tests for the four panels the
 * full-lens build changed (GB-1252 diff-coverage gate: changed files
 * must clear 60%).
 *
 * MhMoodPanel (S-MH-3 trend label), MhPracticePanel (S-MH-2 breathing
 * player), MhCompanionPanel (F5 in-tab 988 pointer),
 * MentalHealthActionPanel (S-MH-1 tracked Mood/Journal tiles).
 *
 * Every state is driven by a mocked lensRun standing in for the real
 * backend, in exactly the shapes server/domains/mentalhealth.js
 * returns. No fabricated product behaviour: the assertions are the
 * pass findings' own fixtures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend mock — the panels' single channel ────────────────────────
const lensRun = vi.fn();
const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(async () => ({ data: { ok: true, message: { id: 'msg_1' } } })), delete: vi.fn(async () => ({ data: { ok: true } })) },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) } },
}));

vi.mock('@/components/ui', () => ({
  ErrorState: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div role="alert">{message}<button type="button" onClick={onRetry}>Retry</button></div>
  ),
}));

vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));

vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (input: unknown) => input,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import { MhMoodPanel } from '@/components/mental-health/MhMoodPanel';
import { MhPracticePanel } from '@/components/mental-health/MhPracticePanel';
import { MhCompanionPanel } from '@/components/mental-health/MhCompanionPanel';
import { MentalHealthActionPanel } from '@/components/mental-health/MentalHealthActionPanel';

const env = (result: unknown) => ({ data: { ok: true, result } });
const PATTERNS = [
  { id: 'box', name: 'Box breathing', inhale: 4, hold1: 4, exhale: 4, hold2: 4, use: 'Calm under acute stress' },
  { id: '478', name: '4-7-8 breathing', inhale: 4, hold1: 7, exhale: 8, hold2: 0, use: 'Falling asleep' },
];

beforeEach(() => {
  lensRun.mockReset(); runDomain.mockReset();
  // jsdom has no scrollTo — MhCompanionPanel's autoscroll effect calls it.
  Element.prototype.scrollTo = () => {};
});
afterEach(() => { vi.useRealTimers(); });

// ── MhMoodPanel ──────────────────────────────────────────────────────
describe('MhMoodPanel — S-MH-3 trend honesty', () => {
  it('a single check-in renders "Not enough data yet", never "Stable"', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mood-history') return env({ series: [{ id: 'm1', mood: 3, energy: null, label: null, note: null, date: '2026-11-04' }], count: 1 });
      if (action === 'mood-insights') return env({ entries: 1, average: 3, trend: 'not-enough-data', distribution: { 3: 1 } });
      return env({});
    });
    render(<MhMoodPanel onChange={() => {}} />);
    expect(await screen.findByText('Not enough data yet')).toBeTruthy();
    expect(screen.queryByText('Stable')).toBeNull();
    expect(screen.getByText('Check-ins')).toBeTruthy();
  });

  it('a computed trend renders its label and the series chart placeholder for one point', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'mood-history') return env({ series: [
        { id: 'm1', mood: 2, energy: null, label: null, note: null, date: '2026-11-01' },
        { id: 'm2', mood: 5, energy: null, label: null, note: null, date: '2026-11-04' },
      ], count: 2 });
      if (action === 'mood-insights') return env({ entries: 4, average: 3.5, trend: 'improving', distribution: { 2: 2, 5: 2 } });
      return env({});
    });
    render(<MhMoodPanel onChange={() => {}} />);
    expect(await screen.findByText('Improving')).toBeTruthy();
    expect(screen.getByText('Avg mood')).toBeTruthy();
  });

  it('checking in posts mood-log and refreshes', async () => {
    const calls: string[] = [];
    lensRun.mockImplementation(async (_d: string, action: string) => {
      calls.push(action);
      if (action === 'mood-history') return env({ series: [], count: 0 });
      if (action === 'mood-insights') return env({ entries: 0, average: null, trend: 'no_data', distribution: {} });
      return env({ entry: { id: 'm9' } });
    });
    render(<MhMoodPanel onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(calls).toContain('mood-log'));
  });

  it('a failed load shows the error state with retry', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'STATE unavailable' } });
    render(<MhMoodPanel onChange={() => {}} />);
    expect(await screen.findByText('STATE unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

// ── MhPracticePanel ──────────────────────────────────────────────────
describe('MhPracticePanel — S-MH-2 breathing player', () => {
  const practiceBackend = (calls: { action: string; input?: Record<string, unknown> }[]) => async (_d: string, action: string, input?: Record<string, unknown>) => {
    calls.push({ action, input });
    if (action === 'session-history') return env({ sessions: [{ id: 's1', type: 'meditation', durationMin: 10, title: null, date: '2026-11-04' }], count: 1 });
    if (action === 'course-list') return env({ courses: [{ id: 'c1', name: 'Basics', category: 'mindfulness', totalSessions: 10, completedSessions: 3, progressPct: 30, complete: false }] });
    if (action === 'breathing-patterns') return env({ patterns: PATTERNS });
    return env({ entry: { id: 'x1' } });
  };

  it('renders patterns, sessions and course progress from the store', async () => {
    const calls: { action: string }[] = [];
    lensRun.mockImplementation(practiceBackend(calls));
    render(<MhPracticePanel onChange={() => {}} />);
    expect(await screen.findByText('Box breathing')).toBeTruthy();
    expect(screen.getByText('4-7-8 breathing')).toBeTruthy();
    expect(screen.getByText('Basics')).toBeTruthy();
    expect(screen.getByText('Recent sessions')).toBeTruthy();
  });

  it('the player steps phases on a timer and Stop logs only completed rounds', async () => {
    vi.useFakeTimers();
    const calls: { action: string; input?: Record<string, unknown> }[] = [];
    lensRun.mockImplementation(practiceBackend(calls));
    render(<MhPracticePanel onChange={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByRole('button', { name: 'Breathe 6 rounds' })[0]);
    expect(screen.getByText('Breathe in')).toBeTruthy();
    expect(screen.getByText(/Round 1 of 6/)).toBeTruthy();
    // one full box round = 16s of phases; step second-by-second with
    // async flushes — React's scheduler drains between fake-timer ticks
    for (let i = 0; i < 17; i++) { await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); }
    expect(screen.getByText(/Round 2 of 6/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => { await Promise.resolve(); });
    const log = calls.find((c) => c.action === 'breathing-log');
    expect(log?.input).toEqual({ patternId: 'box', rounds: 1 });
    expect(screen.getByText(/1 completed round logged/)).toBeTruthy();
  });

  it('logging a session and creating a course hit their verbs; an empty course name errors', async () => {
    const calls: { action: string }[] = [];
    lensRun.mockImplementation(practiceBackend(calls));
    render(<MhPracticePanel onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Log$/ }));
    await waitFor(() => expect(calls.map((c) => c.action)).toContain('session-log'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Course name is required.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/New course/), { target: { value: 'Foundations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.map((c) => c.action)).toContain('course-create'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete next session' }));
    await waitFor(() => expect(calls.map((c) => c.action)).toContain('course-complete-session'));
  });
});

// ── MhCompanionPanel ─────────────────────────────────────────────────
describe('MhCompanionPanel — F5 crisis pointer', () => {
  it('the 988 pointer is visible with no risk flag and no turns', async () => {
    lensRun.mockResolvedValue(env({ turns: [] }));
    render(<MhCompanionPanel />);
    expect(await screen.findByText(/In crisis\? Call or text/)).toBeTruthy();
    expect(screen.getByText(/quiet space to put feelings into words/)).toBeTruthy();
    expect(screen.getByText(/not a therapist and not medical advice/)).toBeTruthy();
  });

  it('a risk-flagged turn raises the crisis banner; sending posts companion-chat', async () => {
    const calls: string[] = [];
    lensRun.mockImplementation(async (_d: string, action: string) => {
      calls.push(action);
      if (action === 'companion-history') return env({ turns: [
        { role: 'user', content: 'rough night', at: '2026-11-04T01:00:00Z' },
        { role: 'assistant', content: 'I hear you.', at: '2026-11-04T01:00:05Z', riskFlag: true },
      ] });
      return env({});
    });
    render(<MhCompanionPanel />);
    expect(await screen.findByText(/call or text/)).toBeTruthy();
    expect(screen.getByText('rough night')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('How are you feeling?'), { target: { value: 'a bit better' } });
    fireEvent.click(screen.getByRole('button', { name: '' }));
    await waitFor(() => expect(calls).toContain('companion-chat'));
  });
});

// ── MentalHealthActionPanel ──────────────────────────────────────────
describe('MentalHealthActionPanel — S-MH-1 tracked tiles', () => {
  const macroBackend = async (_d: string, action: string) => {
    if (action === 'mood-insights') return { data: { ok: true, result: { entries: 3, average: 3.7, trend: 'not-enough-data', distribution: { 3: 1, 4: 2 } } } };
    if (action === 'gratitude-list') return { data: { ok: true, result: { entries: [{ id: 'g1', items: ['morning light', 'a call with Sam'], date: '2026-11-03' }], count: 1 } } };
    if (action === 'journalPrompt') return { data: { ok: true, result: { mood: 'neutral', prompts: ['What is one small thing that went right today?'], instruction: 'Write for five minutes.', reminder: 'No judgement.' } } };
    if (action === 'crisis-hotlines') return { data: { ok: true, result: { country: 'US', available: true, hotlines: { primary: { name: '988 Suicide & Crisis Lifeline', phone: '988' } }, disclaimer: 'Free, 24/7.' } } };
    return { data: { ok: true, result: {} } };
  };

  it('the tracked mood card renders from mood-insights on mount — no CSV typed', async () => {
    runDomain.mockImplementation(macroBackend);
    render(<MentalHealthActionPanel />);
    expect(await screen.findByText('Your mood · tracked check-ins')).toBeTruthy();
    expect(screen.getByText(/3 check-ins · trend not-enough-data/)).toBeTruthy();
  });

  it('the Mood tile with an empty CSV reads tracked check-ins instead of refusing', async () => {
    runDomain.mockImplementation(macroBackend);
    render(<MentalHealthActionPanel />);
    await screen.findByText('Your mood · tracked check-ins');
    fireEvent.click(screen.getByRole('button', { name: /Mood/ }));
    expect(await screen.findByText(/3 tracked check-ins — avg 3.7\/5/)).toBeTruthy();
    expect(screen.queryByText(/csv required/i)).toBeNull();
  });

  it('the Journal tile renders prompts AND the member\u2019s recent entries', async () => {
    runDomain.mockImplementation(macroBackend);
    render(<MentalHealthActionPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Journal/ }));
    expect(await screen.findByText(/What is one small thing that went right today\?/)).toBeTruthy();
    expect(await screen.findByText('Your recent journal entries')).toBeTruthy();
    expect(screen.getByText(/morning light · a call with Sam/)).toBeTruthy();
  });

  it('the Hotlines tile renders the crisis directory', async () => {
    runDomain.mockImplementation(macroBackend);
    render(<MentalHealthActionPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Hotlines/ }));
    expect(await screen.findByText(/988 Suicide & Crisis Lifeline/)).toBeTruthy();
  });
});

describe('MentalHealthActionPanel — remaining tiles (stats / mint / DM / publish / agent)', () => {
  const backend = async (arg1: unknown, arg2?: string) => {
    // object-form lensRun calls (dtu create, chat_agent)
    if (arg1 && typeof arg1 === 'object') {
      const o = arg1 as { domain?: string; name?: string };
      if (o.domain === 'dtu') return { data: { result: { dtu: { id: 'dtu_abcdef123456' } } } };
      if (o.domain === 'chat_agent') return { data: { result: { answer: 'Take a ten-minute walk around the block.' } } };
      return { data: { result: {} } };
    }
    void arg2;
    return { data: { result: {} } };
  };
  const macro = async (_d: string, action: string) => {
    if (action === 'mood-insights') return { data: { ok: true, result: { entries: 0, average: null, trend: 'no_data', distribution: {} } } };
    if (action === 'gratitude-list') return { data: { ok: true, result: { entries: [], count: 0 } } };
    if (action === 'cdc-mental-health-stats') return { data: { ok: true, result: { year: 2023, stateAbbr: 'NY', count: 2, measures: [
      { measure: 'Frequent mental distress', value: 13.2, confidenceLow: 12.1, confidenceHigh: 14.3 },
      { measure: 'Depression prevalence', value: 19.8, confidenceLow: 18.4, confidenceHigh: 21.2 },
    ] } } };
    return { data: { ok: true, result: {} } };
  };

  it('CDC stats requires year+state, then renders measures; publish + mint + DM + agent all complete', async () => {
    lensRun.mockImplementation(backend);
    runDomain.mockImplementation(macro);
    render(<MentalHealthActionPanel />);
    // stats validation error first
    fireEvent.click(await screen.findByRole('button', { name: /CDC stats/ }));
    expect(await screen.findByText('Year + state abbr required.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('State (CA, US)'), { target: { value: 'NY' } });
    fireEvent.change(screen.getByPlaceholderText('Year'), { target: { value: '2023' } });
    fireEvent.click(screen.getByRole('button', { name: /CDC stats/ }));
    expect(await screen.findByText('Frequent mental distress')).toBeTruthy();
    expect(screen.getByText('13.2%')).toBeTruthy();
    // publish the stats card — FIX-mental-health-004: the first click
    // arms the public-action confirmation, the second publishes
    fireEvent.click(screen.getByRole('button', { name: /Publish/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm publish/ }));
    expect(await screen.findByText(/Published dtu_abcd/)).toBeTruthy();
    // mint a private wellness DTU
    fireEvent.click(screen.getByRole('button', { name: /Mint/ }));
    expect(await screen.findByText(/Wellness DTU dtu_abcd/)).toBeTruthy();
    // DM a wellness check
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'user_42' } });
    fireEvent.click(screen.getByRole('button', { name: /DM/ }));
    expect(await screen.findByText('Sent. 60s to recall.')).toBeTruthy();
    // agent action
    fireEvent.click(screen.getByRole('button', { name: /Action/ }));
    expect(await screen.findByText(/Take a ten-minute walk around the block\./)).toBeTruthy();
  });

  it('DM without a recipient errors instead of sending', async () => {
    lensRun.mockImplementation(backend);
    runDomain.mockImplementation(macro);
    render(<MentalHealthActionPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /DM/ }));
    expect(await screen.findByText('Recipient required.')).toBeTruthy();
  });
});
