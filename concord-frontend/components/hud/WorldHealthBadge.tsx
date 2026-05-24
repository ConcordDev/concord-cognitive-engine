'use client';

// Phase 3.4 — World Health Badge
//
// Severity-coloured badge in the HUD header bound to a 60s poll of
// detectors.summary filtered to invariant findings. Shows a count of
// active critical/high invariant warnings, plus a click-to-open detail
// flyout with location + message per finding.
//
// Defaults: visible. Set CONCORD_DETECTOR_HUD=0 in the environment to
// disable (the env check happens server-side via the detectors macro
// returning empty when the flag is off; this component is purely
// presentational).

import { useEffect, useState } from 'react';
import { Heart, AlertTriangle, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api/client';

interface DetectorReportSummary {
  id: string;
  ok: boolean;
  summary: { total: number; critical: number; high: number; medium: number; low: number; info: number };
  durationMs: number;
}

interface SummaryResponse {
  ok: boolean;
  generatedAt: string;
  detectorCount: number;
  totals: { total: number; critical: number; high: number; medium: number; low: number; info: number };
  perDetector: DetectorReportSummary[];
}

interface InvariantFinding {
  detector: string;
  id: string;
  severity: string;
  message: string;
  location?: string;
}

const POLL_INTERVAL_MS = 60_000;

export function WorldHealthBadge() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [findings, setFindings] = useState<InvariantFinding[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const s = await api.post('/api/lens/run', {
          domain: 'detectors', name: 'summary', input: {},
        });
        if (cancelled) return;
        setSummary(s.data as SummaryResponse);

        const f = await api.post('/api/lens/run', {
          domain: 'detectors', name: 'findings',
          input: { minSeverity: 'high', kinds: ['semantic', 'static'] },
        });
        if (cancelled) return;
        const data = f.data as { ok: boolean; findings: InvariantFinding[] };
        const invariants = (data.findings || []).filter((x) => x.detector === 'invariant-guardian' || x.detector === 'secret-leak');
        setFindings(invariants);
      } catch {
        /* poll silently — HUD never crashes the app */
      }
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const inv = summary?.perDetector.find((d) => d.id === 'invariant-guardian');
  const secret = summary?.perDetector.find((d) => d.id === 'secret-leak');
  const critical = (inv?.summary.critical ?? 0) + (secret?.summary.critical ?? 0);
  const high = (inv?.summary.high ?? 0) + (secret?.summary.high ?? 0);

  const isHealthy = critical === 0 && high === 0;
  const icon = isHealthy ? <ShieldCheck className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />;
  const colour = critical > 0
    ? 'bg-red-500/30 text-red-200 border-red-500/50'
    : high > 0
      ? 'bg-orange-500/30 text-orange-200 border-orange-500/50'
      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono ${colour}`}
        title={isHealthy ? 'World health: nominal' : `World health: ${critical} critical, ${high} high`}
      >
        {icon}
        <span>
          {isHealthy ? <Heart className="w-3 h-3 inline" /> : `${critical}!${high}`}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-96 max-h-96 overflow-auto rounded border border-gray-700 bg-black/90 p-3 text-xs shadow-lg z-50">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-gray-200">World Health</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-200">×</button>
          </div>
          {summary && (
            <p className="text-gray-400 mb-2">
              Last sweep: {new Date(summary.generatedAt).toLocaleTimeString()}<br />
              Detectors: {summary.detectorCount} · Total findings: {summary.totals.total}
            </p>
          )}
          {findings.length === 0 ? (
            <p className="text-emerald-300">No invariant warnings.</p>
          ) : (
            <ul className="space-y-1.5">
              {findings.slice(0, 10).map((f, i) => (
                <li key={`${f.id}-${i}`} className={`p-1.5 rounded border-l-2 ${
                  f.severity === 'critical'
                    ? 'border-red-400 bg-red-500/10'
                    : 'border-orange-400 bg-orange-500/10'
                }`}>
                  <div className="font-mono text-[10px] text-gray-400">
                    {f.severity} · {f.detector}
                  </div>
                  <div className="text-gray-100">{f.message}</div>
                  {f.location && (
                    <div className="font-mono text-[10px] text-gray-400">{f.location}</div>
                  )}
                </li>
              ))}
              {findings.length > 10 && (
                <li className="text-gray-400 italic">…and {findings.length - 10} more</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default WorldHealthBadge;
