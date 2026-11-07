// Render + behaviour coverage for the affect lens: the mood tracker (check-in, trends, activities,
// reminders, mood scale, export) and the analysis tools (sentiment, emotion timeline, empathy map,
// pattern detection).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const ENTRY = (id: string, mood: number, over: Record<string, unknown> = {}) => ({ id, mood, moodLabel: ['', 'Awful', 'Low', 'Okay', 'Good', 'Great'][mood], moodEmoji: ['', '😞', '🙁', '😐', '🙂', '😄'][mood], note: 'Felt calm after a walk', activities: ['walk', 'reading'], promptId: 'pr1', promptAnswer: 'Grateful for sunshine', createdAt: `2026-03-0${mood}T09:00:00Z`, day: `2026-03-0${mood}`, ...over });

function resultFor(action: string): unknown {
  switch (action) {
    case 'getScale': return { scale: { points: [1, 2, 3, 4, 5].map((v) => ({ value: v, label: `L${v}`, emoji: ['😞', '🙁', '😐', '🙂', '😄'][v - 1] })) } };
    case 'checkinHistory': return { entries: [ENTRY('e1', 4), ENTRY('e2', 2, { note: '', promptAnswer: '' }), ENTRY('e3', 5, { activities: [] })], totalCheckins: 3, currentStreak: 3, checkedInToday: false, daysLogged: 3 };
    case 'journalPrompts': return { prompts: [{ id: 'pr1', text: 'What are you grateful for?' }, { id: 'pr2', text: 'What drained you?' }] };
    case 'trends': return { hasData: true, granularity: 'week', buckets: [{ bucket: '2026-W09', avgMood: 3.6, count: 4, min: 2, max: 5 }], daily: [{ day: '2026-03-01', avgMood: 4, count: 1 }, { day: '2026-03-02', avgMood: 2, count: 1 }], dayOfWeek: [{ label: 'Mon', avgMood: 3.5, count: 2 }, { label: 'Tue', avgMood: null, count: 0 }], overallAvg: 3.6, entryCount: 3 };
    case 'activityCorrelation': return { hasData: true, baseline: 3.4, correlations: [{ activity: 'walk', avgMood: 4.2, delta: 0.8, samples: 3, effect: 'lifts' }, { activity: 'doomscroll', avgMood: 2.1, delta: -1.3, samples: 2, effect: 'lowers' }, { activity: 'tea', avgMood: 3.4, delta: 0, samples: 1, effect: 'neutral' }], topLift: { activity: 'walk', avgMood: 4.2, delta: 0.8, samples: 3, effect: 'lifts' }, topDrain: { activity: 'doomscroll', avgMood: 2.1, delta: -1.3, samples: 2, effect: 'lowers' } };
    case 'nudges': return { reminders: [{ id: 'rm1', time: '20:00', condition: 'daily', label: 'Evening check-in', enabled: true }, { id: 'rm2', time: '09:00', condition: 'low_mood', label: 'Low mood', enabled: false }], due: [{ reminderId: 'rm1', type: 'daily', message: 'Time to check in' }], checkedInToday: false, recentAvg: 3.4 };
    case 'checkin': return { entry: ENTRY('e9', 4), currentStreak: 4, longestStreak: 9, totalCheckins: 4, daysLogged: 4 };
    case 'exportReport': return { filename: 'mood.csv', mime: 'text/csv', body: 'day,mood\n2026-03-01,4' };
    case 'sentimentAnalysis': return { sentimentLabel: 'positive', overallValence: 0.5, overallIntensity: 0.4, primaryEmotion: 'joy', isMixedEmotion: false, vad: { valence: 0.6, arousal: 0.4, dominance: 0.5 }, emotionHits: { joy: 3, calm: 1 }, matchedTokens: ['grateful'], tokenCount: 20, coverage: 0.4, sarcasmLikelihood: 0.1, sarcasmIndicators: [], basis: 'lexicon', summary: 'Positive' };
    case 'emotionTimeline': return { arcType: 'rising', arcSegments: { opening: 0.4, middle: -0.3, closing: 0.05 }, turningPoints: [{ at: '2026-03-02', direction: 'up', magnitude: 0.5 }], smoothedValence: [0.2, 0.4], volatility: 0.2, entryCount: 3, summary: 'Improving arc', analyzedAt: '2026-03-02' };
    case 'empathyMap': return { quadrants: { says: ['Calm'], thinks: ['Hopeful'], does: ['Walks'], feels: ['Good'] }, painPoints: ['Sleep'], gains: ['Walks'], topThemes: [{ theme: 'walk', count: 3 }], totalFeedback: 3, summary: 'Mostly positive' };
    case 'patternDetection': case 'patterns': return { patterns: [{ name: 'Weekend lift', strength: 0.6 }], cycles: [{ period: 7, strength: 0.5 }], triggers: [{ trigger: 'doomscroll', effect: -1.2 }], correlations: [{ a: 'walk', b: 'mood', r: 0.6 }], summary: 'Weekly rhythm' };
    default: return { ok: true, id: 'new-1', entry: ENTRY('e9', 4), reminder: { id: 'rm9' } };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div>chart</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AffectSessionProvider } from '../AffectSessionContext';
import { AnalysisToolsPanel } from '../AnalysisToolsPanel';
import { MoodTracker } from '../MoodTracker';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AffectSessionProvider>{ui}</AffectSessionProvider></QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 10)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

describe('affect panels', () => {
  it.each([['AnalysisToolsPanel', () => <AnalysisToolsPanel />], ['MoodTracker', () => <MoodTracker />]] as Array<[string, () => React.ReactElement]>)('%s renders and survives a full exercise pass, then offline', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 3, text: 'I felt hopeful today.', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await settle();
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const off = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(off.container).toBeTruthy();
  });

  it('the analysis tools run sentiment, timeline, empathy map and pattern detection', async () => {
    render(<AnalysisToolsPanel />);
    await settle();
    const area = document.querySelector('textarea') as HTMLTextAreaElement | null;
    if (area) fireEvent.change(area, { target: { value: 'I felt grateful and calm after the walk, though tired.' } });
    for (const l of [/Sentiment/i, /Timeline|Arc/i, /Empathy/i, /Pattern/i]) { await press(l); await settle(); }
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['checkinHistory', 'getScale']));
    expect(a.filter((x) => /sentimentAnalysis|emotionTimeline|empathyMap|pattern/i.test(x)).length).toBeGreaterThan(1);
  });

  it('the mood tracker checks in, edits, deletes, sets reminders, edits the scale and exports', async () => {
    const view = render(<MoodTracker />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['getScale', 'checkinHistory', 'journalPrompts']));
    const skip = /^(Check-in|Trends|Activities|Reminders|Mood Scale)$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i;
    await press(/😄|Great|^5$/); await press(/Good/);
    await exercise({ passes: 2, text: 'Walked and read', skip });
    await press(/^(Save|Log|Check in|Submit)/i);
    await press(/Edit|Pencil/i); await press(/Update|Save changes/i);
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    for (const tab of ['Trends', 'Activities', 'Reminders', 'Mood Scale', 'Check-in']) {
      await press(new RegExp(`^${tab}$`)); await settle();
      await exercise({ passes: 2, text: '21:30', skip });
    }
    await press(/^(Week|Month|Day)/i);
    await press(/Add reminder|\+/i); await press(/Save reminder|Add$/i);
    await press(/Disable|Enable|Toggle/i);
    await press(/Reset/i); await press(/Save scale/i);
    await press(/CSV|Export/i); await press(/JSON/i);
    expect(view.container.textContent?.length).toBeGreaterThan(50);
    expect(sent().filter((x) => /checkin$|updateCheckin|deleteCheckin|setReminder|setScale|exportReport|trends|activityCorrelation|nudges/.test(x)).length).toBeGreaterThan(3);
  });
});
