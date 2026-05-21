'use client';

import { useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Ruler, Loader2, ArrowRight } from 'lucide-react';

interface ChainLink {
  name: string;
  nominal: number;
  tolerance: number;
  direction: number; // +1 or -1
}

interface ChainResultLink {
  index: number;
  name: string;
  direction: '+' | '-';
  nominal: number;
  tolerance: number;
  cumulativeNominal: number;
  cumulativeWorstCase: number;
}

interface ChainResult {
  chain: ChainResultLink[];
  closingDimension: {
    nominal: number;
    worstCaseTolerance: number;
    rssTolerance: number;
    worstCaseMin: number;
    worstCaseMax: number;
    rssMin: number;
    rssMax: number;
  };
  fitVerdict: {
    targetGap: number;
    worstCaseFits: boolean;
    interferenceRisk: boolean;
  } | null;
  method: string;
}

const STARTER: ChainLink[] = [
  { name: 'Housing bore', nominal: 50.0, tolerance: 0.025, direction: 1 },
  { name: 'Shaft OD', nominal: 49.95, tolerance: 0.015, direction: -1 },
  { name: 'Bearing race', nominal: 0.0, tolerance: 0.01, direction: 1 },
];

export function TolerancePanel() {
  const [links, setLinks] = useState<ChainLink[]>(STARTER);
  const [targetGap, setTargetGap] = useState<number | ''>('');
  const [result, setResult] = useState<ChainResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addLink = () =>
    setLinks((l) => [
      ...l,
      { name: `Link ${l.length + 1}`, nominal: 0, tolerance: 0.01, direction: 1 },
    ]);
  const removeLink = (idx: number) =>
    setLinks((l) => l.filter((_, n) => n !== idx));
  const setField = (idx: number, f: keyof ChainLink, v: string) => {
    setLinks((l) => {
      const next = [...l];
      const numeric: (keyof ChainLink)[] = ['nominal', 'tolerance', 'direction'];
      next[idx] = {
        ...next[idx],
        [f]: numeric.includes(f) ? parseFloat(v) || 0 : v,
      };
      return next;
    });
  };
  const flipDir = (idx: number) =>
    setLinks((l) => {
      const next = [...l];
      next[idx] = { ...next[idx], direction: next[idx].direction >= 0 ? -1 : 1 };
      return next;
    });

  const analyze = useCallback(async () => {
    setLoading(true);
    setError('');
    const r = await lensRun<ChainResult>('engineering', 'toleranceChain', {
      links,
      ...(targetGap !== '' ? { targetGap } : {}),
    });
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setError(r.data.error || 'Tolerance chain failed');
    setLoading(false);
  }, [links, targetGap]);

  // Scale factor for the visual chain bar.
  const maxCum = result
    ? Math.max(
        1e-6,
        ...result.chain.map((c) => Math.abs(c.cumulativeNominal)),
      )
    : 1;

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Ruler className="w-4 h-4 text-neon-cyan" /> Tolerance Stack-Up Chain
          </h3>
          <button
            onClick={addLink}
            className="text-xs px-2 py-1 bg-neon-cyan/20 text-neon-cyan rounded hover:bg-neon-cyan/30"
          >
            <Plus className="w-3 h-3 inline mr-1" /> Link
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-white/10">
                <th className="text-left py-1 px-2">Dimension</th>
                <th className="text-center py-1 px-2">Dir</th>
                <th className="text-right py-1 px-2">Nominal</th>
                <th className="text-right py-1 px-2">± Tol</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {links.map((l, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-1 px-2">
                    <input
                      className="w-40 bg-black/30 border border-white/10 rounded px-1"
                      value={l.name}
                      onChange={(e) => setField(i, 'name', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-2 text-center">
                    <button
                      onClick={() => flipDir(i)}
                      className={`px-2 py-0.5 rounded font-mono font-bold ${
                        l.direction >= 0
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {l.direction >= 0 ? '+' : '−'}
                    </button>
                  </td>
                  <td className="py-1 px-2 text-right">
                    <input
                      className="w-20 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={l.nominal}
                      onChange={(e) => setField(i, 'nominal', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-2 text-right">
                    <input
                      className="w-20 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={l.tolerance}
                      onChange={(e) => setField(i, 'tolerance', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-1">
                    <button
                      onClick={() => removeLink(i)}
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Delete link"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-gray-400">
              Target Gap (optional — fit check)
            </label>
            <input
              type="number"
              step="0.001"
              value={targetGap}
              placeholder="—"
              onChange={(e) =>
                setTargetGap(
                  e.target.value === '' ? '' : parseFloat(e.target.value) || 0,
                )
              }
              className="w-32 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm font-mono block mt-1"
            />
          </div>
          <button
            onClick={analyze}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-neon-cyan text-black rounded-lg text-sm font-semibold hover:bg-neon-cyan/90 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Ruler className="w-4 h-4" />
            )}
            Analyze Stack-Up
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {result && (
        <>
          {/* Visual chain */}
          <div className="panel p-4 space-y-2">
            <h3 className="font-semibold text-sm">Visual Chain</h3>
            <div className="space-y-1.5">
              {result.chain.map((c) => {
                const pct =
                  (Math.abs(c.cumulativeNominal) / maxCum) * 100;
                return (
                  <div key={c.index} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-32 truncate">
                      {c.name}
                    </span>
                    <span
                      className={`text-xs font-mono font-bold w-5 ${
                        c.direction === '+'
                          ? 'text-green-400'
                          : 'text-red-400'
                      }`}
                    >
                      {c.direction}
                    </span>
                    <div className="flex-1 h-5 bg-black/30 rounded overflow-hidden relative">
                      <div
                        className={`h-full ${
                          c.direction === '+'
                            ? 'bg-green-500/40'
                            : 'bg-red-500/40'
                        }`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                      <span className="absolute inset-0 flex items-center px-2 text-xs font-mono">
                        {c.nominal.toFixed(3)} ±{c.tolerance.toFixed(3)}
                      </span>
                    </div>
                    <ArrowRight className="w-3 h-3 text-gray-600" />
                    <span className="text-xs font-mono text-neon-cyan w-20 text-right">
                      Σ {c.cumulativeNominal.toFixed(3)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Closing dimension */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="panel p-3 text-center">
              <p className="text-xs text-gray-400">Closing Nominal</p>
              <p className="text-lg font-mono font-bold text-neon-cyan">
                {result.closingDimension.nominal.toFixed(4)}
              </p>
            </div>
            <div className="panel p-3 text-center">
              <p className="text-xs text-gray-400">Worst-Case ±</p>
              <p className="text-lg font-mono font-bold text-orange-400">
                ±{result.closingDimension.worstCaseTolerance.toFixed(4)}
              </p>
            </div>
            <div className="panel p-3 text-center">
              <p className="text-xs text-gray-400">RSS (statistical) ±</p>
              <p className="text-lg font-mono font-bold text-purple-400">
                ±{result.closingDimension.rssTolerance.toFixed(4)}
              </p>
            </div>
            <div className="panel p-3 text-center">
              <p className="text-xs text-gray-400">Worst-Case Range</p>
              <p className="text-sm font-mono text-gray-300">
                {result.closingDimension.worstCaseMin.toFixed(3)} …{' '}
                {result.closingDimension.worstCaseMax.toFixed(3)}
              </p>
            </div>
          </div>

          {/* Fit verdict */}
          {result.fitVerdict && (
            <div
              className={`panel p-4 flex items-center gap-3 ${
                result.fitVerdict.worstCaseFits
                  ? 'border-green-500/30'
                  : 'border-red-500/30'
              }`}
            >
              <div
                className={`text-2xl font-bold ${
                  result.fitVerdict.worstCaseFits
                    ? 'text-green-400'
                    : 'text-red-400'
                }`}
              >
                {result.fitVerdict.worstCaseFits ? '✓' : '✗'}
              </div>
              <div>
                <p className="text-sm">
                  Target gap {result.fitVerdict.targetGap} —{' '}
                  {result.fitVerdict.worstCaseFits
                    ? 'fits within worst-case envelope'
                    : 'OUTSIDE worst-case envelope'}
                </p>
                {result.fitVerdict.interferenceRisk && (
                  <p className="text-xs text-red-400">
                    ⚠ Interference risk — minimum gap is negative.
                  </p>
                )}
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500">{result.method}</p>
        </>
      )}
    </div>
  );
}
