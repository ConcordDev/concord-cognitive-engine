'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { CQScan } from './types';
import { CQ_SEVERITIES, CQ_SEVERITY_STYLE } from './types';

const SAMPLE = `function processOrder(order, user, db, cfg, logger, retries) {
  var total = 0;
  if (order != null) {
    for (let i = 0; i < order.items.length; i++) {
      if (order.items[i].price > 0) {
        if (order.items[i].qty > 0) {
          if (order.items[i].taxable) {
            total += order.items[i].price * order.items[i].qty * 1.0825;
          } else {
            total += order.items[i].price * order.items[i].qty;
          }
        }
      }
    }
  }
  console.log('order total', total);
  try {
    db.save(order);
  } catch (e) {}
  return total;
}`;

function gradeColor(grade: string): string {
  if (grade === 'A') return 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10';
  if (grade === 'B') return 'text-lime-400 border-lime-400/40 bg-lime-400/10';
  if (grade === 'C') return 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10';
  if (grade === 'D') return 'text-orange-400 border-orange-400/40 bg-orange-400/10';
  return 'text-red-500 border-red-500/40 bg-red-500/10';
}

export function AnalyzePanel({
  scan,
  onScan,
}: {
  scan: CQScan | null;
  onScan: (scan: CQScan) => void;
}) {
  const [path, setPath] = useState('snippet.js');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    const content = source.trim();
    if (!content) {
      setError('Paste source code to analyze.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun<CQScan>('code-quality', 'analyze', {
        files: [{ path: path.trim() || 'snippet', content }],
      });
      if (r.data.ok && r.data.result) onScan(r.data.result);
      else setError(r.data.error || 'analyze failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const m = scan?.metrics;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="file path (sets language)"
          className="bg-black/40 border border-gray-700 rounded px-2 py-1 text-sm w-48 font-mono"
        />
        <button
          onClick={() => setSource(SAMPLE)}
          className="px-3 py-1 rounded border border-gray-700 text-xs text-gray-300 hover:border-gray-500"
        >
          Load example
        </button>
        <button
          onClick={analyze}
          disabled={busy}
          className="px-4 py-1.5 rounded bg-neon-blue/20 border border-neon-blue/40 text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {busy ? 'Analyzing…' : 'Analyze source'}
        </button>
        {busy && (
          <span
            role="status"
            aria-busy="true"
            aria-live="polite"
            data-testid="cq-analyze-loading"
            className="text-sm text-gray-400"
          >
            Analyzing source…
          </span>
        )}
        {error && (
          <span
            role="alert"
            data-testid="cq-analyze-error"
            className="text-sm text-red-400 flex items-center gap-2"
          >
            {error}
            <button
              onClick={analyze}
              className="px-2 py-0.5 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 text-xs"
            >
              Retry
            </button>
          </span>
        )}
      </div>

      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="Paste a source file here — the analyzer tokenizes it and reports complexity, smells, duplication and a maintainability grade."
        spellCheck={false}
        className="w-full h-56 bg-black/50 border border-gray-700 rounded px-3 py-2 text-xs font-mono text-gray-200 resize-y"
      />

      {!scan && !busy && (
        <p className="text-sm text-gray-400" data-testid="cq-analyze-empty">
          No scan yet — paste source code above (or Load example) and Analyze to
          see a maintainability grade, per-line findings, complexity and
          duplication metrics.
        </p>
      )}

      {scan && m && (
        <div className="space-y-3" data-testid="cq-analyze-result">
          <div className="flex flex-wrap items-center gap-3">
            <div className={`rounded-lg border px-4 py-2 ${gradeColor(scan.grade)}`}>
              <span className="text-xs uppercase tracking-wider block">grade</span>
              <span className="text-3xl font-bold leading-none">{scan.grade}</span>
            </div>
            <div className="rounded border border-gray-700 px-3 py-2">
              <span className="text-xs uppercase tracking-wider text-gray-400 block">maintainability</span>
              <span className="text-2xl font-mono text-gray-100">{m.maintainability}</span>
            </div>
            <div className="rounded border border-gray-700 px-3 py-2">
              <span className="text-xs uppercase tracking-wider text-gray-400 block">tech debt</span>
              <span className="text-2xl font-mono text-gray-100">{m.debtHours}h</span>
            </div>
            <div className="rounded border border-gray-700 px-3 py-2">
              <span className="text-xs uppercase tracking-wider text-gray-400 block">duplication</span>
              <span className="text-2xl font-mono text-gray-100">{m.duplicationPct}%</span>
            </div>
            <div className="rounded border border-gray-700 px-3 py-2">
              <span className="text-xs uppercase tracking-wider text-gray-400 block">max complexity</span>
              <span className="text-2xl font-mono text-gray-100">{m.maxComplexity}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {CQ_SEVERITIES.map((s) => (
              <div key={s} className={`rounded border p-2 ${CQ_SEVERITY_STYLE[s]} flex flex-col`}>
                <span className="text-[10px] uppercase tracking-wider">{s}</span>
                <span className="text-xl font-mono">{scan.totals[s]}</span>
              </div>
            ))}
            <div className="rounded border border-gray-700 p-2 flex flex-col text-gray-300">
              <span className="text-[10px] uppercase tracking-wider">total</span>
              <span className="text-xl font-mono">{scan.totals.total}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Stat label="code lines" value={m.codeLines} />
            <Stat label="comment density" value={`${m.commentDensity}%`} />
            <Stat label="functions" value={m.functionCount} />
            <Stat label="avg complexity" value={m.avgComplexity} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-gray-800 bg-black/30 px-2 py-1.5">
      <span className="text-gray-400 uppercase tracking-wider text-[10px] block">{label}</span>
      <span className="font-mono text-gray-200">{value}</span>
    </div>
  );
}
