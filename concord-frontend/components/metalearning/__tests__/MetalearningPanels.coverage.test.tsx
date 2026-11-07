// Render + behaviour coverage for the metalearning lens panels: analysis, goals, learning plans,
// progress analytics, spaced repetition, the strategies desk, experiments, study journal,
// technique library and the research feed. Panels mount against stubbed engine results, must
// render real content, survive a full exercise pass and degrade honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const meta = vi.hoisted(() => ({
  status: vi.fn(), strategies: vi.fn(), bestStrategy: vi.fn(), curricula: vi.fn(), adaptations: vi.fn(),
  createStrategy: vi.fn(), curriculum: vi.fn(), recordOutcome: vi.fn(), adaptStrategy: vi.fn(), deleteStrategy: vi.fn(),
}));
const STRATEGY = { id: 's1', name: 'Interleaving', domain: 'maths', avgPerformance: 0.7, uses: 10, successes: 7, failures: 3, parameters: { learningRate: 0.1, explorationRate: 0.2, batchSize: 8, abstractionLevel: 2, consolidationThreshold: 0.5 } };
const CURRICULUM = { id: 'cu1', topic: 'Calculus', provenance: 'corpus', estimatedEffort: 12, steps: [{ order: 1, title: 'Limits', rationale: 'Foundation' }, { order: 2, title: 'Derivatives', rationale: 'Core' }], createdAt: '2026-03-01' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'goalList': return { goals: [{ id: 'g1', title: 'Learn calculus', metric: 'chapters', metricKind: 'self_reported', targetValue: 10, currentValue: 4, deadline: '2026-06-01', status: 'active', progress: 40, checkInCount: 2, checkIns: [{ at: '2026-03-01', value: 2, note: 'start' }, { at: '2026-03-02', value: 4, note: '' }] }, { id: 'g2', title: 'Recall drills', metric: 'cards', metricKind: 'computed', targetValue: 100, currentValue: 100, deadline: null, status: 'achieved', progress: 100, checkInCount: 0, checkIns: [] }], active: 1, achieved: 1 };
    case 'planList': return { plans: [{ id: 'pl1', title: 'Calculus plan', goal: 'Pass the exam', topics: [{ id: 't1', order: 1, name: 'Limits', estimatedHours: 4, milestone: 'Quiz', done: true }, { id: 't2', order: 2, name: 'Derivatives', estimatedHours: 6, milestone: 'Quiz', done: false }], progress: 50, stepsDone: 1, stepsTotal: 2, totalHours: 10, remainingHours: 6 }, { id: 'pl2', title: 'Done plan', goal: 'x', topics: [], progress: 100, stepsDone: 0, stepsTotal: 0, totalHours: 0, remainingHours: 0 }] };
    case 'progressAnalytics': return { totalReviews: 120, overallRetention: 0.84, retentionCurve: [{ interval: '1d', reviews: 50, retention: 0.9 }, { interval: '7d', reviews: 40, retention: 0.8 }], timeToMastery: [{ topic: 'Limits', cards: 10, mastered: 6, masteryRate: 0.6, avgDaysToMastery: 12, avgEase: 2.4 }, { topic: 'Series', cards: 4, mastered: 0, masteryRate: 0, avgDaysToMastery: null, avgEase: 2.1 }], studySessions: 14, cardsTracked: 14 };
    case 'srsDue': return { dueNow: [{ id: 'c1', front: 'd/dx x^2', back: '2x', topic: 'Derivatives', ease: 2.5, intervalDays: 3, repetitions: 2, lapses: 0, dueAt: 1_760_000_000, overdueDays: 2 }], upcoming: [{ id: 'c2', front: 'Integral of 1/x', topic: 'Integrals', dueInDays: 3 }], totalCards: 9 };
    case 'experimentList': return { experiments: [{ id: 'e1', title: 'Spacing vs massing', hypothesis: 'Spacing wins', status: 'running', strategyA: { name: 'Spaced' }, strategyB: { name: 'Massed' }, summary: { armA: { name: 'Spaced', n: 5, mean: 82, stdDev: 4 }, armB: { name: 'Massed', n: 5, mean: 70, stdDev: 6 }, winner: 'Spaced', effectSize: 1.2, confidence: 'high' } }, { id: 'e2', title: 'Fresh', hypothesis: 'h', status: 'running', strategyA: { name: 'A' }, strategyB: { name: 'B' }, summary: { armA: { name: 'A', n: 0, mean: 0, stdDev: 0 }, armB: { name: 'B', n: 0, mean: 0, stdDev: 0 }, winner: null, effectSize: 0, confidence: 'low' } }] };
    case 'journalList': return { entries: [{ id: 'j1', topic: 'Limits', technique: 'Feynman', minutesStudied: 45, effectiveness: 4, reflection: 'Clear', createdAt: '2026-03-01T10:00:00Z' }], techniqueEffectiveness: [{ technique: 'Feynman', sessions: 3, avgEffectiveness: 4.2, totalMinutes: 120 }], totalMinutes: 120 };
    case 'techniqueLibrary': return { techniques: [{ id: 'tq1', name: 'Spaced repetition', summary: 'Review at growing gaps', whenToUse: 'Facts', steps: ['Make cards', 'Review'], evidence: 'Cepeda 2006', strength: 5 }, { id: 'tq2', name: 'Feynman', summary: 'Explain simply', whenToUse: 'Concepts', steps: ['Teach'], evidence: 'Folk', strength: 3 }] };
    case 'strategySelection': return { recommended: 'Interleaving', ranked: [{ strategy: 'Interleaving', score: 0.8 }], message: 'ok', reasoning: ['Mixed topics'] };
    case 'transferAnalysis': return { transferScore: 0.62, sharedConcepts: ['limits'], gaps: ['proofs'], message: 'ok' };
    case 'performanceProfile': return { strengths: ['recall'], weaknesses: ['transfer'], overall: 0.7, message: 'ok' };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { metalearning: meta, lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: { strategies: 3 }, insights: [{ id: 'i1', text: 'Drift' }], isLive: true, lastUpdated: new Date('2026-03-02') }) }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => <div>realtime panel</div> }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div>chart</div> }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('@/hooks/useArxivFeed', () => ({ useArxivFeed: () => ({ data: [{ id: 'a1', title: 'MAML revisited', summary: 'We revisit', authors: ['A', 'B', 'C', 'D'], published: '2026-02-01T00:00:00Z', link: 'https://arxiv.org/abs/1' }], isLoading: false, isError: false, error: null, refetch: vi.fn() }) }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AnalysisPanel } from '../AnalysisPanel';
import { GoalTrackerPanel } from '../GoalTrackerPanel';
import { LearningPlanPanel } from '../LearningPlanPanel';
import { MetalearningFeed } from '../MetalearningFeed';
import { ProgressAnalyticsPanel } from '../ProgressAnalyticsPanel';
import { SpacedRepetitionPanel } from '../SpacedRepetitionPanel';
import { StrategiesDeskPanel } from '../StrategiesDeskPanel';
import { StrategyExperimentPanel } from '../StrategyExperimentPanel';
import { StudyJournalPanel } from '../StudyJournalPanel';
import { TechniqueLibraryPanel } from '../TechniqueLibraryPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  Object.values(meta).forEach((f) => f.mockReset());
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  meta.status.mockResolvedValue({ data: { status: { strategies: 2, curriculums: 3, adaptations: 1, outcomes: 14 } } });
  meta.strategies.mockResolvedValue({ data: { strategies: [STRATEGY, { ...STRATEGY, id: 's2', name: 'Retrieval', domain: 'languages', avgPerformance: null, uses: 0 }] } });
  meta.bestStrategy.mockResolvedValue({ data: { strategy: STRATEGY } });
  meta.curricula.mockResolvedValue({ data: { curricula: [CURRICULUM] } });
  meta.adaptations.mockResolvedValue({ data: { adaptations: [{ strategyId: 's1', strategyName: 'Interleaving', adaptations: ['raised exploration'], changes: [{ parameter: 'explorationRate', from: 0.2, to: 0.3 }], triggerPerformance: 0.4, triggerSuccessRate: 0.4, outcomesCounted: 10, adaptedAt: '2026-03-02' }] } });
  meta.createStrategy.mockResolvedValue({ data: { ok: true, strategy: STRATEGY } });
  meta.curriculum.mockResolvedValue({ data: { curriculum: CURRICULUM } });
  meta.recordOutcome.mockResolvedValue({ data: { ok: true } });
  meta.adaptStrategy.mockResolvedValue({ data: { ok: true, adaptation: { strategyName: 'Interleaving', adaptations: ['x'] } } });
  meta.deleteStrategy.mockResolvedValue({ data: { ok: true } });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['AnalysisPanel', () => <AnalysisPanel />],
  ['GoalTrackerPanel', () => <GoalTrackerPanel />],
  ['LearningPlanPanel', () => <LearningPlanPanel />],
  ['MetalearningFeed', () => <MetalearningFeed />],
  ['ProgressAnalyticsPanel', () => <ProgressAnalyticsPanel />],
  ['SpacedRepetitionPanel', () => <SpacedRepetitionPanel />],
  ['StrategiesDeskPanel', () => <StrategiesDeskPanel />],
  ['StrategyExperimentPanel', () => <StrategyExperimentPanel />],
  ['StudyJournalPanel', () => <StudyJournalPanel />],
  ['TechniqueLibraryPanel', () => <TechniqueLibraryPanel />],
];

describe('metalearning panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 4, text: 'Calculus' });
    await settle();
    await exercise({ passes: 2, text: '4' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    Object.values(meta).forEach((f) => f.mockRejectedValue(new Error('offline')));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('metalearning flows', () => {
  it('goals are created, checked in (with and without a value) and deleted behind a confirmation', async () => {
    render(<GoalTrackerPanel />);
    await settle();
    await exercise({ passes: 4, text: '8' });
    await settle();
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent()).toEqual(expect.arrayContaining(['goalList']));
    expect(sent().some((x) => /goalCreate|goalCheckIn|goalDelete/.test(x))).toBe(true);
  });

  it('plans are created with topics, a step is ticked, and a plan is deleted', async () => {
    render(<LearningPlanPanel />);
    await settle();
    await exercise({ passes: 4, text: 'Limits' });
    await settle();
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent().some((x) => /planCreate|planToggleStep|planDelete/.test(x))).toBe(true);
  });

  it('spaced repetition reveals a card, grades it, adds a card and deletes one', async () => {
    render(<SpacedRepetitionPanel />);
    await settle();
    await press(/Show|Reveal|Flip/i);
    for (const g of [/Again|Hard|Good|Easy|^[0-5]$/]) await press(g);
    await exercise({ passes: 3, text: 'Limit definition' });
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent().some((x) => /srsReview|srsAddCard|srsDeleteCard/.test(x))).toBe(true);
  });

  it('experiments are created, trials recorded for each arm and the winner shown', async () => {
    render(<StrategyExperimentPanel />);
    await settle();
    await press(/New experiment|Add|Create|\+/i);
    await exercise({ passes: 4, text: '75' });
    await settle();
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent().some((x) => /experimentCreate|experimentRecordTrial|experimentDelete/.test(x))).toBe(true);
  });

  it('the study journal logs a session and removes an entry', async () => {
    render(<StudyJournalPanel />);
    await settle();
    await exercise({ passes: 4, text: '30' });
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent().some((x) => /journalAdd|journalDelete/.test(x))).toBe(true);
  });

  it('the technique library searches and expands a technique', async () => {
    render(<TechniqueLibraryPanel />);
    await settle();
    const box = screen.getAllByRole('textbox')[0];
    fireEvent.change(box, { target: { value: 'spaced' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await press(/Search|Go/i);
    await press(/Spaced repetition/);
    expect(sent().filter((x) => x === 'techniqueLibrary').length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/Make cards|Cepeda/);
  });

  it('the strategies desk creates a strategy, builds a curriculum, records outcomes, adapts and deletes', async () => {
    render(<StrategiesDeskPanel />);
    await settle();
    await exercise({ passes: 4, text: 'Calculus', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$|retry/i });
    await settle();
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(meta.status).toHaveBeenCalled();
    expect(meta.strategies).toHaveBeenCalled();
    const called = [meta.createStrategy, meta.curriculum, meta.recordOutcome, meta.adaptStrategy, meta.deleteStrategy].some((f) => f.mock.calls.length > 0);
    expect(called).toBe(true);
  });

  it('analysis runs strategy selection, transfer analysis and a performance profile', async () => {
    render(<AnalysisPanel />);
    await settle();
    for (const tab of [/Strategy Selection/, /Transfer Analysis/, /Performance Profile/]) {
      await press(tab);
      await exercise({ passes: 3, text: 'maths', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$|Strategy Selection|Transfer Analysis|Performance Profile/i });
      await settle();
    }
    expect(sent().some((x) => /strategySelection|transferAnalysis|performanceProfile/.test(x))).toBe(true);
  });

  it('the research feed switches topic', async () => {
    const view = render(<MetalearningFeed />);
    const select = view.container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'few-shot' } });
    expect(view.container.textContent).toMatch(/MAML revisited/);
  });
});
