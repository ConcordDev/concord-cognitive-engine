// Unit coverage for the news intel client: envelope normalisation, every macro wrapper and the
// localStorage-backed analysis set.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } } }));

import {
  callNewsMacro, fetchHeadlines, fetchDailyBriefing, runBiasDetection, runEventExtraction, runNarrativeTracking,
  headlineToAnalysisArticle, loadAnalysisSet, saveAnalysisSet, NEWS_CATEGORIES, type Headline,
} from '../intel-api';

const H = (id: string): Headline => ({ id, category: 'world', title: `T${id}`, url: 'https://x', source: 'src', publishedAt: '2026-03-01' });

beforeEach(() => { runDomain.mockReset(); localStorage.clear(); });

describe('callNewsMacro', () => {
  it('passes a plain envelope through', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { headlines: [] } } });
    // result has no inner `ok`, so the outer envelope is returned
    expect(await callNewsMacro('headlines', { a: 1 })).toEqual({ ok: true, result: { headlines: [] } });
    expect(runDomain).toHaveBeenCalledWith('news', 'headlines', { input: { a: 1 } });
  });
  it('collapses a double-wrapped envelope', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'upstream down' } } });
    expect(await callNewsMacro('x')).toEqual({ ok: false, error: 'upstream down' });
  });
  it('reports an empty response and thrown errors honestly', async () => {
    runDomain.mockResolvedValue({});
    expect(await callNewsMacro('x')).toEqual({ ok: false, error: 'empty response' });
    runDomain.mockRejectedValue(new Error('network'));
    expect(await callNewsMacro('x')).toEqual({ ok: false, error: 'network' });
    runDomain.mockRejectedValue('weird');
    expect(await callNewsMacro('x')).toEqual({ ok: false, error: 'request failed' });
  });
});

describe('macro wrappers', () => {
  beforeEach(() => runDomain.mockResolvedValue({ data: { ok: true, result: {} } }));
  it('sends the right action and inputs', async () => {
    await fetchHeadlines('tech', 10);
    await fetchHeadlines('world', 5, 20);
    await fetchDailyBriefing();
    const articles = [{ title: 'a', body: 'b' }];
    await runBiasDetection(articles);
    await runEventExtraction(articles);
    await runNarrativeTracking(articles);
    const calls = runDomain.mock.calls.map((c) => [c[1], c[2]]);
    expect(calls[0]).toEqual(['headlines', { input: { category: 'tech', limit: 10 } }]);
    expect(calls[1]).toEqual(['headlines', { input: { category: 'world', limit: 5, cursor: 20 } }]);
    expect(calls[2][0]).toBe('daily-briefing');
    expect(calls.slice(3).map((c) => c[0])).toEqual(['biasDetection', 'eventExtraction', 'narrativeTracking']);
    expect(NEWS_CATEGORIES).toContain('science');
  });
});

describe('analysis set', () => {
  it('converts a headline into an analysis article', () => {
    expect(headlineToAnalysisArticle(H('1'))).toEqual({ title: 'T1', body: 'T1', source: 'src', date: '2026-03-01' });
    expect(headlineToAnalysisArticle({ ...H('2'), publishedAt: null }).date).toBeUndefined();
  });
  it('round-trips, caps at 60 and filters malformed entries', () => {
    expect(loadAnalysisSet()).toEqual([]);
    saveAnalysisSet(Array.from({ length: 70 }, (_, i) => H(String(i))));
    expect(loadAnalysisSet()).toHaveLength(60);
    localStorage.setItem('concord:news:analysis-set:v1', JSON.stringify([H('ok'), { id: 5 }, null, 'str']));
    expect(loadAnalysisSet().map((h) => h.id)).toEqual(['ok']);
    localStorage.setItem('concord:news:analysis-set:v1', JSON.stringify({ not: 'array' }));
    expect(loadAnalysisSet()).toEqual([]);
    localStorage.setItem('concord:news:analysis-set:v1', '{bad json');
    expect(loadAnalysisSet()).toEqual([]);
  });
  it('swallows blocked storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => saveAnalysisSet([H('1')])).not.toThrow();
    spy.mockRestore();
  });
});
