'use client';

/**
 * CorrelationPanel — surfaces cross-metric correlations from the
 * self.correlate macro ("you sleep better on workout days"). Shows a
 * ranked list of the strongest links with Pearson r and a plain-
 * language insight. No seed data: needs real overlapping readings.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Link2, ArrowRight } from 'lucide-react';

interface Link {
  metricA: string;
  metricB: string;
  r: number;
  sampleDays: number;
  insight: string;
}

export function CorrelationPanel({ refreshKey }: { refreshKey: number }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await lensRun<{ links: Link[]; scanned: boolean }>('self', 'correlate', { days: 90 });
      if (r.data?.ok && r.data.result) {
        setLinks(r.data.result.links ?? []);
        setScanned(true);
      } else {
        setLinks([]);
      }
    } catch { setLinks([]); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-rose-700">
        Pearson correlations across your last 90 days of readings. A link needs at least 5 days
        where both metrics were logged.
      </p>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
      ) : links.length > 0 ? (
        <ul className="space-y-2">
          {links.map((l) => (
            <li
              key={`${l.metricA}-${l.metricB}`}
              className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-sm font-medium text-rose-200">
                  <Link2 className="h-3.5 w-3.5 text-rose-500" aria-hidden />
                  <span>{l.metricA}</span>
                  <ArrowRight className="h-3 w-3 text-rose-700" aria-hidden />
                  <span>{l.metricB}</span>
                </div>
                <span
                  className={`font-mono text-sm font-semibold ${
                    Math.abs(l.r) >= 0.6 ? 'text-emerald-400'
                      : Math.abs(l.r) >= 0.35 ? 'text-amber-400' : 'text-rose-500'
                  }`}
                  title="Pearson correlation coefficient"
                >
                  r = {l.r >= 0 ? '+' : ''}{l.r}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-rose-400">{l.insight}</p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rose-950">
                <div
                  className={`h-full ${l.r >= 0 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, Math.abs(l.r) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-rose-800">{l.sampleDays} overlapping days</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded border border-rose-900/30 bg-rose-950/10 px-4 py-8 text-center text-xs text-rose-600">
          {scanned
            ? 'No correlations yet — log multiple metrics on the same days to surface links.'
            : 'No data yet.'}
        </p>
      )}
    </div>
  );
}
