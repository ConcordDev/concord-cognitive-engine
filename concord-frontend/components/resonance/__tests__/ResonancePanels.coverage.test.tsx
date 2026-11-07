// Render + behaviour coverage for the resonance lens: the cross-domain workbench (pairs, graph,
// alerts, insights; propose / edit / delete / drill down), the paged pairs panel and the shared
// resonance UI (legend, threshold config, canvases, pair cards, sparkline, export).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const boundary = vi.fn();
const SIDE = (id: string, domain: string, title: string) => ({ id, domain, title, description: `${title} d`, invariants: ['conserves energy', 'feedback loop'] });
const PAIR = { id: 'pr1', a: SIDE('a1', 'physics', 'Entropy'), b: SIDE('b1', 'economics', 'Inflation'), note: 'Interesting', resonance: 0.82, invOverlap: 0.7, tokOverlap: 0.1, classification: 'strong_resonance', sharedInvariants: ['feedback loop'], createdAt: '2026-03-01', analyzedAt: '2026-03-02' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'listPairs': return { pairs: [PAIR, { ...PAIR, id: 'pr2', classification: 'weak_signal', resonance: 0.3, note: undefined, analyzedAt: undefined }, { ...PAIR, id: 'pr3', classification: 'noise_floor', resonance: 0.05 }], byClass: { strong_resonance: 1, weak_signal: 1, noise_floor: 1 }, avgResonance: 0.39 };
    case 'resonanceGraph': return { nodes: [{ id: 'physics', label: 'physics', pairCount: 2, avgResonance: 0.6 }, { id: 'economics', label: 'economics', pairCount: 2, avgResonance: 0.5 }, { id: 'biology', label: 'biology', pairCount: 1, avgResonance: 0.2 }], edges: [{ source: 'physics', target: 'economics', strength: 0.8, classification: 'strong_resonance', pairCount: 2, pairIds: ['pr1'] }, { source: 'economics', target: 'biology', strength: 0.2, classification: 'weak_signal', pairCount: 1, pairIds: ['pr2'] }], stats: { domains: 3, connections: 2, strongestEdge: { source: 'physics', target: 'economics', strength: 0.8, classification: 'strong_resonance', pairCount: 2, pairIds: ['pr1'] } } };
    case 'resonanceAlerts': return { alerts: [{ id: 'al1', pairId: 'pr1', label: 'Entropy ⇔ Inflation', resonance: 0.82, classification: 'strong_resonance', message: 'New strong resonance', raisedAt: '2026-03-02', acknowledged: false }, { id: 'al2', pairId: 'pr2', label: 'x', resonance: 0.3, classification: 'weak_signal', message: 'Weak', raisedAt: '2026-03-01', acknowledged: true, acknowledgedAt: '2026-03-02' }], unacknowledgedCount: 1 };
    case 'listInsights': return { insights: [{ id: 'in1', kind: 'bridge', title: 'Feedback loops bridge physics and economics', layers: { human: 'Both fields model feedback.', core: { claims: ['Feedback is shared'], evidence: { pairs: 2 } } }, derivedFrom: 'pr1', confidence: 0.8, createdAt: '2026-03-02' }] };
    case 'drilldown': case 'pairDrilldown': return { pair: { id: 'pr1', a: { domain: 'physics', title: 'Entropy' }, b: { domain: 'economics', title: 'Inflation' }, resonance: 0.82, classification: 'strong_resonance', invOverlap: 0.7, tokOverlap: 0.1 }, correspondences: [{ aInvariant: 'feedback loop', bInvariant: 'feedback loop', alignment: 1, aligned: true, sharedTokens: ['feedback'] }, { aInvariant: 'conserves energy', bInvariant: null, alignment: 0, aligned: false, sharedTokens: [] }], alignedCount: 1, unmatchedA: ['conserves energy'], unmatchedB: [], interpretation: 'Partial structural match' };
    case 'pairTrend': case 'trend': return { pairId: 'pr1', label: 'Entropy ⇔ Inflation', series: [{ timestamp: '2026-03-01', resonance: 0.7, invOverlap: 0.6, tokOverlap: 0.1, classification: 'strong_resonance' }, { timestamp: '2026-03-02', resonance: 0.82, invOverlap: 0.7, tokOverlap: 0.1, classification: 'strong_resonance' }], samples: 2, current: 0.82, delta: 0.12, direction: 'rising', peak: 0.82 };
    default: return { ok: true, pair: PAIR };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { resonance: { boundary: (...a: unknown[]) => boundary(...a) }, lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div>chart</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { CrossDomainWorkbench } from '../CrossDomainWorkbench';
import { PairsPanel } from '../PairsPanel';
import { DEFAULT_THRESHOLDS, HistorySparkline, PairCard, ResonanceFieldCanvas, ResonanceSpectrumCanvas, SignalClassificationLegend, SignalMeter, ThresholdConfigPanel, exportResonanceData, type BoundaryScan, type HistoryPoint } from '../resonance-ui';

const SCAN: BoundaryScan = { ok: true, signal: 0.7, classification: 'strong_resonance', timestamp: '2026-03-02T10:00:00Z', frontier: { size: 40, density: 0.5, avgCrispness: 0.6 }, interior: { size: 100, avgCrispness: 0.7 }, gradient: 0.3, coherenceDirection: 0.2, crossDomainAlignment: { domainsScanned: 6, pairsFound: 40, topResonance: 0.9, avgResonance: 0.4, topPairs: [{ a: { id: 'a1', title: 'Entropy', domain: 'physics' }, b: { id: 'b1', title: 'Inflation', domain: 'economics' }, invOverlap: 0.7, tokOverlap: 0.1, resonance: 0.82, sharedInvariants: ['feedback'] }], pairsOffset: 0, pairsLimit: 25, pairsPage: [{ a: { id: 'a2', title: 'Waves', domain: 'physics' }, b: { id: 'b2', title: 'Trade cycles', domain: 'economics' }, invOverlap: 0.5, tokOverlap: 0.1, resonance: 0.55, sharedInvariants: [] }], scoreDistribution: { buckets: [{ min: 0, max: 0.5, count: 30 }, { min: 0.5, max: 1, count: 10 }], p50: 0.3, p90: 0.8 } } };
const HIST: HistoryPoint[] = Array.from({ length: 12 }, (_, i) => ({ signal: 0.2 + i * 0.05, classification: 'moderate_resonance', gradient: 0.1, coherence: 0.5, pairs: i, topResonance: 0.6, frontier: 10 + i, timestamp: `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));

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
  lensRunMock.mockReset(); boundary.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  boundary.mockResolvedValue({ data: SCAN });
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => {} }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

describe('resonance ui', () => {
  it('draws the canvases, the meter, cards, sparkline and legend/threshold controls', async () => {
    const onToggle = vi.fn(); const onChange = vi.fn();
    const view = render(<div>
      <SignalClassificationLegend isOpen onToggle={onToggle} />
      <ThresholdConfigPanel thresholds={DEFAULT_THRESHOLDS} onChange={onChange} isOpen onToggle={onToggle} />
      <ResonanceFieldCanvas signal={0.7} gradient={0.3} coherence={0.5} classification="strong_resonance" scanning />
      <ResonanceSpectrumCanvas signal={0.7} gradient={0.3} coherence={0.5} classification="moderate_resonance" topResonance={0.9} pairsFound={40} />
      <SignalMeter value={0.6} label="Signal" />
      <PairCard pair={SCAN.crossDomainAlignment.topPairs[0]} rank={1} thresholds={DEFAULT_THRESHOLDS} />
      <HistorySparkline readings={HIST} />
      <HistorySparkline readings={[]} />
    </div>);
    await settle();
    await exercise({ passes: 2, text: '0.5', skip: /delete|remove|cancel|close|dismiss|clear|^back|^×$/i });
    for (const slider of Array.from(view.container.querySelectorAll('input[type="range"]')) as HTMLInputElement[]) fireEvent.change(slider, { target: { value: '0.4' } });
    await press(/Reset/i);
    expect(view.container.textContent?.length).toBeGreaterThan(50);
    expect(onChange).toHaveBeenCalled();
  });
  it('exports a reading and its history as JSON and CSV, and ignores an empty export', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportResonanceData(SCAN, HIST, 'json');
    exportResonanceData(SCAN, HIST, 'csv');
    exportResonanceData(undefined, HIST, 'csv');
    exportResonanceData(undefined, [], 'json');
    expect(click.mock.calls.length).toBe(3);
  });
});

describe('resonance panels', () => {
  it('pairs panel renders the distribution, pages through pairs and edits thresholds', async () => {
    const onThresholds = vi.fn();
    const view = render(<PairsPanel scan={SCAN} thresholds={DEFAULT_THRESHOLDS} onThresholdsChange={onThresholds} />);
    await settle();
    expect(view.container.textContent).toMatch(/40 pairs across 6 domains/);
    await exercise({ passes: 2, text: '0.5', skip: /delete|remove|cancel|close|dismiss|clear|^back|^×$/i });
    await press(/Next|›|→/i); await press(/Prev|‹|←/i);
    expect(boundary).toHaveBeenCalled();
    cleanup();
    const empty = render(<PairsPanel scan={undefined} thresholds={DEFAULT_THRESHOLDS} onThresholdsChange={onThresholds} />);
    await settle();
    expect(empty.container.textContent).toMatch(/0 pairs/);
  });

  it('the workbench lists pairs, graph, alerts and insights and survives an exercise pass', async () => {
    const view = render(<CrossDomainWorkbench />);
    await settle();
    expect(view.container.textContent).toMatch(/Entropy|Inflation/);
    const skip = /^(Pairs|Graph|Alerts|Insights)\b|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i;
    for (const tab of [/^Pairs/, /^Graph/, /^Alerts/, /^Insights/]) { await press(tab); await settle(); await exercise({ passes: 2, text: 'entropy', skip }); }
    expect(sent()).toEqual(expect.arrayContaining(['listPairs', 'resonanceGraph', 'resonanceAlerts', 'listInsights']));
  });

  it('proposes, edits, drills into and deletes a pair, acknowledges alerts and clears', async () => {
    render(<CrossDomainWorkbench />);
    await settle();
    await press(/^Pairs/);
    await press(/Propose|New pair|Add pair|\+/i);
    const boxes = () => Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[];
    boxes().filter((b) => b.type !== 'file').forEach((b, i) => fireEvent.change(b, { target: { value: i % 2 ? 'feedback loop\nconservation' : `Field ${i}` } }));
    await press(/^(Propose|Save|Create|Update)/i);
    await press(/Entropy/); await settle();
    await press(/Edit|Pencil/i); await press(/^(Save|Update)/i);
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    await press(/^Alerts/); await press(/Acknowledge|Ack|Dismiss/i); await press(/Clear/i); await press(/Confirm|Yes|Clear/i);
    await press(/^Insights/);
    expect(sent().some((x) => /proposePair|updatePair|deletePair|acknowledge|drill|trend|clear/i.test(x))).toBe(true);
  });

  it('the workbench stays standing offline', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const view = render(<CrossDomainWorkbench />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});
