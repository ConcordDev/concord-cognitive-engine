'use client';

/**
 * ClauseExtractor — paste raw contract text, auto-detect clauses,
 * dates, monetary amounts and obligation sentences, then optionally
 * apply the extracted clauses to a contract. Backlog item 2.
 * Wires law.clause-extract + law.clause-extract-apply.
 */

import { useState } from 'react';
import { ScanText, Loader2, CheckCircle, CalendarDays, DollarSign, ListChecks } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ExtractedClause { title: string; text: string; wordCount: number }
interface ExtractResult {
  clauses: ExtractedClause[]; clauseCount: number;
  detectedDates: string[]; detectedAmounts: string[]; obligations: string[];
  stats: { lines: number; sentences: number; chars: number };
}

export function ClauseExtractor({ contractId, onApplied }: { contractId: string | null; onApplied?: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(0);

  async function extract() {
    if (!text.trim()) { setErr('Paste contract text first.'); return; }
    setBusy(true); setErr(null); setApplied(0);
    const r = await lensRun('law', 'clause-extract', { text });
    setBusy(false);
    if (r.data?.ok) {
      const res = r.data.result as ExtractResult;
      setResult(res);
      setPicked(new Set(res.clauses.map((_, i) => i)));
    } else { setErr(r.data?.error || 'Extraction failed.'); setResult(null); }
  }

  function toggle(i: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function apply() {
    if (!contractId || !result) return;
    const clauses = result.clauses.filter((_, i) => picked.has(i));
    if (clauses.length === 0) { setErr('Select at least one clause.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('law', 'clause-extract-apply', { contractId, clauses });
    setBusy(false);
    if (r.data?.ok) { setApplied(r.data.result.added as number); onApplied?.(); }
    else { setErr(r.data?.error || 'Apply failed.'); }
  }

  return (
    <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ScanText className="w-4 h-4 text-neon-cyan" />
        <h3 className="text-sm font-semibold text-white">AI Clause Extraction</h3>
      </div>
      <p className="text-[11px] text-gray-500">
        Paste a contract — clauses, dates, amounts and obligations are detected automatically.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the full text of an uploaded contract here…"
        rows={6}
        className="w-full bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white font-mono"
      />
      <div className="flex items-center gap-2">
        <button onClick={extract} disabled={busy}
          className="px-3 py-1.5 text-xs rounded bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanText className="w-3 h-3" />}
          Extract
        </button>
        {result && contractId && (
          <button onClick={apply} disabled={busy || picked.size === 0}
            className="px-3 py-1.5 text-xs rounded bg-neon-green/20 text-neon-green hover:bg-neon-green/30 disabled:opacity-50 inline-flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            Add {picked.size} clause{picked.size !== 1 ? 's' : ''} to contract
          </button>
        )}
        {applied > 0 && <span className="text-[11px] text-neon-green">Added {applied} clause{applied !== 1 ? 's' : ''}.</span>}
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}

      {result && (
        <div className="space-y-2.5 pt-1">
          {(result.detectedDates.length > 0 || result.detectedAmounts.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {result.detectedDates.map((d, i) => (
                <span key={`d${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-400/15 text-blue-300 inline-flex items-center gap-1">
                  <CalendarDays className="w-2.5 h-2.5" />{d}
                </span>
              ))}
              {result.detectedAmounts.map((a, i) => (
                <span key={`a${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-300 inline-flex items-center gap-1">
                  <DollarSign className="w-2.5 h-2.5" />{a}
                </span>
              ))}
            </div>
          )}

          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
              Detected clauses ({result.clauseCount})
            </p>
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {result.clauses.map((cl, i) => (
                <label key={i} className="flex items-start gap-2 bg-black/40 rounded px-2 py-1.5 cursor-pointer">
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)}
                    className="mt-0.5 accent-neon-cyan" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">{cl.title}</p>
                    <p className="text-[10px] text-gray-500 line-clamp-2">{cl.text}</p>
                  </div>
                  <span className="text-[9px] text-gray-600 shrink-0">{cl.wordCount}w</span>
                </label>
              ))}
            </div>
          </div>

          {result.obligations.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1 inline-flex items-center gap-1">
                <ListChecks className="w-3 h-3" />Obligations ({result.obligations.length})
              </p>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {result.obligations.map((o, i) => (
                  <li key={i} className="text-[10px] text-gray-400 bg-black/30 rounded px-2 py-1">{o}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
