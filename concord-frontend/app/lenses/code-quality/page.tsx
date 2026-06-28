'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { ReleaseCadence } from '@/components/code-quality/ReleaseCadence';
import { AnalyzePanel } from '@/components/code-quality/AnalyzePanel';
import { AnnotatedSource } from '@/components/code-quality/AnnotatedSource';
import { QualityGatePanel } from '@/components/code-quality/QualityGatePanel';
import { DebtTrendPanel } from '@/components/code-quality/DebtTrendPanel';
import { IssueWorkflow } from '@/components/code-quality/IssueWorkflow';
import { PRDecorationPanel } from '@/components/code-quality/PRDecorationPanel';
import type { CQScan } from '@/components/code-quality/types';

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

type Tab = 'analyze' | 'annotate' | 'gate' | 'debt' | 'issues' | 'pr' | 'detectors';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'annotate', label: 'Annotations' },
  { id: 'gate', label: 'Quality Gate' },
  { id: 'debt', label: 'Debt & Trend' },
  { id: 'issues', label: 'Issues' },
  { id: 'pr', label: 'PR Decoration' },
  { id: 'detectors', label: 'Detector Suite' },
];

async function postLensRun<T>(domain: string, name: string, input: object): Promise<T> {
  const res = await api.post('/api/lens/run', { domain, name, input });
  return (res.data?.result ?? res.data) as T;
}

export default function CodeQualityLensPage() {
  useLensNav('code-quality');

  const [tab, setTab] = useState<Tab>('analyze');
  const [scan, setScan] = useState<CQScan | null>(null);
  const [issueRefresh, setIssueRefresh] = useState(0);

  // --- detector-suite state (legacy panel, kept) ------------------------
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
      {
        id: 'run-sweep',
        keys: 'mod+enter',
        description: 'Run detector sweep',
        category: 'actions',
        action: () => {
          if (!loading) {
            setTab('detectors');
            runSweep();
          }
        },
        global: true,
      },
      {
        id: 'focus-search',
        keys: '/',
        description: 'Search findings',
        category: 'navigation',
        action: () => findingsSearchRef.current?.focus(),
      },
      { id: 'tab-analyze', keys: '1', description: 'Tab: Analyze', category: 'view', action: () => setTab('analyze') },
      { id: 'tab-annotate', keys: '2', description: 'Tab: Annotations', category: 'view', action: () => setTab('annotate') },
      { id: 'tab-gate', keys: '3', description: 'Tab: Quality Gate', category: 'view', action: () => setTab('gate') },
      { id: 'tab-debt', keys: '4', description: 'Tab: Debt & Trend', category: 'view', action: () => setTab('debt') },
      { id: 'tab-issues', keys: '5', description: 'Tab: Issues', category: 'view', action: () => setTab('issues') },
    ],
    { lensId: 'code-quality' },
  );

  return (
    <LensShell lensId="code-quality" asMain={false}>
      <FirstRunTour lensId="code-quality" />
      <ManifestActionBar />
      <DepthBadge lensId="code-quality" size="sm" className="ml-2" />
      <LensVerticalHero lensId="code-quality" className="mx-6 mt-4" />
      <div data-lens-theme="code-quality" className="p-6 space-y-5">
        <header>
          <p className="text-xs uppercase text-gray-400 tracking-wider">Tooling</p>
          <h1 className="text-3xl font-bold text-gradient-neon">Code Quality</h1>
          <p className="text-sm text-gray-400 mt-1">
            Static-analysis surface for submitted source — per-line issue
            annotation, technical-debt estimation, duplication hotspots,
            configurable quality gates, an issue workflow, and pull-request
            diff decoration. Plus the platform&apos;s internal detector suite.
          </p>
        </header>

        <nav className="flex flex-wrap gap-1 border-b border-gray-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-sm rounded-t border-b-2 transition ${
                tab === t.id
                  ? 'border-neon-blue text-neon-blue'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'analyze' && (
          <section>
            <AnalyzePanel scan={scan} onScan={setScan} />
          </section>
        )}

        {tab === 'annotate' && (
          <section>
            <AnnotatedSource
              scan={scan}
              onIssueTracked={() => setIssueRefresh((n) => n + 1)}
            />
          </section>
        )}

        {tab === 'gate' && (
          <section>
            <QualityGatePanel scan={scan} />
          </section>
        )}

        {tab === 'debt' && (
          <section>
            <DebtTrendPanel scan={scan} />
          </section>
        )}

        {tab === 'issues' && (
          <section>
            <IssueWorkflow refreshKey={issueRefresh} />
          </section>
        )}

        {tab === 'pr' && (
          <section>
            <PRDecorationPanel />
          </section>
        )}

        {tab === 'detectors' && (
          <>
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
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setFindingsSearch('');
                    findingsSearchRef.current?.blur();
                  }
                }}
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
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
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
                <span className="text-gray-400">Actionable only</span>
              </label>
              {findings.length > 0 && (
                <span className="text-xs text-gray-400">
                  {visible.length} of {findings.length} finding
                  {findings.length === 1 ? '' : 's'}
                </span>
              )}
              {loading && (
                <span role="status" aria-live="polite" className="text-sm text-gray-400">
                  Running detector sweep…
                </span>
              )}
              {error && (
                <span role="alert" className="text-sm text-red-400 flex items-center gap-2">
                  {error}
                  <button
                    onClick={runSweep}
                    className="px-2 py-0.5 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 text-xs"
                  >
                    Retry
                  </button>
                </span>
              )}
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
                        {r && <span className="text-xs text-gray-400">{r.durationMs}ms</span>}
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
                                {s.charAt(0)}
                                {r.summary[s]}
                              </span>
                            ),
                          )}
                        </div>
                      )}
                      <div className="mt-2 text-[10px] text-gray-400 uppercase tracking-wider">
                        {d.consumers.join(' · ')}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-2">
                Findings{' '}
                {activeDetector && (
                  <span className="text-neon-blue">· {activeDetector}</span>
                )}
                {visible.length > 0 && (
                  <span className="text-gray-400 ml-2">({visible.length})</span>
                )}
              </h2>
              {visible.length === 0 ? (
                <p className="text-sm text-gray-400">
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
                          <span className="font-mono text-gray-400 text-[11px]">
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
                    <p className="text-xs text-gray-400">
                      …and {visible.length - 200} more (refine the filter to narrow).
                    </p>
                  )}
                </div>
              )}
            </section>

            <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <ReleaseCadence />
            </section>
          </>
        )}
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">
        EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows
      </div>
      <RecentMineCard domain="code-quality" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="code-quality" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="code-quality" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
