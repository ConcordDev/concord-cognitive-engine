'use client';

/**
 * FactGroundingWorkbench — Ground News / fact-check parity surface for the
 * grounding lens. Every panel is wired to a real `grounding` domain macro:
 *
 *   1. Multi-source evidence aggregation  → grounding.aggregateEvidence
 *   2. Calibrated confidence rating       → grounding.confidenceRating
 *   3. Source bias / political-lean       → grounding.sourceBias
 *   4. Claim verification audit trail     → grounding.recordCheck / auditTrail
 *   5. Trending claims to check           → grounding.trendingClaims
 *   6. Shareable fact-check card          → grounding.factCheckCard
 *   7. Counter-claim / rebuttal linking   → grounding.linkRebuttal / rebuttalsFor
 *
 * No mock data — every rendered value comes from a macro response.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Layers, Gauge, Scale, History, Flame, Share2, GitFork,
  Loader2, Plus, Trash2, Link2, Copy, Check, AlertTriangle, TrendingUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';

// ---- macro result shapes ---------------------------------------------------
interface BiasInfo {
  lean: string; leanScore: number | null; reliability: string;
  factuality: number | null; known?: boolean;
}
interface Citation {
  index: number; excerpt: string; sourceName: string; sourceUrl: string;
  stance: string; sourceWeight: number; bias: BiasInfo | null;
}
interface AggregateResult {
  claim: string; verdict: string; probabilityTrue: number;
  sourceCount: number; knownSourceCount: number;
  breakdown: {
    supporting: { count: number; weight: number };
    contradicting: { count: number; weight: number };
    neutral: { count: number };
  };
  leanSpread: number; spectrumCoverage: string;
  citations: Citation[]; notes: string;
}
interface ConfidenceResult {
  probabilityTrue: number; confidence: number; confidenceBand: string;
  interval: { lower: number; upper: number; margin: number };
  factors: { decisiveness: number; sourceAgreement: number; evidenceVolume: number; avgSourceWeight: number };
  recommendation: string;
}
interface SourceBiasResult {
  sources: Array<{ url: string; domain: string; name: string; lean: string; leanScore: number | null; reliability: string; factuality: number | null; rated: boolean }>;
  ratedCount: number; unratedCount: number;
  aggregateLeanScore: number | null; aggregateLean: string | null;
  leanSpread: number; balance: string; referenceNote: string;
}
interface AuditCheck {
  id: string; claim: string; verdict: string;
  probabilityTrue: number | null; confidence: number | null;
  sourceCount: number; checkedAt: string;
}
interface AuditTrailResult {
  totalChecks: number;
  checks: AuditCheck[];
  trail: Array<{ id: string; action: string; checkId: string; claim: string; verdict: string; at: string }>;
  stats: { verdictDistribution: Record<string, number>; avgProbabilityTrue: number | null };
}
interface TrendingResult {
  date: string; count: number; source: string;
  claims: Array<{ kind: string; headline: string; suggestedClaim: string; checkability: string; views?: number }>;
}
interface FactCheckCard {
  id: string; claim: string; verdict: string; verdictColor: string; emoji: string;
  probabilityTrue: number | null; confidence: number | null; ratingLabel: string;
  summary: string; sources: Array<{ url: string; name: string; lean: string }>;
  sourceCount: number; issuedAt: string; shareText: string;
}
interface Rebuttal {
  id: string; checkId: string; originalClaim: string; originalVerdict: string;
  counterClaim: string; stance: string;
  counterEvidence: Array<{ text: string; sourceUrl: string }>; linkedAt: string;
}

type EvidenceRow = { text: string; sourceUrl: string; sourceName: string };
type Tab = 'aggregate' | 'bias' | 'trending' | 'trail' | 'rebuttals';

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'aggregate', label: 'Evidence aggregator', icon: Layers },
  { id: 'bias', label: 'Source bias', icon: Scale },
  { id: 'trending', label: 'Trending claims', icon: Flame },
  { id: 'trail', label: 'Audit trail', icon: History },
  { id: 'rebuttals', label: 'Rebuttals', icon: GitFork },
];

const LEAN_COLOR: Record<string, string> = {
  'far-left': '#2563eb', left: '#3b82f6', 'center-left': '#60a5fa',
  center: '#a3a3a3', 'center-right': '#fca5a5', right: '#ef4444',
  'far-right': '#b91c1c', unrated: '#52525b',
};
function verdictTone(v: string): TimelineEvent['tone'] {
  if (/false/i.test(v)) return 'bad';
  if (/true/i.test(v)) return 'good';
  return 'warn';
}

export function FactGroundingWorkbench() {
  const [tab, setTab] = useState<Tab>('aggregate');

  // shared claim
  const [claim, setClaim] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // aggregate
  const [evidence, setEvidence] = useState<EvidenceRow[]>([
    { text: '', sourceUrl: '', sourceName: '' },
  ]);
  const [aggregate, setAggregate] = useState<AggregateResult | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceResult | null>(null);
  const [card, setCard] = useState<FactCheckCard | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // bias
  const [biasUrls, setBiasUrls] = useState('');
  const [sourceBias, setSourceBias] = useState<SourceBiasResult | null>(null);

  // trending
  const [trending, setTrending] = useState<TrendingResult | null>(null);

  // audit trail
  const [audit, setAudit] = useState<AuditTrailResult | null>(null);

  // rebuttals
  const [rebuttalCheckId, setRebuttalCheckId] = useState('');
  const [counterClaim, setCounterClaim] = useState('');
  const [counterUrl, setCounterUrl] = useState('');
  const [rebuttals, setRebuttals] = useState<Rebuttal[]>([]);

  const fail = (msg: string) => setError(msg);

  // -- audit trail load (also feeds rebuttal check picker) -------------------
  const loadAudit = useCallback(async () => {
    setBusy('trail'); setError(null);
    const r = await lensRun<AuditTrailResult>('grounding', 'auditTrail', { limit: 100 });
    if (r.data.ok && r.data.result) setAudit(r.data.result);
    else fail(r.data.error || 'failed to load audit trail');
    setBusy(null);
  }, []);

  const loadRebuttals = useCallback(async () => {
    setBusy('rebuttals'); setError(null);
    const r = await lensRun<{ rebuttals: Rebuttal[] }>('grounding', 'rebuttalsFor', {});
    if (r.data.ok && r.data.result) setRebuttals(r.data.result.rebuttals || []);
    else fail(r.data.error || 'failed to load rebuttals');
    setBusy(null);
  }, []);

  useEffect(() => {
    loadAudit();
    loadRebuttals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- 1. multi-source evidence aggregation + 2. confidence ------------------
  async function runAggregate() {
    const cleanClaim = claim.trim();
    if (!cleanClaim) { fail('Enter a claim to verify.'); return; }
    const rows = evidence.filter((e) => e.text.trim());
    if (rows.length === 0) { fail('Add at least one evidence item.'); return; }
    setBusy('aggregate'); setError(null); setConfidence(null); setCard(null); setSavedNote(null);

    const agg = await lensRun<AggregateResult>('grounding', 'aggregateEvidence', {
      claim: cleanClaim,
      evidence: rows.map((e) => ({
        text: e.text.trim(),
        sourceUrl: e.sourceUrl.trim(),
        sourceName: e.sourceName.trim(),
      })),
    });
    if (!agg.data.ok || !agg.data.result) {
      fail(agg.data.error || 'aggregation failed'); setBusy(null); return;
    }
    setAggregate(agg.data.result);

    // chain into calibrated confidence rating
    const b = agg.data.result.breakdown;
    const cites = agg.data.result.citations;
    const avgWeight = cites.length
      ? cites.reduce((s, c) => s + c.sourceWeight, 0) / cites.length
      : 0.5;
    const conf = await lensRun<ConfidenceResult>('grounding', 'confidenceRating', {
      probabilityTrue: agg.data.result.probabilityTrue,
      supporting: b.supporting.count,
      contradicting: b.contradicting.count,
      neutral: b.neutral.count,
      avgSourceWeight: avgWeight,
    });
    if (conf.data.ok && conf.data.result) setConfidence(conf.data.result);
    setBusy(null);
  }

  // -- 4. record into the audit trail ---------------------------------------
  async function recordToTrail() {
    if (!aggregate) return;
    setBusy('record'); setError(null);
    const r = await lensRun<{ recorded: AuditCheck }>('grounding', 'recordCheck', {
      claim: aggregate.claim,
      verdict: aggregate.verdict,
      probabilityTrue: aggregate.probabilityTrue,
      confidence: confidence?.confidence ?? null,
      sourceCount: aggregate.sourceCount,
      sources: aggregate.citations.map((c) => c.sourceUrl).filter(Boolean),
    });
    if (r.data.ok && r.data.result) {
      setSavedNote(`Recorded to audit trail (${r.data.result.recorded.id.slice(0, 12)}…)`);
      await loadAudit();
    } else fail(r.data.error || 'record failed');
    setBusy(null);
  }

  // -- 6. shareable fact-check card -----------------------------------------
  async function buildCard() {
    if (!aggregate) return;
    setBusy('card'); setError(null);
    const r = await lensRun<{ card: FactCheckCard }>('grounding', 'factCheckCard', {
      claim: aggregate.claim,
      verdict: aggregate.verdict,
      probabilityTrue: aggregate.probabilityTrue,
      confidence: confidence?.confidence ?? null,
      summary: confidence?.recommendation || aggregate.notes,
      sources: aggregate.citations.map((c) => ({ url: c.sourceUrl, name: c.sourceName })),
    });
    if (r.data.ok && r.data.result) setCard(r.data.result.card);
    else fail(r.data.error || 'card build failed');
    setBusy(null);
  }

  // -- 3. source bias labeling ----------------------------------------------
  async function runBias() {
    const urls = biasUrls.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0) { fail('Paste one or more source URLs.'); return; }
    setBusy('bias'); setError(null);
    const r = await lensRun<SourceBiasResult>('grounding', 'sourceBias', { sources: urls });
    if (r.data.ok && r.data.result) setSourceBias(r.data.result);
    else fail(r.data.error || 'bias lookup failed');
    setBusy(null);
  }

  // -- 5. trending claims discovery -----------------------------------------
  async function runTrending() {
    setBusy('trending'); setError(null);
    const r = await lensRun<TrendingResult>('grounding', 'trendingClaims', { limit: 16 });
    if (r.data.ok && r.data.result) setTrending(r.data.result);
    else fail(r.data.error || 'trending feed failed');
    setBusy(null);
  }

  // -- 7. link a rebuttal ---------------------------------------------------
  async function linkRebuttal() {
    if (!rebuttalCheckId) { fail('Select a recorded fact-check.'); return; }
    if (!counterClaim.trim()) { fail('Enter a counter-claim.'); return; }
    setBusy('link'); setError(null);
    const r = await lensRun<{ rebuttal: Rebuttal }>('grounding', 'linkRebuttal', {
      checkId: rebuttalCheckId,
      counterClaim: counterClaim.trim(),
      stance: 'rebuts',
      counterEvidence: counterUrl.trim()
        ? [{ text: counterClaim.trim(), sourceUrl: counterUrl.trim() }]
        : [],
    });
    if (r.data.ok && r.data.result) {
      setCounterClaim(''); setCounterUrl('');
      await loadRebuttals();
    } else fail(r.data.error || 'rebuttal link failed');
    setBusy(null);
  }

  function copyCard() {
    if (!card) return;
    navigator.clipboard?.writeText(card.shareText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => fail('clipboard unavailable'));
  }

  // ---- derived viz inputs --------------------------------------------------
  const verdictChartData = audit
    ? Object.entries(audit.stats.verdictDistribution).map(([verdict, count]) => ({ verdict, count }))
    : [];
  const trailEvents: TimelineEvent[] = audit
    ? audit.trail.slice(0, 24).map((t) => ({
        id: t.id, label: t.action, time: t.at, tone: verdictTone(t.verdict),
        detail: `${t.verdict} — ${t.claim}`,
      }))
    : [];

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-4 space-y-4">
      <header className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Fact-grounding workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Ground News parity
        </span>
      </header>

      {/* tab bar */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id} type="button"
              onClick={() => { setTab(t.id); setError(null); }}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                tab === t.id
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                  : 'bg-zinc-900/50 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300"
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ AGGREGATE TAB ============ */}
      {tab === 'aggregate' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Claim</label>
            <textarea
              value={claim} onChange={(e) => setClaim(e.target.value)} rows={2}
              placeholder="e.g. Global renewable energy capacity doubled between 2015 and 2023."
              className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Evidence sources</span>
              <button
                type="button"
                onClick={() => setEvidence((e) => [...e, { text: '', sourceUrl: '', sourceName: '' }])}
                className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
              >
                <Plus className="h-3 w-3" /> Add source
              </button>
            </div>
            {evidence.map((row, i) => (
              <div key={i} className="rounded border border-zinc-800 bg-zinc-900/40 p-2 space-y-1.5">
                <textarea
                  value={row.text} rows={2}
                  onChange={(e) => setEvidence((arr) => arr.map((r, j) => j === i ? { ...r, text: e.target.value } : r))}
                  placeholder="Evidence excerpt or finding…"
                  className="w-full resize-none rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
                />
                <div className="flex gap-1.5">
                  <input
                    value={row.sourceUrl}
                    onChange={(e) => setEvidence((arr) => arr.map((r, j) => j === i ? { ...r, sourceUrl: e.target.value } : r))}
                    placeholder="https://source-url"
                    className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
                  />
                  <input
                    value={row.sourceName}
                    onChange={(e) => setEvidence((arr) => arr.map((r, j) => j === i ? { ...r, sourceName: e.target.value } : r))}
                    placeholder="Source name (optional)"
                    className="w-40 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
                  />
                  {evidence.length > 1 && (
                    <button aria-label="Remove evidence"
                      type="button"
                      onClick={() => setEvidence((arr) => arr.filter((_, j) => j !== i))}
                      className="rounded bg-zinc-800 px-1.5 text-zinc-400 hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button" onClick={runAggregate} disabled={busy === 'aggregate'}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {busy === 'aggregate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            Aggregate evidence + rate confidence
          </button>

          {/* aggregate result */}
          {aggregate && (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-md px-3 py-1.5 text-sm font-bold ${
                  /false/i.test(aggregate.verdict) ? 'bg-rose-500/20 text-rose-300'
                  : /true/i.test(aggregate.verdict) ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-amber-500/20 text-amber-300'
                }`}>{aggregate.verdict}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-32 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-cyan-400" style={{ width: `${aggregate.probabilityTrue * 100}%` }} />
                    </div>
                    <span className="font-mono text-xs text-zinc-300">{Math.round(aggregate.probabilityTrue * 100)}% likely true</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-400">
                    {aggregate.sourceCount} sources · {aggregate.knownSourceCount} rated · spectrum: {aggregate.spectrumCoverage}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded bg-zinc-950 p-2 text-center">
                  <p className="text-lg font-bold text-emerald-400">{aggregate.breakdown.supporting.count}</p>
                  <p className="text-[10px] text-zinc-400">Supporting · w {aggregate.breakdown.supporting.weight}</p>
                </div>
                <div className="rounded bg-zinc-950 p-2 text-center">
                  <p className="text-lg font-bold text-rose-400">{aggregate.breakdown.contradicting.count}</p>
                  <p className="text-[10px] text-zinc-400">Contradicting · w {aggregate.breakdown.contradicting.weight}</p>
                </div>
                <div className="rounded bg-zinc-950 p-2 text-center">
                  <p className="text-lg font-bold text-zinc-400">{aggregate.breakdown.neutral.count}</p>
                  <p className="text-[10px] text-zinc-400">Neutral</p>
                </div>
              </div>

              {/* per-source citations with bias chips */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Citations</p>
                {aggregate.citations.map((c) => (
                  <div key={c.index} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-200">{c.sourceName}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] ${
                          c.stance === 'supports' ? 'bg-emerald-500/15 text-emerald-300'
                          : c.stance === 'contradicts' ? 'bg-rose-500/15 text-rose-300'
                          : 'bg-zinc-700/40 text-zinc-400'
                        }`}>{c.stance}</span>
                        {c.bias && (
                          <span
                            className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-zinc-950"
                            style={{ backgroundColor: LEAN_COLOR[c.bias.lean] || '#52525b' }}
                          >{c.bias.lean}</span>
                        )}
                        <span className="font-mono text-[9px] text-zinc-400">w {c.sourceWeight}</span>
                      </div>
                    </div>
                    {c.excerpt && <p className="mt-1 line-clamp-2 text-zinc-400">{c.excerpt}</p>}
                  </div>
                ))}
              </div>
              <p className="text-[10px] italic text-zinc-400">{aggregate.notes}</p>
            </div>
          )}

          {/* confidence rating */}
          {confidence && (
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-indigo-400" />
                <span className="text-sm font-semibold text-indigo-300">{confidence.confidenceBand}</span>
                <span className="font-mono text-xs text-zinc-400">{Math.round(confidence.confidence * 100)}%</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                95%-style interval: {Math.round(confidence.interval.lower * 100)}% –{' '}
                {Math.round(confidence.interval.upper * 100)}% (±{Math.round(confidence.interval.margin * 100)}pts)
              </p>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                {([
                  ['Decisive', confidence.factors.decisiveness],
                  ['Agreement', confidence.factors.sourceAgreement],
                  ['Volume', confidence.factors.evidenceVolume],
                  ['Src weight', confidence.factors.avgSourceWeight],
                ] as Array<[string, number]>).map(([label, v]) => (
                  <div key={label} className="rounded bg-zinc-950 p-1.5">
                    <p className="font-mono text-xs text-indigo-300">{Math.round(v * 100)}%</p>
                    <p className="text-[9px] text-zinc-400">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400">{confidence.recommendation}</p>
            </div>
          )}

          {/* downstream actions: record + card */}
          {aggregate && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button" onClick={recordToTrail} disabled={busy === 'record'}
                className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy === 'record' ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />}
                Record to audit trail
              </button>
              <button
                type="button" onClick={buildCard} disabled={busy === 'card'}
                className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy === 'card' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
                Build shareable card
              </button>
              {savedNote && <span className="self-center text-[10px] text-emerald-400">{savedNote}</span>}
            </div>
          )}

          {/* shareable fact-check card */}
          {card && (
            <div
              className="rounded-lg border-2 p-3 space-y-2"
              style={{ borderColor: card.verdictColor, backgroundColor: card.verdictColor + '12' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold" style={{ color: card.verdictColor }}>
                  {card.emoji} {card.verdict.toUpperCase()}
                </span>
                <button
                  type="button" onClick={copyCard}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy share text'}
                </button>
              </div>
              <p className="text-sm text-zinc-100">&ldquo;{card.claim}&rdquo;</p>
              <p className="text-[11px] text-zinc-400">{card.ratingLabel}</p>
              {card.summary && <p className="text-[11px] text-zinc-400">{card.summary}</p>}
              {card.sources.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {card.sources.map((s, i) => (
                    <span key={i} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-300">
                      {s.name} <span className="text-zinc-400">· {s.lean}</span>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[9px] text-zinc-400">Issued {new Date(card.issuedAt).toLocaleString()}</p>
            </div>
          )}
        </div>
      )}

      {/* ============ BIAS TAB ============ */}
      {tab === 'bias' && (
        <div className="space-y-3">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Source URLs (one per line or comma-separated)
          </label>
          <textarea
            value={biasUrls} onChange={(e) => setBiasUrls(e.target.value)} rows={4}
            placeholder={'reuters.com\nfoxnews.com\ntheguardian.com'}
            className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
          />
          <button
            type="button" onClick={runBias} disabled={busy === 'bias'}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {busy === 'bias' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
            Label bias &amp; reliability
          </button>

          {sourceBias && (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap gap-3 text-[11px]">
                <span className="text-zinc-400">Rated: <b className="text-zinc-200">{sourceBias.ratedCount}</b></span>
                <span className="text-zinc-400">Unrated: <b className="text-zinc-200">{sourceBias.unratedCount}</b></span>
                <span className="text-zinc-400">Balance: <b className="text-cyan-300">{sourceBias.balance}</b></span>
                {sourceBias.aggregateLean && (
                  <span className="text-zinc-400">Aggregate lean: <b className="text-zinc-200">{sourceBias.aggregateLean}</b></span>
                )}
              </div>

              {/* lean spectrum bar */}
              <div className="space-y-1.5">
                {sourceBias.sources.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="w-40 truncate text-zinc-300">{s.name}</span>
                    <div className="relative h-3 flex-1 rounded-full bg-zinc-800">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-600" />
                      {s.leanScore != null && (
                        <div
                          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-zinc-950"
                          style={{
                            left: `calc(${((s.leanScore + 5) / 10) * 100}% - 6px)`,
                            backgroundColor: LEAN_COLOR[s.lean] || '#52525b',
                          }}
                        />
                      )}
                    </div>
                    <span
                      className="w-24 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold text-zinc-950"
                      style={{ backgroundColor: LEAN_COLOR[s.lean] || '#52525b' }}
                    >{s.lean}</span>
                    <span className="w-20 text-right text-[10px] text-zinc-400">
                      {s.factuality != null ? `${s.factuality}% fact` : 'no rating'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] italic text-zinc-400">{sourceBias.referenceNote}</p>
            </div>
          )}
        </div>
      )}

      {/* ============ TRENDING TAB ============ */}
      {tab === 'trending' && (
        <div className="space-y-3">
          <button
            type="button" onClick={runTrending} disabled={busy === 'trending'}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {busy === 'trending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
            Pull trending claims to check
          </button>

          {trending && (
            <div className="space-y-2">
              <p className="text-[10px] text-zinc-400">{trending.count} items · {trending.date} · {trending.source}</p>
              {trending.claims.map((c, i) => (
                <div key={i} className="rounded border border-zinc-800 bg-zinc-900/40 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-zinc-200">{c.headline}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] ${
                      c.checkability === 'high' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                    }`}>{c.kind} · {c.checkability}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-400">Suggested claim: {c.suggestedClaim}</p>
                  <button
                    type="button"
                    onClick={() => { setClaim(c.suggestedClaim); setTab('aggregate'); }}
                    className="mt-1.5 flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-cyan-300 hover:bg-zinc-700"
                  >
                    <Link2 className="h-3 w-3" /> Check this claim
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ AUDIT TRAIL TAB ============ */}
      {tab === 'trail' && (
        <div className="space-y-3">
          <button
            type="button" onClick={loadAudit} disabled={busy === 'trail'}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy === 'trail' ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />}
            Refresh trail
          </button>

          {audit && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                  <p className="text-2xl font-bold text-white">{audit.totalChecks}</p>
                  <p className="text-[10px] text-zinc-400">Total fact-checks</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                  <p className="text-2xl font-bold text-cyan-300">
                    {audit.stats.avgProbabilityTrue != null ? `${Math.round(audit.stats.avgProbabilityTrue * 100)}%` : '—'}
                  </p>
                  <p className="text-[10px] text-zinc-400">Avg probability true</p>
                </div>
              </div>

              {verdictChartData.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Verdict distribution</p>
                  <ChartKit
                    kind="bar" data={verdictChartData} xKey="verdict"
                    series={[{ key: 'count', label: 'Checks', color: '#06b6d4' }]}
                    height={180} showLegend={false}
                  />
                </div>
              )}

              {trailEvents.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Verification activity</p>
                  <TimelineView events={trailEvents} height={110} />
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Recorded checks</p>
                {audit.checks.length === 0 && (
                  <p className="py-4 text-center text-[11px] text-zinc-400">
                    No recorded checks yet — run an aggregation and click &ldquo;Record to audit trail&rdquo;.
                  </p>
                )}
                {audit.checks.map((c) => (
                  <div key={c.id} className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="line-clamp-1 flex-1 text-zinc-200">{c.claim}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] ${
                        /false/i.test(c.verdict) ? 'bg-rose-500/15 text-rose-300'
                        : /true/i.test(c.verdict) ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-amber-500/15 text-amber-300'
                      }`}>{c.verdict}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[9px] text-zinc-400">
                      {c.probabilityTrue != null && <span>{Math.round(c.probabilityTrue * 100)}% true</span>}
                      {c.confidence != null && <span>conf {Math.round(c.confidence * 100)}%</span>}
                      <span>{c.sourceCount} sources</span>
                      <span>{new Date(c.checkedAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ============ REBUTTALS TAB ============ */}
      {tab === 'rebuttals' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Link a counter-claim</p>
            <select
              value={rebuttalCheckId} onChange={(e) => setRebuttalCheckId(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
            >
              <option value="">Select a recorded fact-check…</option>
              {(audit?.checks || []).map((c) => (
                <option key={c.id} value={c.id}>{c.verdict} — {c.claim.slice(0, 70)}</option>
              ))}
            </select>
            <textarea
              value={counterClaim} onChange={(e) => setCounterClaim(e.target.value)} rows={2}
              placeholder="Counter-claim / rebuttal…"
              className="w-full resize-none rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
            />
            <input
              value={counterUrl} onChange={(e) => setCounterUrl(e.target.value)}
              placeholder="Counter-evidence URL (optional)"
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
            />
            <button
              type="button" onClick={linkRebuttal} disabled={busy === 'link'}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500/15 px-3 py-1.5 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
            >
              {busy === 'link' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitFork className="h-3.5 w-3.5" />}
              Link rebuttal
            </button>
            {(!audit?.checks.length) && (
              <p className="text-[10px] text-zinc-400">Record a fact-check first to link a rebuttal to it.</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Debate threads ({rebuttals.length})</p>
              <button
                type="button" onClick={loadRebuttals}
                className="text-[10px] text-cyan-400 hover:underline"
              >Refresh</button>
            </div>
            {rebuttals.length === 0 && (
              <p className="py-4 text-center text-[11px] text-zinc-400">No rebuttals linked yet.</p>
            )}
            {rebuttals.map((r) => (
              <div key={r.id} className="rounded border border-zinc-800 bg-zinc-900/40 p-2.5 text-[11px]">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded bg-zinc-950 p-2">
                    <p className="text-[9px] uppercase tracking-wider text-emerald-400">Original ({r.originalVerdict})</p>
                    <p className="mt-0.5 text-zinc-300">{r.originalClaim}</p>
                  </div>
                  <div className="rounded bg-zinc-950 p-2">
                    <p className="text-[9px] uppercase tracking-wider text-rose-400">Counter ({r.stance})</p>
                    <p className="mt-0.5 text-zinc-300">{r.counterClaim}</p>
                  </div>
                </div>
                {r.counterEvidence.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {r.counterEvidence.map((e, i) => (
                      <p key={i} className="text-[9px] text-zinc-400">
                        ↳ {e.text}{e.sourceUrl && <span className="text-cyan-500"> · {e.sourceUrl}</span>}
                      </p>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-[9px] text-zinc-400">Linked {new Date(r.linkedAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
