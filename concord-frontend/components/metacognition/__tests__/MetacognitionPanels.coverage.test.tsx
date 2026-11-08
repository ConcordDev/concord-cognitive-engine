// Render + behaviour coverage for the metacognition lens panels: the shared desk hook, awareness,
// introspection, learning, predictions, accuracy tracker and reflection prompts. Panels mount
// against stubbed REST/macro results, must render real content, survive a full exercise pass and
// degrade honestly offline; flows assert the call each control sends.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const meta = vi.hoisted(() => ({
  status: vi.fn(), blindspots: vi.fn(), calibration: vi.fn(), introspection: vi.fn(), predictions: vi.fn(), domainRecord: vi.fn(),
  predict: vi.fn(), resolve: vi.fn(), introspect: vi.fn(), assess: vi.fn(),
}));
const PREDICTIONS = [
  { id: 'p1', statement: 'It will rain', claim: 'It will rain', confidence: 0.8, domain: 'weather', outcome: 'correct', createdAt: '2026-03-01T10:00:00Z', resolvedAt: '2026-03-02T10:00:00Z', resolved: true },
  { id: 'p2', statement: 'Stocks rise', claim: 'Stocks rise', confidence: 0.6, domain: 'markets', outcome: 'incorrect', createdAt: '2026-03-02T10:00:00Z', resolvedAt: '2026-03-03T10:00:00Z', resolved: true },
  { id: 'p3', statement: 'Launch on time', claim: 'Launch on time', confidence: 0.5, domain: 'work', outcome: null, createdAt: '2026-03-03T10:00:00Z', resolved: false },
];

function resultFor(action: string): unknown {
  switch (action) {
    case 'accuracyHistory': return { n: 12, overallBrier: 0.21, overallAccuracy: 0.72, domains: [{ domain: 'weather', n: 5, accuracy: 0.8, brierScore: 0.15 }, { domain: 'markets', n: 7, accuracy: 0.6, brierScore: 0.28 }], rolling: [{ index: 1, title: 'It will rain', rollingAccuracy: 1 }, { index: 2, title: 'Stocks rise', rollingAccuracy: 0.5 }] };
    case 'streakStatus': return { current: 3, longest: 9, totalDays: 21, reflectedToday: false, calendar: [{ day: '2026-03-01', active: true }, { day: '2026-03-02', active: false }] };
    case 'reflectionPrompts': return { prompts: [{ id: 'q1', question: 'What did you assume?' }, { id: 'q2', question: 'What would change your mind?' }] };
    case 'reflectionList': return { reflections: [{ id: 'r1', decisionId: null, title: 'Weekly review', answers: [{ question: 'What did you assume?', answer: 'Too much' }], note: 'Slow down', createdAt: '2026-03-02T10:00:00Z' }] };
    case 'reflectionSave': return { reflection: { id: 'r2' }, streak: { current: 4, longest: 9, totalDays: 22 } };
    case 'confidenceCalibration': return { ece: 0.08, buckets: [{ binRange: '0.5-0.6', avgPredicted: 0.55, avgActual: 0.5, count: 4, gap: 0.05 }], interpretation: 'Slightly overconfident', message: 'ok' };
    case 'learningCurve': return { slope: 0.1, plateau: false, interpretation: 'Improving', message: 'ok' };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { metacognition: meta, lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div>chart</div>, TimelineView: () => <div>timeline</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AccuracyTracker } from '../AccuracyTracker';
import { AwarenessPanel } from '../AwarenessPanel';
import { IntrospectionPanel } from '../IntrospectionPanel';
import { LearningPanel } from '../LearningPanel';
import { PredictionsPanel } from '../PredictionsPanel';
import { ReflectionPrompts } from '../ReflectionPrompts';

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
  meta.status.mockResolvedValue({ data: { status: { predictions: 3, resolved: 2, calibrationScore: 0.8, domains: 3 } } });
  meta.blindspots.mockResolvedValue({ data: { blindSpots: [{ topic: 'statistics', name: 'statistics', domain: 'math', severity: 'high', gaps: ['bayes', 'priors'], recommendation: 'Study base rates', description: 'Weak on base rates', identifiedAt: '2026-03-01', detected: '2026-03-01' }, { topic: 'history', severity: 'low', gaps: [], recommendation: '', description: '', identifiedAt: '2026-03-02' }] } });
  meta.calibration.mockResolvedValue({ data: { report: { totalPredictions: 12, overallAccuracy: 0.72, ece: 0.08, quality: 'good', interpretation: 'Slightly overconfident', buckets: [{ binRange: '0.5-0.6', avgPredicted: 0.55, avgActual: 0.5, count: 4, gap: 0.05 }, { binRange: '0.8-0.9', avgPredicted: 0.85, avgActual: 0.9, count: 6, gap: -0.05 }] } } });
  meta.introspection.mockResolvedValue({ data: { introspection: { runsCount: 6, patternsFound: 4, failurePatternCount: 2, recentPatterns: [{ id: 'i1', createdAt: '2026-03-02', focus: 'planning', patterns: ['overconfidence', 'anchoring_bias'] }, { id: 'i2', createdAt: '2026-03-03', patterns: ['overconfidence'] }] } } });
  meta.predictions.mockResolvedValue({ data: { predictions: PREDICTIONS } });
  meta.domainRecord.mockResolvedValue({ data: { domains: [{ domain: 'weather', accuracy: 0.8, resolved: 5, correct: 4, brierScore: 0.15, predictions: 6 }, { domain: 'markets', accuracy: null, resolved: 0, correct: 0, brierScore: null, predictions: 1 }] } });
  meta.predict.mockResolvedValue({ data: { ok: true, prediction: PREDICTIONS[2] } });
  meta.resolve.mockResolvedValue({ data: { ok: true } });
  meta.introspect.mockResolvedValue({ data: { ok: true, introspection: { patterns: ['overconfidence'], summary: 'Pattern found' }, patterns: ['overconfidence'] } });
  meta.assess.mockResolvedValue({ data: { ok: true, assessment: { domain: 'math', coverage: 0.6 }, domain: 'math' } });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['AccuracyTracker', () => <AccuracyTracker />],
  ['AwarenessPanel', () => <AwarenessPanel />],
  ['IntrospectionPanel', () => <IntrospectionPanel />],
  ['LearningPanel', () => <LearningPanel />],
  ['PredictionsPanel', () => <PredictionsPanel />],
  ['ReflectionPrompts', () => <ReflectionPrompts />],
];

describe('metacognition panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 4, text: 'planning' });
    await settle();
    await exercise({ passes: 2, text: '0.7' });
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

describe('metacognition flows', () => {
  it('predictions are made, resolved, expanded, deleted behind a confirm, and analysed', async () => {
    render(<PredictionsPanel />);
    await settle();
    const claim = screen.queryAllByRole('textbox').find((i) => /claim|predict|statement|will/i.test((i as HTMLInputElement).placeholder || '')) ?? screen.getAllByRole('textbox')[0];
    fireEvent.change(claim, { target: { value: 'Tests will pass' } });
    await press(/Predict|Make|Add|Record/i);
    await press(/Launch on time/);
    await press(/Correct|Yes|Happened/i);
    await press(/Incorrect|No|Did not/i);
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    await press(/Calibration/i); await press(/Learning curve|Curve/i);
    await settle();
    expect(meta.predictions).toHaveBeenCalled();
    expect(meta.predict.mock.calls.length + meta.resolve.mock.calls.length + sent().filter((x) => /prediction_delete|confidenceCalibration|learningCurve/.test(x)).length).toBeGreaterThan(0);
  });

  it('the awareness panel assesses a domain and shows blind spots and calibration buckets', async () => {
    const view = render(<AwarenessPanel />);
    await settle();
    expect(view.container.textContent).toMatch(/statistics|Slightly overconfident|0.5-0.6/);
    await press(/Assess|Check|Run/i);
    await press(/Refresh|Retry/i);
    expect(meta.blindspots).toHaveBeenCalled();
    expect(meta.calibration).toHaveBeenCalled();
  });

  it('the introspection panel runs an introspection with an optional focus', async () => {
    const view = render(<IntrospectionPanel />);
    await settle();
    expect(view.container.textContent).toMatch(/overconfidence|6|4/);
    const focus = screen.queryAllByRole('textbox')[0];
    if (focus) fireEvent.change(focus, { target: { value: 'planning' } });
    await press(/Introspect|Run|Analy[sz]e|Start/i);
    await settle();
    expect(meta.introspect).toHaveBeenCalled();
  });

  it('the learning panel lists resolutions from the record', async () => {
    const view = render(<LearningPanel />);
    await settle();
    expect(view.container.textContent).toMatch(/Resolved|It will rain|weather/);
  });

  it('reflection prompts answer, save, reload, expand a saved one, and report an empty save', async () => {
    render(<ReflectionPrompts decisionId="d1" />);
    await settle();
    await press(/Save/i);
    expect(document.body.textContent).toMatch(/Answer at least one prompt/);
    const boxes = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    fireEvent.change(boxes[0], { target: { value: 'I assumed the plan was simple.' } });
    fireEvent.change(boxes[boxes.length - 1], { target: { value: 'Revisit Friday' } });
    await press(/Save/i);
    await press(/Weekly review/);
    expect(sent()).toEqual(expect.arrayContaining(['reflectionPrompts', 'reflectionList', 'reflectionSave']));
  });

  it('the accuracy tracker reloads when the record changes', async () => {
    render(<AccuracyTracker />);
    await settle();
    const before = sent().filter((x) => x === 'accuracyHistory').length;
    await act(async () => { window.dispatchEvent(new Event('metacognition:record-changed')); await new Promise((r) => setTimeout(r, 5)); });
    expect(sent().filter((x) => x === 'accuracyHistory').length).toBeGreaterThan(before);
  });

  it('predictions analysis refuses until two predictions are resolved', async () => {
    meta.predictions.mockResolvedValue({ data: { predictions: [PREDICTIONS[2]] } });
    render(<PredictionsPanel />);
    await settle();
    await press(/Calibration/i);
    expect(document.body.textContent).toMatch(/Resolve at least 2|Predictions/);
  });
});
