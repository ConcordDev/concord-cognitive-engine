'use client';


/**
 * SentinelIntel — real-world intel feeds (the `intel` macro domain) plus a
 * one-click "log to timeline" so an intel observation becomes a tracked
 * event. Wires intel.<domain> + sentinel.timeline.record.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Radio, Loader2, ClipboardCheck } from 'lucide-react';

const INTEL_DOMAINS = [
  'weather', 'geology', 'energy', 'ocean', 'seismic', 'agriculture', 'environment',
] as const;
type IntelDomain = (typeof INTEL_DOMAINS)[number];

export function SentinelIntel({ onChanged }: { onChanged?: () => void }) {
  const [domain, setDomain] = useState<IntelDomain>('weather');
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [recorded, setRecorded] = useState(false);

  async function fetchIntel() {
    setLoading(true);
    setRecorded(false);
    const r = await lensRun('intel', domain, {});
    setResult(r.data?.ok === false ? { error: r.data.error } : (r.data?.result ?? r.data));
    setLoading(false);
  }

  async function logToTimeline() {
    if (result == null) return;
    const summary = typeof result === 'object'
      ? Object.keys(result as Record<string, unknown>).slice(0, 4).join(', ')
      : String(result);
    const r = await lensRun('sentinel', 'timeline.record', {
      kind: 'intel_observation',
      label: `Intel pull: ${domain}`,
      tone: 'info',
      detail: summary,
    });
    if (r.data?.ok) {
      setRecorded(true);
      onChanged?.();
    }
  }

  return (
    <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
        <Radio className="h-4 w-4" /> Real-world intel feeds
      </h3>
      <div className="mb-3 flex flex-wrap gap-1">
        {INTEL_DOMAINS.map((d) => (
          <button
            key={d}
            onClick={() => setDomain(d)}
            className={`rounded px-2 py-1 text-xs capitalize ${
              domain === d ? 'bg-blue-700/40 text-blue-100' : 'bg-blue-950/30 text-blue-500 hover:text-blue-300'
            }`}
            aria-pressed={domain === d}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          disabled={loading}
          onClick={fetchIntel}
          className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
          Fetch {domain}
        </button>
        {result != null && (
          <button
            disabled={recorded}
            onClick={logToTimeline}
            className="inline-flex items-center gap-2 rounded bg-blue-950/40 px-3 py-1.5 text-sm text-blue-300 hover:text-blue-100 disabled:opacity-50"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            {recorded ? 'Logged to timeline' : 'Log to timeline'}
          </button>
        )}
      </div>
      {result != null && (
        <pre className="mt-4 max-h-80 overflow-auto rounded border border-blue-900/40 bg-black/60 p-3 font-mono text-[11px] text-blue-300">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
