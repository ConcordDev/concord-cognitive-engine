'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { CQPRResult } from './types';
import { CQ_SEVERITY_STYLE } from './types';

const VERDICT_STYLE: Record<CQPRResult['verdict'], string> = {
  BLOCK: 'text-red-500 border-red-500/40 bg-red-500/10',
  WARN: 'text-orange-400 border-orange-400/40 bg-orange-400/10',
  COMMENT: 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10',
  APPROVE: 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10',
};

export function PRDecorationPanel() {
  const [path, setPath] = useState('changed.js');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [result, setResult] = useState<CQPRResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decorate() {
    if (!head.trim()) {
      setError('Provide the new (head) version of the file.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun<CQPRResult>('code-quality', 'decoratePR', {
        base: base.trim() ? [{ path: path.trim() || 'file', content: base }] : [],
        head: [{ path: path.trim() || 'file', content: head }],
      });
      if (r.data.ok && r.data.result) setResult(r.data.result);
      else setError(r.data.error || 'decoratePR failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Paste the before / after versions of a changed file — the analyzer
        fingerprints findings (line-shift tolerant) and reports exactly which
        issues this diff introduces, fixes, or leaves unchanged.
      </p>
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="file path"
        className="bg-black/40 border border-gray-700 rounded px-2 py-1 text-sm w-48 font-mono"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-400 mb-1">Base (before)</p>
          <textarea
            value={base}
            onChange={(e) => setBase(e.target.value)}
            spellCheck={false}
            placeholder="base version — leave empty to treat the file as new"
            className="w-full h-40 bg-black/50 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono text-gray-200 resize-y"
          />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Head (after)</p>
          <textarea
            value={head}
            onChange={(e) => setHead(e.target.value)}
            spellCheck={false}
            placeholder="head version — the changed file"
            className="w-full h-40 bg-black/50 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono text-gray-200 resize-y"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={decorate}
          disabled={busy}
          className="px-4 py-1.5 rounded bg-neon-blue/20 border border-neon-blue/40 text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50 text-sm"
        >
          {busy ? 'Decorating…' : 'Decorate diff'}
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {result && (
        <div className="space-y-3">
          <div className={`rounded-lg border p-3 ${VERDICT_STYLE[result.verdict]}`}>
            <span className="text-xl font-bold">{result.verdict}</span>
            <p className="text-sm text-gray-300 mt-0.5">{result.verdictReason}</p>
            <div className="flex flex-wrap gap-4 mt-2 text-sm">
              <span className="text-red-400">+{result.summary.newIssues} new</span>
              <span className="text-emerald-400">−{result.summary.fixedIssues} fixed</span>
              <span className="text-gray-400">{result.summary.unchangedIssues} unchanged</span>
              <span className="text-gray-300">
                net {result.summary.netChange >= 0 ? '+' : ''}
                {result.summary.netChange}
              </span>
            </div>
          </div>

          {result.files.map((f) => (
            <div key={f.file} className="rounded border border-gray-800">
              <div className="flex items-center justify-between border-b border-gray-800 px-3 py-1.5 bg-black/40">
                <span className="font-mono text-sm text-gray-200">
                  {f.file} {f.isNew && <span className="text-emerald-400">(new file)</span>}
                </span>
                <span className="text-xs text-gray-500">
                  MI Δ {f.maintainabilityDelta >= 0 ? '+' : ''}
                  {f.maintainabilityDelta}
                </span>
              </div>
              {f.newIssues.length === 0 ? (
                <p className="px-3 py-2 text-sm text-emerald-400">
                  No new issues introduced.
                </p>
              ) : (
                <div className="divide-y divide-gray-900">
                  {f.newIssues.map((iss, i) => (
                    <div
                      key={`${iss.rule}-${iss.line}-${i}`}
                      className={`px-3 py-2 border-l-2 ${CQ_SEVERITY_STYLE[iss.severity]}`}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono uppercase tracking-wider">
                          {iss.severity}
                        </span>
                        <span className="font-mono text-gray-300">{iss.rule}</span>
                        <span className="font-mono text-gray-500">L{iss.line}</span>
                      </div>
                      <p className="mt-1 text-sm text-gray-100">{iss.message}</p>
                      {iss.fixHint && (
                        <p className="text-xs text-emerald-400 mt-0.5">fix: {iss.fixHint}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
