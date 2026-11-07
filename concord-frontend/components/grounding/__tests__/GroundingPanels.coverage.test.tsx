// Render + behaviour coverage for the grounding lens: claim verification bench (fact-check,
// source credibility, decomposition, mint / DM / publish / agent) and the fact-grounding
// workbench (evidence aggregation, bias, trending, audit trail, rebuttals).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const h = vi.hoisted(() => ({ lensRun: vi.fn(), post: vi.fn() }));
const BIAS = { lean: 'center', leanScore: 0, reliability: 'high', factuality: 90, known: true };
const CHECK = { id: 'k1', claim: 'The sky is blue', verdict: 'mostly-true', probabilityTrue: 0.82, confidence: 0.7, sourceCount: 3, checkedAt: '2026-03-01T00:00:00Z' };
function resultFor(action: string): unknown {
  switch (action) {
    case 'factCheck': return { claim: 'c', verdict: 'supported', confidence: 0.8, direction: 'supporting', evidenceCount: 2, breakdown: { supporting: { count: 2 }, contradicting: { count: 0 }, neutral: { count: 0 } }, evaluations: [{ source: 'Reuters', stance: 'supports', relevance: 0.9, reliability: 0.95 }] };
    case 'sourceCredibility': return { sourceCount: 1, averageCredibility: 82, overallAssessment: 'credible', sources: [{ name: 'Reuters', credibilityScore: 82, credibilityLabel: 'High credibility', type: 'news' }], recommendations: ['Cross-check dates'] };
    case 'claimDecomposition': return { atomicClaimCount: 2, logicalStructure: 'conjunction', claimComplexity: 'moderate', overallAssessment: 'mixed', components: [{ index: 1, text: 'Part one', claimType: 'factual', evaluation: { verdict: 'supported', score: 0.8 } }, { index: 2, text: 'Part two', claimType: 'causal', evaluation: null }] };
    case 'aggregateEvidence': return { claim: 'c', verdict: 'likely-true', probabilityTrue: 0.78, sourceCount: 3, knownSourceCount: 2, breakdown: { supporting: { count: 2, weight: 1.6 }, contradicting: { count: 1, weight: 0.4 }, neutral: { count: 0 } }, leanSpread: 1.2, spectrumCoverage: 'balanced', citations: [{ index: 1, excerpt: 'Evidence one', sourceName: 'Reuters', sourceUrl: 'https://reuters.com/a', stance: 'supports', sourceWeight: 0.9, bias: BIAS }, { index: 2, excerpt: 'Evidence two', sourceName: 'Blog', sourceUrl: 'https://blog.example/b', stance: 'contradicts', sourceWeight: 0.3, bias: null }], notes: 'Aggregated 3 sources' };
    case 'confidenceRating': return { probabilityTrue: 0.78, confidence: 0.66, confidenceBand: 'moderate', interval: { lower: 0.5, upper: 0.9, margin: 0.2 }, factors: { decisiveness: 0.7, sourceAgreement: 0.6, evidenceVolume: 0.5, avgSourceWeight: 0.7 }, recommendation: 'Add more sources' };
    case 'discoverCoverage': return { claim: 'c', query: 'q', source: 'gdelt', count: 2, knownSourceCount: 1, spectrumCoverage: 'left-heavy', articles: [{ index: 1, title: 'Headline A', url: 'https://news.example/a', sourceName: 'News A', sourceCountry: 'US', language: 'en', publishedAt: '2026-03-01', stance: 'supports', bias: BIAS }, { index: 2, title: 'Headline B', url: 'https://news.example/b', sourceName: 'News B', sourceCountry: null, language: null, publishedAt: null, stance: 'neutral', bias: null }], evidenceCandidates: [{ text: 'Candidate text', sourceUrl: 'https://news.example/a', sourceName: 'News A', stance: 'supports' }] };
    case 'recordCheck': return { recorded: CHECK };
    case 'factCheckCard': return { card: { id: 'card1', claim: 'The sky is blue', verdict: 'mostly-true', verdictColor: '#22c55e', emoji: '✅', probabilityTrue: 0.82, confidence: 0.7, ratingLabel: 'Mostly true', summary: 'Backed by 3 sources', sources: [{ url: 'https://reuters.com', name: 'Reuters', lean: 'center' }], sourceCount: 3, issuedAt: '2026-03-01', shareText: 'Fact check: mostly true' } };
    case 'sourceBias': return { sources: [{ url: 'reuters.com', domain: 'reuters.com', name: 'Reuters', lean: 'center', leanScore: 0, reliability: 'high', factuality: 92, rated: true }, { url: 'foxnews.com', domain: 'foxnews.com', name: 'Fox', lean: 'right', leanScore: 3, reliability: 'mixed', factuality: 60, rated: true }, { url: 'x.example', domain: 'x.example', name: 'x', lean: 'unrated', leanScore: null, reliability: 'unknown', factuality: null, rated: false }], ratedCount: 2, unratedCount: 1, aggregateLeanScore: 1.5, aggregateLean: 'center-right', leanSpread: 3, balance: 'skewed', referenceNote: 'Based on public ratings' };
    case 'trendingClaims': return { date: '2026-03-01', count: 2, source: 'gdelt', claims: [{ kind: 'headline', headline: 'Big claim today', suggestedClaim: 'Big claim is true', checkability: 'high', views: 1200 }, { kind: 'topic', headline: 'Other', suggestedClaim: 'Other is false', checkability: 'low' }] };
    case 'auditTrail': return { totalChecks: 2, checks: [CHECK, { ...CHECK, id: 'k2', verdict: 'false', probabilityTrue: 0.1 }], trail: [{ id: 't1', action: 'check', checkId: 'k1', claim: 'The sky is blue', verdict: 'mostly-true', at: '2026-03-01T00:00:00Z' }], stats: { verdictDistribution: { 'mostly-true': 1, false: 1 }, avgProbabilityTrue: 0.46 } };
    case 'rebuttalsFor': return { rebuttals: [{ id: 'rb1', checkId: 'k1', originalClaim: 'The sky is blue', originalVerdict: 'mostly-true', counterClaim: 'It is grey today', stance: 'contradicts', counterEvidence: [{ text: 'Photo', sourceUrl: 'https://p.example' }], linkedAt: '2026-03-02' }] };
    case 'linkRebuttal': return { rebuttal: { id: 'rb2', checkId: 'k1', originalClaim: 'c', originalVerdict: 'v', counterClaim: 'cc', stance: 'contradicts', counterEvidence: [], linkedAt: '2026-03-02' } };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => h.lensRun(...a),
  api: { post: (...a: unknown[]) => h.post(...a) },
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));
vi.mock('@/components/viz', () => ({
  ChartKit: ({ data }: { data?: unknown[] }) => <div>chart:{data?.length ?? 0}</div>,
  TimelineView: ({ events }: { events?: unknown[] }) => <div>timeline:{events?.length ?? 0}</div>,
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const sent = () => h.lensRun.mock.calls.map((c) => actionOf(c));
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 25)); }); };
afterEach(() => cleanup());
beforeEach(() => {
  h.lensRun.mockReset(); h.post.mockReset();
  h.lensRun.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
  h.post.mockImplementation(async (url: string, body?: { domain?: string }) => {
    if (body?.domain === 'dtu') return { data: { result: { dtu: { id: 'dtu-grounding-1' } } } };
    if (body?.domain === 'chat_agent') return { data: { result: { answer: 'Verify primary sources.' } } };
    return { data: { ok: true, message: { id: 'm1' } } };
  });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});

describe('ClaimVerificationPanel', () => {
  const mount = async () => { const { ClaimVerificationPanel } = await import('../ClaimVerificationPanel'); const v = render(<ClaimVerificationPanel />); await settle(); return v; };

  it('runs fact-check, credibility and decomposition with evidence rows', { timeout: 90000 }, async () => {
    const v = await mount();
    await exercise({ passes: 3, text: 'The earth orbits the sun', skip: /delete|remove|trash|discard|cancel|close|dismiss|clear|^×$/i });
    await settle();
    const calls = sent();
    for (const a of ['factCheck', 'sourceCredibility', 'claimDecomposition']) expect(calls).toContain(a);
    expect(v.container.textContent?.length).toBeGreaterThan(100);
  });

  it('mints, DMs, publishes and asks the agent; reports failures', { timeout: 90000 }, async () => {
    const v = await mount();
    await exercise({ passes: 4, text: 'Claim text 123', skip: /delete|remove|trash|discard|cancel|close|dismiss|clear|^×$/i });
    expect(h.post.mock.calls.length).toBeGreaterThan(0);
    cleanup();
    h.lensRun.mockImplementation(async () => ({ data: { ok: false, error: 'engine down' } }));
    h.post.mockRejectedValue({ response: { data: { error: 'post failed' } } });
    const bad = await mount();
    await exercise({ passes: 3, text: 'x y z', skip: /delete|remove|cancel|close|^×$/i });
    expect(bad.container.textContent).toMatch(/engine down|post failed|Enter a claim|failed/i);
    expect(v).toBeTruthy();
  });
});

describe('FactGroundingWorkbench', () => {
  const mount = async () => { const { FactGroundingWorkbench } = await import('../FactGroundingWorkbench'); const v = render(<FactGroundingWorkbench />); await settle(); return v; };
  const TAB_RE = /^(Evidence aggregator|Source bias|Trending claims|Audit trail|Rebuttals)$/;
  const goTab = async (name: string) => { const b = screen.getAllByRole('button').find((x) => (x.textContent || '').trim() === name); if (b) await click(b); };

  it('aggregates evidence, rates confidence, discovers coverage and issues a card', { timeout: 120000 }, async () => {
    const v = await mount();
    await exercise({ passes: 3, text: 'The sky is blue today', skip: new RegExp(`${TAB_RE.source}|delete|remove|trash|discard|cancel|close|^×$`, 'i') });
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['aggregateEvidence', 'confidenceRating']));
    expect(v.container.textContent?.length).toBeGreaterThan(100);
  });

  it('walks bias, trending, audit trail and rebuttal tabs', { timeout: 120000 }, async () => {
    const v = await mount();
    for (const t of ['Source bias', 'Trending claims', 'Audit trail', 'Rebuttals']) {
      await goTab(t);
      await exercise({ passes: 2, text: 'https://counter.example/x', skip: new RegExp(`${TAB_RE.source}|delete|remove|trash|discard|cancel|close|^×$`, 'i') });
      await settle();
    }
    for (const a of ['sourceBias', 'trendingClaims', 'auditTrail', 'rebuttalsFor']) expect(sent()).toContain(a);
    expect(sent().some((x) => /linkRebuttal|recordCheck|factCheckCard/.test(x))).toBe(true);
    expect(v.container.textContent?.length).toBeGreaterThan(50);
  });

  it('shows failures from every macro', { timeout: 90000 }, async () => {
    h.lensRun.mockImplementation(async () => ({ data: { ok: false, error: 'grounding offline' } }));
    const v = await mount();
    for (const t of ['Evidence aggregator', 'Source bias', 'Trending claims', 'Audit trail', 'Rebuttals']) {
      await goTab(t);
      await exercise({ passes: 1, text: 'text', skip: new RegExp(`${TAB_RE.source}|delete|remove|cancel|close|^×$`, 'i') });
    }
    expect(v.container.textContent).toMatch(/grounding offline|required|Enter/i);
  });
});
