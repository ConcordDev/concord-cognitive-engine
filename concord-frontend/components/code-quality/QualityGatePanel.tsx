'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { CQGate, CQGateVerdict, CQScan } from './types';

const NUM_FIELDS: Array<{ key: keyof CQGate; label: string }> = [
  { key: 'maxCritical', label: 'Max critical' },
  { key: 'maxHigh', label: 'Max high' },
  { key: 'maxBlockerDebtHours', label: 'Max debt (h)' },
  { key: 'minMaintainability', label: 'Min maintainability' },
  { key: 'maxDuplicationPct', label: 'Max duplication %' },
];

export function QualityGatePanel({ scan }: { scan: CQScan | null }) {
  const [gate, setGate] = useState<CQGate | null>(null);
  const [verdict, setVerdict] = useState<CQGateVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    lensRun<{ gate: CQGate }>('code-quality', 'getGate', {}).then((r) => {
      if (r.data.ok && r.data.result) setGate(r.data.result.gate);
      else setError(r.data.error || 'getGate failed');
    });
  }, []);

  async function saveGate() {
    if (!gate) return;
    setSaving(true);
    setError(null);
    try {
      const r = await lensRun<{ gate: CQGate }>('code-quality', 'setGate', {
        ...gate,
      } as Record<string, unknown>);
      if (r.data.ok && r.data.result) setGate(r.data.result.gate);
      else setError(r.data.error || 'setGate failed');
    } finally {
      setSaving(false);
    }
  }

  async function evaluate() {
    if (!scan) {
      setError('Analyze a file first.');
      return;
    }
    setError(null);
    const r = await lensRun<CQGateVerdict>('code-quality', 'evaluateGate', {
      scanId: scan.scanId,
    });
    if (r.data.ok && r.data.result) setVerdict(r.data.result);
    else setError(r.data.error || 'evaluateGate failed');
  }

  if (!gate) return <p className="text-sm text-gray-500">Loading gate config…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {NUM_FIELDS.map((f) => (
          <label key={f.key} className="text-xs flex flex-col gap-1">
            <span className="text-gray-400">{f.label}</span>
            <input
              type="number"
              min={0}
              value={gate[f.key] as number}
              onChange={(e) =>
                setGate({ ...gate, [f.key]: Math.max(0, Number(e.target.value)) })
              }
              className="bg-black/40 border border-gray-700 rounded px-2 py-1 font-mono text-sm"
            />
          </label>
        ))}
        <label className="text-xs flex items-center gap-2 mt-5">
          <input
            type="checkbox"
            checked={gate.blockOnNewCritical}
            onChange={(e) => setGate({ ...gate, blockOnNewCritical: e.target.checked })}
          />
          <span className="text-gray-400">Block on new critical</span>
        </label>
      </div>

      <div className="flex gap-2 items-center">
        <button
          onClick={saveGate}
          disabled={saving}
          className="px-3 py-1.5 rounded border border-gray-700 text-sm text-gray-200 hover:border-gray-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save gate'}
        </button>
        <button
          onClick={evaluate}
          disabled={!scan}
          className="px-4 py-1.5 rounded bg-neon-blue/20 border border-neon-blue/40 text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50 text-sm"
        >
          Evaluate latest scan
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {verdict && (
        <div
          className={`rounded-lg border p-3 ${
            verdict.passed
              ? 'border-emerald-500/40 bg-emerald-500/10'
              : 'border-red-500/40 bg-red-500/10'
          }`}
        >
          <div className="flex items-center gap-3">
            <span
              className={`text-2xl font-bold ${
                verdict.passed ? 'text-emerald-400' : 'text-red-500'
              }`}
            >
              {verdict.status}
            </span>
            <span className="text-sm text-gray-300">
              {verdict.failedCount} check{verdict.failedCount === 1 ? '' : 's'} failed
              {verdict.newCriticalCount != null && (
                <> · {verdict.newCriticalCount} new critical vs prior scan</>
              )}
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            {verdict.checks.map((c) => (
              <div
                key={c.name}
                className="flex items-center gap-2 text-sm"
              >
                <span
                  className={`font-mono text-xs px-1.5 rounded ${
                    c.pass
                      ? 'text-emerald-400 bg-emerald-400/10'
                      : 'text-red-400 bg-red-400/10'
                  }`}
                >
                  {c.pass ? 'PASS' : 'FAIL'}
                </span>
                <span className="font-mono text-gray-300">{c.name}</span>
                <span className="text-gray-500 text-xs">{c.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
