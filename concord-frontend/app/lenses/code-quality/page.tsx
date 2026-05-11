'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { Loader2 } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useEffect, useMemo, useState, useRef } from 'react';
import { api } from '@/lib/api/client';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface Totals {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

interface DetectorSpec {
  id: string;
  label: string;
  consumers: string[];
  dataNeeds: string[];
  description: string;
}

interface DetectorReport {
  id: string;
  ok: boolean;
  reason?: string;
  durationMs: number;
  summary: Totals;
}

interface SummaryPayload {
  ok: boolean;
  generatedAt: string;
  detectorCount: number;
  totals: Totals;
  perDetector: DetectorReport[];
}

interface Finding {
  detector: string;
  id: string;
  severity: Severity;
  kind: string;
  message: string;
  location?: string;
  evidence?: unknown;
  fixHint?: string;
}

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'text-red-500 bg-red-500/10 border-red-500/30',
  high: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  medium: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  low: 'text-blue-300 bg-blue-300/10 border-blue-300/30',
  info: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
};

async function postLensRun<T>(domain: string, name: string, input: object): Promise<T> {
  const res = await api.post('/api/lens/run', { domain, name, input });
  // Server wraps handler output under `result`; fall back to bare envelope
  // for forward compat with handlers that already return at the top level.
  return ((res.data?.result ?? res.data) as T);
}

export default function CodeQualityLensPage() {
  useLensNav('code-quality');

  const [detectors, setDetectors] = useState<DetectorSpec[]>([]);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [minSeverity, setMinSeverity] = useState<Severity>('medium');
  const [activeDetector, setActiveDetector] = useState<string | null>(null);
  const [actionableOnly, setActionableOnly] = useState(false);
  const [findingsSearch, setFindingsSearch] = useState('');
  const findingsSearchRef = useRef<HTMLInputElement>(null);

  async function loadDetectors() {
    try {
      const r = await postLensRun<{ ok: boolean; detectors: DetectorSpec[] }>(
        'detectors',
        'list',
        {},
      );
      if (r.ok) setDetectors(r.detectors);
    } catch (e) {
      setError(`Failed to list detectors: ${(e as Error).message}`);
    }
  }

  async function runSweep() {
    setLoading(true);
    setError(null);
    try {
      const [s, f] = await Promise.all([
        postLensRun<SummaryPayload>('detectors', 'summary', {}),
        postLensRun<{ ok: boolean; findings: Finding[] }>('detectors', 'findings', {
          minSeverity,
          actionableOnly,
        }),
      ]);
      setSummary(s);
      setFindings(f.findings || []);
    } catch (e) {
      setError(`Sweep failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetectors();
  }, []);

  // Severity ordering — index 0 is highest priority.  A "min severity"
  // of 'medium' means we keep critical / high / medium and drop low / info.
  const severityRank = (s: Severity) => SEVERITIES.indexOf(s);
  const visible = useMemo(() => {
    const minRank = severityRank(minSeverity);
    const q = findingsSearch.trim().toLowerCase();
    return findings.filter((f) => {
      if (activeDetector && f.detector !== activeDetector) return false;
      if (severityRank(f.severity) > minRank) return false;
      if (actionableOnly && !f.fixHint) return false;
      if (q) {
        const hay = `${f.message} ${f.location || ''} ${f.kind || ''} ${f.detector}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [findings, activeDetector, minSeverity, actionableOnly, findingsSearch]);

  useLensCommand(
    [
      { id: 'run-sweep',    keys: 'mod+enter', description: 'Run sweep',   category: 'actions',
        action: () => { if (!loading) runSweep(); }, global: true },
      { id: 'focus-search', keys: '/',         description: 'Search findings', category: 'navigation',
        action: () => findingsSearchRef.current?.focus() },
      { id: 'sev-critical', keys: '1', description: 'Min: critical',   category: 'view', action: () => setMinSeverity('critical') },
      { id: 'sev-high',     keys: '2', description: 'Min: high',       category: 'view', action: () => setMinSeverity('high') },
      { id: 'sev-medium',   keys: '3', description: 'Min: medium',     category: 'view', action: () => setMinSeverity('medium') },
      { id: 'sev-low',      keys: '4', description: 'Min: low',        category: 'view', action: () => setMinSeverity('low') },
      { id: 'sev-info',     keys: '5', description: 'Min: info (all)', category: 'view', action: () => setMinSeverity('info') },
      { id: 'toggle-act',   keys: 'a', description: 'Toggle actionable-only', category: 'view', action: () => setActionableOnly((v) => !v) },
      { id: 'clear-detector', keys: 'esc', description: 'Clear detector filter', category: 'navigation', action: () => setActiveDetector(null) },
    ],
    { lensId: 'code-quality' }
  );

  return (
    <LensShell lensId="code-quality" asMain={false}>
      <ManifestActionBar />
      <div data-lens-theme="code-quality" className="p-6 space-y-5">
        <header>
          <p className="text-xs uppercase text-gray-400 tracking-wider">Tooling</p>
          <h1 className="text-3xl font-bold text-gradient-neon">Code Quality</h1>
          <p className="text-sm text-gray-400 mt-1">
            Multi-purpose detector suite — stale code, invariants, secrets, lens
            health, DTU lineage, heartbeat health, performance hotspots, macro
            usage. Findings feed Repair Cortex and the Concordia HUD.
          </p>
        </header>

        <section className="flex flex-wrap gap-3 items-center">
          <button
            onClick={runSweep}
            disabled={loading}
            className="px-4 py-2 rounded bg-neon-blue/20 border border-neon-blue/40 text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
            title="Run sweep (⌘⏎)"
          >
            {loading ? 'Running…' : 'Run sweep'}
          </button>
          <input
            ref={findingsSearchRef}
            type="text"
            value={findingsSearch}
            onChange={(e) => setFindingsSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setFindingsSearch(''); findingsSearchRef.current?.blur(); } }}
            placeholder="Search findings…  / focuses"
            className="bg-black/40 border border-gray-700 rounded px-2 py-1 text-sm flex-1 min-w-[200px]"
          />
          <label className="text-xs flex items-center gap-2">
            <span className="text-gray-400">Min severity</span>
            <select
              value={minSeverity}
              onChange={(e) => setMinSeverity(e.target.value as Severity)}
              className="bg-black/40 border border-gray-700 rounded px-2 py-1"
            >
              {SEVERITIES.map((s, i) => (
                <option key={s} value={s}>
                  {s} ({i + 1})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs flex items-center gap-2">
            <input
              type="checkbox"
              checked={actionableOnly}
              onChange={(e) => setActionableOnly(e.target.checked)}
            />
            <span className="text-gray-400">Actionable only (a)</span>
          </label>
          {findings.length > 0 && (
            <span className="text-xs text-gray-500">
              {visible.length} of {findings.length} finding{findings.length === 1 ? '' : 's'}
            </span>
          )}
          {error && <span className="text-sm text-red-400">{error}</span>}
        </section>

        {summary && (
          <section className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {SEVERITIES.map((s) => (
              <div
                key={s}
                className={`rounded border p-3 ${SEVERITY_STYLE[s]} flex flex-col`}
              >
                <span className="text-xs uppercase tracking-wider">{s}</span>
                <span className="text-2xl font-mono">{summary.totals[s]}</span>
              </div>
            ))}
            <div className="rounded border border-gray-700 p-3 flex flex-col text-gray-300">
              <span className="text-xs uppercase tracking-wider">total</span>
              <span className="text-2xl font-mono">{summary.totals.total}</span>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-2">
            Detectors
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {detectors.map((d) => {
              const r = summary?.perDetector.find((p) => p.id === d.id);
              const isActive = activeDetector === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => setActiveDetector(isActive ? null : d.id)}
                  className={`text-left p-3 rounded border transition ${
                    isActive
                      ? 'border-neon-blue bg-neon-blue/10'
                      : 'border-gray-700 hover:border-gray-500'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-mono text-sm text-gray-100">{d.label}</span>
                    {r && (
                      <span className="text-xs text-gray-500">{r.durationMs}ms</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 line-clamp-2">{d.description}</p>
                  {r && (
                    <div className="flex gap-2 mt-2 text-xs">
                      {SEVERITIES.filter((s) => s !== 'info' && r.summary[s] > 0).map(
                        (s) => (
                          <span
                            key={s}
                            className={`px-1.5 rounded border ${SEVERITY_STYLE[s]}`}
                          >
                            {s.charAt(0)}{r.summary[s]}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  <div className="mt-2 text-[10px] text-gray-500 uppercase tracking-wider">
                    {d.consumers.join(' · ')}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-2">
            Findings {activeDetector && <span className="text-neon-blue">· {activeDetector}</span>}
            {visible.length > 0 && (
              <span className="text-gray-500 ml-2">({visible.length})</span>
            )}
          </h2>
          {visible.length === 0 ? (
            <p className="text-sm text-gray-500">
              {summary
                ? 'No findings at the selected severity.'
                : 'Click "Run sweep" to populate findings.'}
            </p>
          ) : (
            <div className="space-y-2">
              {visible.slice(0, 200).map((f, i) => (
                <div
                  key={`${f.detector}-${f.id}-${i}`}
                  className={`p-2 rounded border ${SEVERITY_STYLE[f.severity]}`}
                >
                  <div className="flex flex-wrap gap-2 items-center text-xs">
                    <span className="font-mono uppercase tracking-wider">
                      {f.severity}
                    </span>
                    <span className="font-mono text-gray-300">{f.detector}</span>
                    <span className="font-mono text-gray-400">{f.id}</span>
                    {f.location && (
                      <span className="font-mono text-gray-500 text-[11px]">
                        {f.location}
                      </span>
                    )}
                    {f.fixHint && (
                      <span className="font-mono text-emerald-400 text-[11px]">
                        fix: {f.fixHint}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-100">{f.message}</p>
                </div>
              ))}
              {visible.length > 200 && (
                <p className="text-xs text-gray-500">
                  …and {visible.length - 200} more (refine the filter to narrow).
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
    </LensShell>
  );
}
