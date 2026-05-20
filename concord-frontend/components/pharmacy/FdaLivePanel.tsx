'use client';

/**
 * FdaLivePanel — real FDA OpenFDA data for the pharmacy lens.
 *
 * Phase 4 of the 10-dimension UX completeness sprint. Backed by
 * pharmacy.live_label_lookup / live_adverse_events / live_recalls
 * (server/domains/pharmacy-live.js).
 *
 * Three tabs:
 *   Labels   — search a drug, get FDA-approved indications / contras /
 *              dosage / warnings
 *   Adverse  — recent adverse-event reports for a drug
 *   Recalls  — past 30 days of FDA enforcement actions
 *
 * Real federal data. The pharmacy lens label is REAL_FREE — full
 * formulary requires paid feeds (FirstDataBank etc.). This panel is
 * the honest free-tier surface.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Pill, AlertTriangle, RefreshCw, Loader2, Search, Activity, ShieldAlert, Building2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Label {
  setId: string;
  brandName: string | null;
  genericName: string | null;
  manufacturer: string | null;
  substanceName: string[];
  route: string[];
  productType: string | null;
  indicationsAndUsage: string | null;
  contraindications: string | null;
  warnings: string | null;
  dosageAndAdministration: string | null;
}

interface AdverseEvent {
  reportDate: string;
  serious: boolean;
  reactions: string[];
  patientAge: string | null;
  patientSex: 'M' | 'F' | null;
  outcomes: string[];
  reportingCountry: string | null;
}

interface Recall {
  recallNumber: string;
  initiationDate: string;
  productDescription: string;
  reason: string;
  classification: string;
  status: string;
  recallingFirm: string;
  state: string | null;
  country: string | null;
  distributionPattern: string;
}

type Tab = 'labels' | 'adverse' | 'recalls';

async function runMacro<T>(name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await lensRun({ domain: 'pharmacy', name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export function FdaLivePanel({ className }: { className?: string }) {
  const [tab, setTab] = useState<Tab>('labels');
  const [query, setQuery] = useState('');
  const [labels, setLabels] = useState<Label[]>([]);
  const [adverse, setAdverse] = useState<AdverseEvent[]>([]);
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<{ labels?: number; adverse?: number; recalls?: number }>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLabels = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setLabels([]); return; }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; labels?: Label[]; total?: number; reason?: string }>('live_label_lookup', { query: q });
    if (r?.ok) {
      setLabels(r.labels || []);
      setTotals(t => ({ ...t, labels: r.total }));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, []);

  const fetchAdverse = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setAdverse([]); return; }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; events?: AdverseEvent[]; total?: number; reason?: string }>('live_adverse_events', { query: q });
    if (r?.ok) {
      setAdverse(r.events || []);
      setTotals(t => ({ ...t, adverse: r.total }));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, []);

  const fetchRecalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; recalls?: Recall[]; total?: number; reason?: string }>('live_recalls');
    if (r?.ok) {
      setRecalls(r.recalls || []);
      setTotals(t => ({ ...t, recalls: r.total }));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'recalls') void fetchRecalls();
  }, [tab, fetchRecalls]);

  useEffect(() => {
    if (tab === 'labels' || tab === 'adverse') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (tab === 'labels') void fetchLabels(query);
        else if (tab === 'adverse') void fetchAdverse(query);
      }, 500);
    }
  }, [tab, query, fetchLabels, fetchAdverse]);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Pill className="w-4 h-4 text-pink-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">FDA OpenFDA · Live</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
      </header>

      <nav className="flex border-b border-zinc-800/80 text-xs" role="tablist">
        {([
          ['labels', 'Drug Labels', Pill],
          ['adverse', 'Adverse Events', Activity],
          ['recalls', 'Recalls (30d)', ShieldAlert],
        ] as const).map(([t, label, Icon]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t as Tab)}
            className={cn(
              'px-3 py-2 font-medium transition-colors flex items-center gap-1.5',
              tab === t
                ? 'text-pink-300 border-b-2 border-pink-400'
                : 'text-zinc-400 hover:text-zinc-200 border-b-2 border-transparent',
            )}
          >
            <Icon className="w-3 h-3" aria-hidden="true" />{label}
            {totals[t as keyof typeof totals] != null && (
              <span className="text-[10px] text-zinc-500 font-mono">{Math.min(totals[t as keyof typeof totals]!, 999)}</span>
            )}
          </button>
        ))}
      </nav>

      {(tab === 'labels' || tab === 'adverse') && (
        <div className="px-3 py-2 border-b border-zinc-800/40 relative">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'labels' ? 'Search a drug (brand or generic name)…' : 'Drug name to query adverse events…'}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-pink-500/40"
          />
        </div>
      )}

      <div className="max-h-[600px] overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" aria-hidden="true" />
          </div>
        )}
        {error && (
          <div className="px-3 py-3 text-xs text-rose-300/80">
            <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
            FDA unreachable ({error})
          </div>
        )}

        {tab === 'labels' && !loading && !error && (
          labels.length === 0 ? (
            <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
              {query.trim().length < 2 ? 'Type a drug name to search.' : `No FDA labels found for "${query.trim()}".`}
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {labels.map((l) => (
                <li key={l.setId} className="px-3 py-3 text-xs space-y-2">
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">{l.brandName || l.genericName || 'Unknown'}</div>
                    <div className="text-[11px] text-zinc-400">
                      {l.genericName && l.brandName && <span>generic: {l.genericName}</span>}
                      {l.manufacturer && <span> · <Building2 className="inline w-2.5 h-2.5 -mt-0.5" /> {l.manufacturer}</span>}
                      {l.route.length > 0 && <span> · {l.route.join(', ')}</span>}
                    </div>
                  </div>
                  {l.indicationsAndUsage && (
                    <details>
                      <summary className="text-[11px] font-medium text-zinc-300 cursor-pointer hover:text-pink-300">Indications</summary>
                      <p className="text-[11px] text-zinc-400 mt-1 whitespace-pre-line leading-relaxed">{l.indicationsAndUsage}</p>
                    </details>
                  )}
                  {l.warnings && (
                    <details>
                      <summary className="text-[11px] font-medium text-amber-300 cursor-pointer hover:text-amber-200">Warnings</summary>
                      <p className="text-[11px] text-zinc-400 mt-1 whitespace-pre-line leading-relaxed">{l.warnings}</p>
                    </details>
                  )}
                  {l.contraindications && (
                    <details>
                      <summary className="text-[11px] font-medium text-rose-300 cursor-pointer hover:text-rose-200">Contraindications</summary>
                      <p className="text-[11px] text-zinc-400 mt-1 whitespace-pre-line leading-relaxed">{l.contraindications}</p>
                    </details>
                  )}
                  {l.dosageAndAdministration && (
                    <details>
                      <summary className="text-[11px] font-medium text-zinc-300 cursor-pointer hover:text-pink-300">Dosage</summary>
                      <p className="text-[11px] text-zinc-400 mt-1 whitespace-pre-line leading-relaxed">{l.dosageAndAdministration}</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )
        )}

        {tab === 'adverse' && !loading && !error && (
          adverse.length === 0 ? (
            <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
              {query.trim().length < 2 ? 'Type a drug name to query FAERS.' : `No adverse events found for "${query.trim()}".`}
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {adverse.map((a, idx) => (
                <li key={idx} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-zinc-500 w-20 shrink-0">{a.reportDate}</span>
                    {a.serious && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-500/30">serious</span>
                    )}
                    <span className="text-[10px] text-zinc-500 ml-auto font-mono">
                      {a.patientSex} {a.patientAge ? `age ${a.patientAge}` : ''} {a.reportingCountry ? `· ${a.reportingCountry}` : ''}
                    </span>
                  </div>
                  {a.reactions.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.reactions.map((rx, ri) => (
                        <span key={ri} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-700">{rx}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        )}

        {tab === 'recalls' && !loading && !error && (
          recalls.length === 0 ? (
            <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
              No recent drug recalls.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {recalls.map((r) => (
                <li key={r.recallNumber} className="px-3 py-2 text-xs space-y-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-[10px] text-zinc-500 shrink-0">{r.initiationDate}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded border shrink-0',
                      r.classification === 'Class I' ? 'bg-rose-950/60 text-rose-300 border-rose-500/30'
                        : r.classification === 'Class II' ? 'bg-amber-950/60 text-amber-300 border-amber-500/30'
                        : 'bg-zinc-900 text-zinc-300 border-zinc-700',
                    )}>{r.classification}</span>
                    <span className="text-[10px] text-zinc-500 shrink-0">{r.status}</span>
                    <span className="text-[10px] text-zinc-500 ml-auto truncate font-mono">{r.recallNumber}</span>
                  </div>
                  <div className="text-zinc-200 line-clamp-2">{r.productDescription}</div>
                  <div className="text-[11px] text-zinc-400 italic line-clamp-2">{r.reason}</div>
                  <div className="text-[10px] text-zinc-500"><Building2 className="inline w-2.5 h-2.5 -mt-0.5 mr-0.5" />{r.recallingFirm}{r.state ? ` · ${r.state}` : ''}</div>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40 flex items-center gap-2">
        <span>Source: FDA OpenFDA · public domain</span>
        {tab === 'recalls' && (
          <button onClick={() => void fetchRecalls()} className="ml-auto inline-flex items-center gap-1 hover:text-zinc-300" disabled={loading}>
            <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />refresh
          </button>
        )}
      </footer>
    </section>
  );
}

export default FdaLivePanel;
