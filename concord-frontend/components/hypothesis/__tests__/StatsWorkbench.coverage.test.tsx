// Render + behaviour coverage for the statistics workbench: test battery (t-test, ANOVA,
// chi-square, correlation, regression + APA export), datasets, assumption checks, multiple
// comparison correction, pre-registration registry and analysis history.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const DATASET = { id: 'ds1', name: 'Trial', rowCount: 10, columnCount: 3, hypothesisId: null, createdAt: '2026-03-01', columns: [{ name: 'group', type: 'text', stats: {} }, { name: 'score', type: 'number', stats: { mean: 5 } }, { name: 'age', type: 'number', stats: { mean: 30 } }] };
const STAT = { reject: true, significant: true, tStatistic: 2.31, degreesOfFreedom: 18, pValue: 0.032, meanDifference: 1.2, effectSize: 0.8, effectMagnitude: 'large', confidenceInterval: { level: 0.95, lower: 0.1, upper: 2.3 }, conclusion: 'Reject the null.' };
function resultFor(action: string): unknown {
  switch (action) {
    case 'tTest': return STAT;
    case 'anova': return { ...STAT, fStatistic: 4.2, degreesOfFreedom: { between: 2, within: 27 }, etaSquared: 0.24, groups: [{ label: 'A', mean: 4 }, { label: 'B', mean: 6 }] };
    case 'chiSquare': return { ...STAT, chiSquare: 7.8, degreesOfFreedom: 3, cramersV: 0.3, expectedCellWarning: 'Some expected counts < 5' };
    case 'correlation': return { ...STAT, pearson: 0.71, spearman: 0.65, rSquared: 0.5, strength: 'strong', direction: 'positive', confidenceInterval: { lower: 0.3, upper: 0.9 }, scatter: [{ x: 1, y: 2 }, { x: 2, y: 4 }] };
    case 'regression': return { ...STAT, equation: 'y = 2x + 1', slope: 2, slopeStdError: 0.2, intercept: 1, rSquared: 0.9, adjustedRSquared: 0.88, slopePValue: 0.001, fStatistic: 80, fPValue: 0.001, residualStandardError: 0.5, points: [{ x: 1, y: 3, fitted: 3.1 }] };
    case 'apaReport': return { apa: 't(18) = 2.31, p = .032' };
    case 'datasetList': return { datasets: [DATASET] };
    case 'list': return [{ id: 'h1', machine: { hypothesis: { statement: 'Onboarding lifts retention' } } }, { id: 'h2', statement: 'Alt hypothesis' }];
    case 'datasetImport': return { dataset: DATASET };
    case 'datasetGet': return DATASET;
    case 'runTestOnDataset': return { ...resultFor('tTest') as object, attached: { hypothesisId: 'h1', verdict: 'supports' }, test: 'correlation' };
    case 'assumptionCheck': return { allPassed: false, recommendation: 'Use a non-parametric test', checks: [{ test: 'normality', label: 'Group A', ok: true, skewness: 0.1, excessKurtosis: -0.2, omnibusK2: 1.2, pValue: 0.4, conclusion: 'Looks normal' }, { test: 'homoscedasticity', method: 'Levene', ok: false, statistic: 5.1, pValue: 0.01, note: 'Unequal variance' }, { test: 'normality', label: 'Group B', ok: null }] };
    case 'multipleComparison': return { recommendation: 'Holm keeps power', tests: [{ label: 'T1', rawP: 0.01, bonferroniP: 0.03, bonferroniReject: true, holmP: 0.02, holmReject: true, fdrP: 0.02, fdrReject: true }, { label: 'T2', rawP: 0.2, bonferroniP: 0.6, bonferroniReject: false, holmP: 0.4, holmReject: false, fdrP: 0.3, fdrReject: false }] };
    case 'registryList': return { items: [{ id: 'r1', statement: 'Training raises scores', predictedDirection: 'increase', plannedTest: 'tTest', alpha: 0.05, plannedSampleSize: 40, status: 'registered', outcome: null, registeredAt: '2026-03-01' }, { id: 'r2', statement: 'Sleep helps memory', predictedDirection: 'increase', plannedTest: null, alpha: 0.01, plannedSampleSize: null, status: 'completed', outcome: { result: 'confirmed', pValue: 0.01 }, registeredAt: '2026-02-01' }], counts: { registered: 1, completed: 1 } };
    case 'preregister': return { item: { id: 'r3' } };
    case 'analysisHistory': return { items: [{ id: 'a1', kind: 'tTest', summary: 't(18)=2.31', createdAt: '2026-03-01T00:00:00Z' }, { id: 'a2', kind: 'anova', summary: 'F=4.2', createdAt: '2026-03-02T00:00:00Z' }] };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => {
    lensRunMock(...a);
    const action = actionOf(a);
    const result = resultFor(action);
    return Promise.resolve({ data: action === 'list' ? { ok: true, result } : { ok: true, result } });
  },
}));
vi.mock('@/components/viz', () => ({ ChartKit: ({ data }: { data?: unknown[] }) => <div>chart:{data?.length ?? 0}</div> }));
vi.mock('../ExperimentDesignPanel', () => ({ ExperimentDesignPanel: () => <span>design-stub</span> }));
vi.mock('../HypothesisRegistryMenu', () => ({ HypothesisRegistryMenu: () => <span>registry-menu-stub</span> }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 30)); }); };
const TAB_RE = /^(Test Battery|A\/B, Bayes & Power|Datasets|Assumption Checks|Multiple Comparison|Pre-Registration|History)$/;
const KIND_RE = /^(t-Test|ANOVA|Chi-Square|Correlation|Regression)$/;
const goTab = async (name: string) => { const b = screen.getAllByRole('button').find((x) => (x.textContent || '').trim() === name); if (b) await click(b); };
const mount = async () => { const { StatsWorkbench } = await import('../StatsWorkbench'); const v = render(<StatsWorkbench />); await settle(); return v; };
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});

describe('StatsWorkbench', () => {
  it('runs every test kind and exports an APA line', { timeout: 150000 }, async () => {
    const v = await mount();
    for (const k of ['t-Test', 'ANOVA', 'Chi-Square', 'Correlation', 'Regression']) {
      await goTab(k);
      await exercise({ passes: 2, text: '1, 2, 3, 4, 5', skip: new RegExp(`${TAB_RE.source}|${KIND_RE.source}|delete|remove|cancel|close|^×$`, 'i') });
      await settle();
    }
    const calls = sent();
    for (const a of ['tTest', 'anova', 'chiSquare', 'correlation', 'regression']) expect(calls).toContain(a);
    expect(v.container.textContent).toMatch(/Result|Reject the null|y = 2x/);
  });

  it('walks datasets, assumptions, correction, registry and history', { timeout: 150000 }, async () => {
    const v = await mount();
    for (const t of ['A/B, Bayes & Power', 'Datasets', 'Assumption Checks', 'Multiple Comparison', 'Pre-Registration', 'History']) {
      await goTab(t);
      await exercise({ passes: 2, text: "0.01, 0.04, 0.2", skip: new RegExp(`${TAB_RE.source}|delete|remove|trash|discard|cancel|close|^×$`, 'i') });
      await settle();
    }
    const calls = sent();
    for (const a of ['datasetList', 'assumptionCheck', 'multipleComparison', 'registryList', 'analysisHistory']) expect(calls).toContain(a);
    expect(sent().some((x) => /datasetImport|runTestOnDataset|preregister|apaReport/.test(x))).toBe(true);
    expect(v.container.textContent?.length).toBeGreaterThan(50);
  });

  it('exercises destructive paths and failing backends', { timeout: 150000 }, async () => {
    const v = await mount();
    for (const t of ['Datasets', 'Pre-Registration']) {
      await goTab(t);
      await exercise({ passes: 2, text: 'x', skip: new RegExp(`${TAB_RE.source}|cancel|close|^×$`, 'i') });
      await settle();
    }
    expect(sent().some((x) => /datasetDelete|registryDelete|recordOutcome/.test(x))).toBe(true);
    cleanup();
    vi.doMock('@/lib/api/client', () => ({ lensRun: () => Promise.resolve({ data: { ok: false, error: 'stats engine offline' } }) }));
    vi.resetModules();
    const { StatsWorkbench } = await import('../StatsWorkbench');
    const bad = render(<StatsWorkbench />);
    await settle();
    for (const t of ['Test Battery', 'Datasets', 'Assumption Checks', 'Multiple Comparison', 'Pre-Registration', 'History']) {
      await goTab(t);
      await exercise({ passes: 1, text: '1, 2, 3', skip: new RegExp(`${TAB_RE.source}|${KIND_RE.source}|delete|remove|cancel|close|^×$`, 'i') });
    }
    expect(bad.container.textContent).toMatch(/stats engine offline|Could not load|failed|required/i);
    expect(v).toBeTruthy();
  });
});
