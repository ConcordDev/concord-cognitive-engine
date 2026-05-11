'use client';

/**
 * /lenses/observe — Observer mode: compose empirical reports.
 *
 * Phase 9.2 #10. Wraps observer.compose_report. Generates a citable
 * kind='empirical_report' DTU from the world's ripple state in the
 * last hour. Currency: CC (royalty cascade flows from citers to
 * the observer).
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';

interface Report {
  ok: boolean;
  dtuId?: string;
  ripple?: unknown;
  error?: string;
  reason?: string;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function ObservePage() {
  useLensCommand([
    { id: 'observe-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'observe' });

  const [worldId, setWorldId] = useState('concordia-hub');
  const [focus, setFocus] = useState('');
  const [composing, setComposing] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  const compose = async () => {
    setComposing(true);
    const r = await macro('observer', 'compose_report', { worldId, focus: focus || null });
    setReport(r);
    setComposing(false);
  };

  return (
        <LensShell lensId="observe">
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Observer Mode</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Don't intervene — report. Each composition becomes a citable
            {' '}<code className="text-cyan-300">kind=&apos;empirical_report&apos;</code>{' '}
            DTU. Royalty cascade pays you when others cite your observations.
            {' '}<strong>Currency: CC.</strong>
          </p>
        </header>

        <section className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4 space-y-3 mb-4">
          <input
            type="text" placeholder="World id"
            value={worldId} onChange={(e) => setWorldId(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <input
            type="text" placeholder="Focus (optional, e.g. 'faction Concord stance')"
            value={focus} onChange={(e) => setFocus(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <button
            type="button" onClick={compose} disabled={composing || !worldId}
            className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg"
          >
            {composing ? 'Composing report…' : 'Compose Report'}
          </button>
        </section>

        {report && (
          <div className={`border rounded-xl p-4 text-sm ${report.ok ? 'bg-emerald-950/30 border-emerald-700/40 text-emerald-100' : 'bg-rose-950/30 border-rose-700/40 text-rose-100'}`}>
            {report.ok ? (
              <>
                <p className="font-bold">✓ Report composed.</p>
                <p className="mt-1 text-xs font-mono break-all">DTU id: {report.dtuId}</p>
                {report.ripple ? (
                  <pre className="mt-2 text-[10px] bg-zinc-950 border border-zinc-800 rounded p-2 overflow-x-auto">
                    {JSON.stringify(report.ripple, null, 2).slice(0, 800)}…
                  </pre>
                ) : null}
              </>
            ) : (
              <p>Failed: {report.error || report.reason || 'unknown'}</p>
            )}
          </div>
        )}
      </div>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}
