'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TreeDiagram, TimelineView } from '@/components/viz';
import type { TreeNode, TimelineEvent } from '@/components/viz';
import {
  FolderSearch, Loader2, Trash2, GitFork, Flame, Map as MapIcon,
  DollarSign, Cloud, TrendingUp, Camera, FileCode, AlertTriangle,
} from 'lucide-react';

interface LanguageStat { language: string; linesOfCode: number; pctOfCodebase: number; legacy: boolean; }
interface ScanSummary {
  fileCount: number; totalLinesOfCode: number; productionFiles: number;
  testFiles: number; testToCodeRatio: number; avgComplexity: number;
  totalTodos: number; legacyLanguageFiles: number; avgCommentRatio: number;
}
interface Codebase {
  id: string; name: string; scannedAt: string;
  languages: LanguageStat[]; summary: ScanSummary;
}

type Tab = 'graph' | 'hotspots' | 'roadmap' | 'roi' | 'cloud' | 'trend';

const LANG_PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444', '#84cc16'];

export function CodebaseScanner() {
  const [codebases, setCodebases] = useState<Codebase[]>([]);
  const [active, setActive] = useState<Codebase | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('graph');

  // scan form
  const [scanName, setScanName] = useState('');
  const [scanText, setScanText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);

  // analysis results
  const [analysis, setAnalysis] = useState<Record<Tab, any>>({} as Record<Tab, any>);
  const [analyzing, setAnalyzing] = useState<Tab | null>(null);
  const [snapMsg, setSnapMsg] = useState<string | null>(null);

  const loadCodebases = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun('legacy', 'listCodebases', {});
    if (data.ok && data.result) {
      const list = (data.result as any).codebases as Codebase[];
      setCodebases(list);
      if (list.length > 0 && !active) setActive(list[0]);
    }
    setLoading(false);
  }, [active]);

  useEffect(() => { loadCodebases(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Parse pasted multi-file text. Format: lines starting with "=== path ===" delimit files.
  const parseFiles = (raw: string): { path: string; content: string }[] => {
    const lines = raw.split('\n');
    const files: { path: string; content: string }[] = [];
    let cur: { path: string; content: string } | null = null;
    const hdr = /^===\s*(.+?)\s*===$/;
    for (const line of lines) {
      const m = line.match(hdr);
      if (m) {
        if (cur) files.push(cur);
        cur = { path: m[1], content: '' };
      } else if (cur) {
        cur.content += (cur.content ? '\n' : '') + line;
      }
    }
    if (cur) files.push(cur);
    // single file fallback — treat whole blob as one file
    if (files.length === 0 && raw.trim()) {
      files.push({ path: scanName.trim() || 'pasted.txt', content: raw });
    }
    return files;
  };

  const runScan = async () => {
    setScanErr(null);
    const files = parseFiles(scanText);
    if (files.length === 0) { setScanErr('Paste source code to scan. Delimit multiple files with "=== path/to/file.ext ===" headers.'); return; }
    setScanning(true);
    const { data } = await lensRun('legacy', 'scanCodebase', {
      name: scanName.trim() || 'untitled-codebase',
      files,
    });
    setScanning(false);
    if (!data.ok) { setScanErr(data.error || 'Scan failed.'); return; }
    setScanName(''); setScanText('');
    setAnalysis({} as Record<Tab, any>);
    const cb = (data.result as any).codebase as Codebase;
    await loadCodebases();
    setActive(cb);
  };

  const deleteCodebase = async (id: string) => {
    await lensRun('legacy', 'deleteCodebase', { id });
    if (active?.id === id) setActive(null);
    setAnalysis({} as Record<Tab, any>);
    await loadCodebases();
  };

  const runAnalysis = useCallback(async (which: Tab, cb: Codebase) => {
    setAnalyzing(which);
    const macro = which === 'graph' ? 'dependencyGraph'
      : which === 'hotspots' ? 'hotspotRanking'
      : which === 'roadmap' ? 'migrationRoadmap'
      : which === 'roi' ? 'modernizationROI'
      : which === 'cloud' ? 'cloudReadiness'
      : 'debtTrend';
    const input = which === 'trend' ? { codebaseId: cb.id } : { codebaseId: cb.id };
    const { data } = await lensRun('legacy', macro, input);
    setAnalyzing(null);
    setAnalysis((prev) => ({ ...prev, [which]: data.ok ? data.result : { error: data.error } }));
  }, []);

  // auto-run the active tab's analysis when codebase or tab changes
  useEffect(() => {
    if (active && !analysis[tab] && analyzing !== tab) runAnalysis(tab, active);
  }, [active, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const recordSnapshot = async () => {
    if (!active) return;
    // derive debt from a hotspotRanking-based estimate using avg complexity
    const totalDebt = Math.round(
      active.summary.avgComplexity * active.summary.productionFiles * 0.4 +
      active.summary.totalTodos * 1.5 +
      active.summary.legacyLanguageFiles * 4,
    );
    const { data } = await lensRun('legacy', 'recordDebtSnapshot', {
      codebaseId: active.id,
      label: `${active.name} ${new Date().toISOString().slice(0, 10)}`,
      totalDebt,
      moduleCount: active.summary.productionFiles,
      criticalModules: active.summary.legacyLanguageFiles,
    });
    if (data.ok) {
      setSnapMsg(`Snapshot recorded — debt index ${totalDebt}`);
      if (tab === 'trend') runAnalysis('trend', active);
      else setAnalysis((prev) => ({ ...prev, trend: undefined as any }));
      setTimeout(() => setSnapMsg(null), 4000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading scanned codebases…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Scan ingest ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3 text-sm">
          <FolderSearch className="w-4 h-4 text-neon-cyan" /> Scan a Codebase
        </h3>
        <p className="text-xs text-zinc-500 mb-3">
          Paste source files to ingest. Delimit multiple files with <code className="text-zinc-300">=== path/to/file.ext ===</code> headers
          on their own line. The scanner derives lines-of-code, cyclomatic complexity, imports, TODO debt and language per file.
        </p>
        <input
          value={scanName}
          onChange={(e) => setScanName(e.target.value)}
          placeholder="Codebase name (e.g. payments-service)"
          className="w-full mb-2 bg-black/40 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:border-neon-cyan focus:outline-none"
        />
        <textarea
          value={scanText}
          onChange={(e) => setScanText(e.target.value)}
          placeholder={'=== src/auth.js ===\nimport { db } from "./db";\nfunction login(u){ if(u){ ... } }\n\n=== src/db.js ===\n...'}
          rows={7}
          className="w-full bg-black/40 border border-zinc-800 rounded px-3 py-2 text-xs font-mono focus:border-neon-cyan focus:outline-none resize-y"
        />
        {scanErr && <p className="text-xs text-rose-400 mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{scanErr}</p>}
        <button
          onClick={runScan}
          disabled={scanning}
          className="btn-secondary text-sm mt-2 flex items-center gap-1.5 disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderSearch className="w-3.5 h-3.5" />}
          Scan Codebase
        </button>
      </div>

      {/* ── Codebase selector ── */}
      {codebases.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <FileCode className="w-4 h-4 text-neon-purple" /> Scanned Codebases ({codebases.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {codebases.map((cb) => (
              <div
                key={cb.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 cursor-pointer transition-colors ${
                  active?.id === cb.id
                    ? 'border-neon-cyan/50 bg-neon-cyan/10'
                    : 'border-zinc-800 bg-black/40 hover:border-zinc-600'
                }`}
                onClick={() => { setActive(cb); setAnalysis({} as Record<Tab, any>); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                <span className="text-sm">{cb.name}</span>
                <span className="text-[10px] text-zinc-500">{cb.summary.fileCount}f · {cb.summary.totalLinesOfCode} LOC</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteCodebase(cb.id); }}
                  className="text-zinc-600 hover:text-rose-400"
                  aria-label={`Delete ${cb.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {active && (
        <>
          {/* ── Computed metrics (replaces the old fake panel) ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Total LOC" value={active.summary.totalLinesOfCode.toLocaleString()} />
            <Metric label="Production Files" value={String(active.summary.productionFiles)} />
            <Metric label="Avg Complexity" value={active.summary.avgComplexity.toFixed(1)} />
            <Metric label="Test : Code Ratio" value={active.summary.testToCodeRatio.toFixed(2)} />
            <Metric label="Legacy-Lang Files" value={String(active.summary.legacyLanguageFiles)} tone={active.summary.legacyLanguageFiles > 0 ? 'warn' : 'ok'} />
            <Metric label="TODO / FIXME Debt" value={String(active.summary.totalTodos)} tone={active.summary.totalTodos > 0 ? 'warn' : 'ok'} />
            <Metric label="Comment Ratio" value={`${(active.summary.avgCommentRatio * 100).toFixed(0)}%`} />
            <Metric label="Languages" value={String(active.languages.length)} />
          </div>

          {/* ── Language composition ── */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h3 className="font-semibold text-sm mb-3">Language Composition</h3>
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              {active.languages.map((l, i) => (
                <div
                  key={l.language}
                  style={{ width: `${l.pctOfCodebase}%`, background: LANG_PALETTE[i % LANG_PALETTE.length] }}
                  title={`${l.language} — ${l.pctOfCodebase}%`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {active.languages.map((l, i) => (
                <span key={l.language} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: LANG_PALETTE[i % LANG_PALETTE.length] }} />
                  <span className={l.legacy ? 'text-amber-400' : 'text-zinc-300'}>{l.language}</span>
                  <span className="text-zinc-500">{l.pctOfCodebase}%{l.legacy ? ' · legacy' : ''}</span>
                </span>
              ))}
            </div>
          </div>

          {/* ── Analysis tabs ── */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60">
            <div className="flex flex-wrap border-b border-zinc-800">
              {([
                ['graph', 'Dependency Graph', GitFork],
                ['hotspots', 'Hotspots', Flame],
                ['roadmap', 'Migration Roadmap', MapIcon],
                ['roi', 'Modernization ROI', DollarSign],
                ['cloud', 'Cloud Readiness', Cloud],
                ['trend', 'Debt Trend', TrendingUp],
              ] as [Tab, string, typeof GitFork][]).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                    tab === id ? 'text-neon-cyan border-b-2 border-neon-cyan' : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="p-4">
              {analyzing === tab ? (
                <div className="flex items-center gap-2 text-zinc-500 text-sm py-6">
                  <Loader2 className="w-4 h-4 animate-spin" /> Computing {tab}…
                </div>
              ) : (
                <AnalysisPanel tab={tab} result={analysis[tab]} onSnapshot={recordSnapshot} snapMsg={snapMsg} />
              )}
            </div>
          </div>
        </>
      )}

      {codebases.length === 0 && (
        <p className="text-sm text-zinc-500 text-center py-8">
          No codebases scanned yet. Paste source above to derive real complexity, dependency and modernization metrics.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'ok' | 'warn' }) {
  const color = tone === 'warn' ? 'text-amber-400' : tone === 'ok' ? 'text-emerald-400' : 'text-white';
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}

function AnalysisPanel({ tab, result, onSnapshot, snapMsg }: {
  tab: Tab; result: any; onSnapshot: () => void; snapMsg: string | null;
}) {
  if (!result) return <p className="text-sm text-zinc-500 py-4">Select this tab to compute analysis.</p>;
  if (result.error) return <p className="text-sm text-rose-400 py-4">Analysis failed: {result.error}</p>;

  if (tab === 'graph') return <GraphPanel result={result} />;
  if (tab === 'hotspots') return <HotspotPanel result={result} />;
  if (tab === 'roadmap') return <RoadmapPanel result={result} />;
  if (tab === 'roi') return <RoiPanel result={result} />;
  if (tab === 'cloud') return <CloudPanel result={result} />;
  return <TrendPanel result={result} onSnapshot={onSnapshot} snapMsg={snapMsg} />;
}

interface GraphNode { id: string; label: string; fanIn: number; fanOut: number; coupling: number; instability: number; inCycle: boolean; hotspot: boolean; }
function GraphPanel({ result }: { result: any }) {
  const nodes = (result.nodes || []) as GraphNode[];
  const cycles = (result.cycles || []) as { id: number; members: string[]; size: number }[];
  const hotspots = (result.hotspots || []) as GraphNode[];
  const s = result.summary || {};
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs">
        <Stat label="Nodes" value={s.nodeCount} />
        <Stat label="Edges" value={s.edgeCount} />
        <Stat label="Cycles" value={s.cycleCount} tone={s.cycleCount > 0 ? 'bad' : 'good'} />
        <Stat label="Max Fan-Out" value={s.maxFanOut} />
        <Stat label="Max Fan-In" value={s.maxFanIn} />
        <Stat label="Avg Coupling" value={s.avgCoupling} />
      </div>
      {cycles.length > 0 && (
        <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 p-3">
          <p className="text-xs font-semibold text-rose-300 mb-1">Cyclic Dependencies ({cycles.length})</p>
          {cycles.map((c) => (
            <p key={c.id} className="text-[11px] text-rose-200/80">#{c.id} ({c.size}): {c.members.map((m) => m.split('/').pop()).join(' → ')}</p>
          ))}
        </div>
      )}
      {hotspots.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-zinc-300 mb-2">Coupling Hotspots</p>
          <ChartKit
            kind="bar"
            data={hotspots.map((n) => ({ name: n.label, 'Fan-In': n.fanIn, 'Fan-Out': n.fanOut }))}
            xKey="name"
            series={[{ key: 'Fan-In', color: '#06b6d4' }, { key: 'Fan-Out', color: '#f59e0b' }]}
            stacked
            height={220}
          />
        </div>
      ) : (
        <p className="text-xs text-zinc-500">No coupling hotspots detected — the module graph is loosely connected.</p>
      )}
      <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-black/40 text-zinc-500 sticky top-0">
            <tr><th className="text-left px-2 py-1">Module</th><th className="px-2">Fan-In</th><th className="px-2">Fan-Out</th><th className="px-2">Instability</th><th className="px-2">Flags</th></tr>
          </thead>
          <tbody>
            {nodes.slice(0, 40).map((n) => (
              <tr key={n.id} className="border-t border-zinc-900">
                <td className="px-2 py-1 text-zinc-300">{n.label}</td>
                <td className="px-2 text-center text-zinc-400">{n.fanIn}</td>
                <td className="px-2 text-center text-zinc-400">{n.fanOut}</td>
                <td className="px-2 text-center text-zinc-400">{n.instability}</td>
                <td className="px-2 text-center">
                  {n.inCycle && <span className="text-rose-400 mr-1">cycle</span>}
                  {n.hotspot && <span className="text-amber-400">hotspot</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Hotspot { path: string; language: string; churn: number; complexity: number; linesOfCode: number; hotspotIndex: number; priority: string; }
function HotspotPanel({ result }: { result: any }) {
  const hotspots = (result.hotspots || []) as Hotspot[];
  const s = result.summary || {};
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs">
        <Stat label="Files Ranked" value={s.fileCount} />
        <Stat label="Critical" value={s.criticalCount} tone={s.criticalCount > 0 ? 'bad' : 'good'} />
        <Stat label="High" value={s.highCount} tone="warn" />
        <Stat label="Avg Index" value={s.avgHotspotIndex} />
      </div>
      <p className="text-[11px] text-zinc-500">Hotspot index = √(normalized churn × normalized complexity) × 100 — a file must score high on <em>both</em> to surface.</p>
      <ChartKit
        kind="scatter"
        data={hotspots.map((h) => ({ churn: h.churn, complexity: h.complexity, name: h.path.split('/').pop() }))}
        xKey="churn"
        series={[{ key: 'complexity', label: 'Complexity', color: '#ef4444' }]}
        height={220}
        showLegend={false}
      />
      <div className="space-y-1">
        {hotspots.slice(0, 12).map((h) => (
          <div key={h.path} className="flex items-center gap-2 text-xs bg-black/40 rounded px-2 py-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${
              h.priority === 'critical' ? 'bg-rose-500' : h.priority === 'high' ? 'bg-amber-500' : h.priority === 'moderate' ? 'bg-yellow-500' : 'bg-zinc-600'
            }`} />
            <span className="flex-1 truncate text-zinc-300">{h.path}</span>
            <span className="text-zinc-500">churn {h.churn}</span>
            <span className="text-zinc-500">cx {h.complexity}</span>
            <span className="font-mono text-neon-cyan w-12 text-right">{h.hotspotIndex}</span>
          </div>
        ))}
      </div>
      {hotspots.length === 0 && <p className="text-xs text-zinc-500">No hotspots — supply churn data per file for a sharper ranking.</p>}
    </div>
  );
}

interface RoadmapModule { path: string; label: string; depth: number; effortHours: number; riskTag: string; legacy: boolean; }
interface RoadmapPhase { phase: number; dependencyDepth: number; rationale: string; modules: RoadmapModule[]; moduleCount: number; effortHours: number; }
function RoadmapPanel({ result }: { result: any }) {
  const phases = (result.phases || []) as RoadmapPhase[];
  const s = result.summary || {};
  const events: TimelineEvent[] = phases.map((p) => ({
    id: `phase-${p.phase}`,
    label: `Phase ${p.phase} · ${p.moduleCount} modules`,
    time: p.phase,
    tone: p.modules.some((m) => m.riskTag === 'high-complexity') ? 'bad' : p.modules.some((m) => m.legacy) ? 'warn' : 'good',
    detail: `${p.effortHours}h — ${p.rationale}`,
  }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs">
        <Stat label="Modules" value={s.totalModules} />
        <Stat label="Phases" value={s.totalPhases} />
        <Stat label="Effort (hrs)" value={s.totalEffortHours} />
        <Stat label="Effort (weeks)" value={s.totalEffortWeeks} />
        <Stat label="High-Risk" value={s.highRiskModules} tone={s.highRiskModules > 0 ? 'warn' : 'good'} />
      </div>
      {events.length > 0 && <TimelineView events={events} height={110} />}
      <div className="space-y-3">
        {phases.map((p) => (
          <div key={p.phase} className="rounded-lg border border-zinc-800 bg-black/30 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-neon-cyan">Phase {p.phase}</p>
              <span className="text-xs text-zinc-500">{p.effortHours}h · {p.moduleCount} modules</span>
            </div>
            <p className="text-[11px] text-zinc-500 mb-2">{p.rationale}</p>
            <div className="flex flex-wrap gap-1">
              {p.modules.map((m) => (
                <span key={m.path} className={`text-[10px] rounded px-1.5 py-0.5 border ${
                  m.riskTag === 'high-complexity' ? 'border-rose-800 bg-rose-950/40 text-rose-300'
                  : m.riskTag === 'legacy-language' ? 'border-amber-800 bg-amber-950/40 text-amber-300'
                  : m.riskTag === 'large-file' ? 'border-yellow-800 bg-yellow-950/40 text-yellow-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                }`}>{m.label} · {m.effortHours}h</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {phases.length === 0 && <p className="text-xs text-zinc-500">No roadmap — scan a codebase with internal imports to sequence phases.</p>}
    </div>
  );
}

interface RoiModule { name: string; recommendation: string; reasoning: string; debtScore: number; actionCost: number; annualSaving: number; paybackYears: number | null; fiveYearNetBenefit: number; costs: { rewrite: number; refactor: number; retire: number }; }
function RoiPanel({ result }: { result: any }) {
  const modules = (result.modules || []) as RoiModule[];
  const s = result.summary || {};
  const recs = s.recommendations || {};
  const recColor = (r: string) => r === 'rewrite' ? 'text-rose-400' : r === 'refactor' ? 'text-amber-400' : r === 'retire' ? 'text-zinc-400' : 'text-emerald-400';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs">
        <Stat label="Action Cost" value={`$${(s.totalActionCost || 0).toLocaleString()}`} />
        <Stat label="Annual Saving" value={`$${(s.totalAnnualSaving || 0).toLocaleString()}`} tone="good" />
        <Stat label="5-Yr Net" value={`$${(s.totalFiveYearNet || 0).toLocaleString()}`} tone={s.totalFiveYearNet >= 0 ? 'good' : 'bad'} />
        <Stat label="Blended Rate" value={`$${s.blendedRate}/h`} />
      </div>
      <div className="flex gap-2 text-xs">
        {(['rewrite', 'refactor', 'retire', 'retain'] as const).map((r) => (
          <span key={r} className="rounded border border-zinc-800 bg-black/40 px-2 py-1">
            <span className={`font-bold ${recColor(r)}`}>{recs[r] || 0}</span> <span className="text-zinc-500">{r}</span>
          </span>
        ))}
      </div>
      <ChartKit
        kind="bar"
        data={modules.slice(0, 12).map((m) => ({ name: m.name.split('/').pop(), Rewrite: m.costs.rewrite, Refactor: m.costs.refactor, Retire: m.costs.retire }))}
        xKey="name"
        series={[{ key: 'Rewrite', color: '#ef4444' }, { key: 'Refactor', color: '#f59e0b' }, { key: 'Retire', color: '#71717a' }]}
        height={220}
      />
      <div className="space-y-1">
        {modules.slice(0, 12).map((m) => (
          <div key={m.name} className="text-xs bg-black/40 rounded px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-zinc-300">{m.name}</span>
              <span className={`font-semibold uppercase text-[10px] ${recColor(m.recommendation)}`}>{m.recommendation}</span>
              <span className="text-zinc-500">5-yr net ${m.fiveYearNetBenefit.toLocaleString()}</span>
            </div>
            <p className="text-[10px] text-zinc-500 mt-0.5">{m.reasoning}{m.paybackYears != null ? ` · payback ${m.paybackYears}y` : ''}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

interface CloudDim { dimension: string; weight: number; pass: boolean | null; }
interface CloudComponent { name: string; readinessScore: number | null; readinessLevel: string; blockers: string[]; dimensions: CloudDim[]; }
function CloudPanel({ result }: { result: any }) {
  const components = (result.components || []) as CloudComponent[];
  const s = result.summary || {};
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs">
        <Stat label="Components" value={s.totalComponents} />
        <Stat label="Avg Readiness" value={s.avgReadiness == null ? 'unknown' : `${s.avgReadiness}%`} />
        <Stat label="Lift & Shift" value={s.liftAndShiftReady} tone="good" />
        <Stat label="Re-Architect" value={s.needsReArchitecture} tone={s.needsReArchitecture > 0 ? 'bad' : 'good'} />
      </div>
      {result.derivedFromScan && s.note && (
        <p className="text-[11px] text-amber-400/80 bg-amber-950/20 border border-amber-900/40 rounded px-2 py-1.5">{s.note}</p>
      )}
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {components.slice(0, 30).map((c) => (
          <div key={c.name} className="flex items-center gap-2 text-xs bg-black/40 rounded px-2 py-1.5">
            <span className="flex-1 truncate text-zinc-300">{c.name}</span>
            {c.readinessScore != null && <span className="font-mono text-neon-cyan w-10 text-right">{c.readinessScore}%</span>}
            <span className={`text-[10px] uppercase ${
              c.readinessLevel === 'lift-and-shift' ? 'text-emerald-400'
              : c.readinessLevel === 'minor-refactor' ? 'text-yellow-400'
              : c.readinessLevel === 'significant-refactor' ? 'text-amber-400'
              : c.readinessLevel === 're-architect' ? 'text-rose-400' : 'text-zinc-500'
            }`}>{c.readinessLevel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TrendSnapshot { index: number; label: string; totalDebt: number; criticalModules: number; recordedAt: string; }
function TrendPanel({ result, onSnapshot, snapMsg }: { result: any; onSnapshot: () => void; snapMsg: string | null }) {
  const snapshots = (result.snapshots || []) as TrendSnapshot[];
  const trend = result.trend;
  const treeData: TreeNode[] = trend ? [{
    id: 'trend',
    label: `Debt trend: ${trend.direction}`,
    tone: trend.direction === 'increasing' ? 'bad' : trend.direction === 'decreasing' ? 'good' : 'info',
    children: [
      { id: 't1', label: `Slope per snapshot: ${trend.slopePerSnapshot}` },
      { id: 't2', label: `Net change: ${trend.netChange}${trend.pctChange != null ? ` (${trend.pctChange}%)` : ''}` },
      { id: 't3', label: `Projected next debt: ${trend.projectedNextDebt}`, tone: 'warn' },
    ],
  }] : [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-zinc-500">Debt snapshots build a history so trend tracking has a line to fit.</p>
        <button onClick={onSnapshot} className="btn-secondary text-xs flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" /> Record Snapshot
        </button>
      </div>
      {snapMsg && <p className="text-xs text-emerald-400">{snapMsg}</p>}
      {snapshots.length === 0 ? (
        <p className="text-sm text-zinc-500 py-4">{result.message || 'No snapshots yet — record one to start the trend.'}</p>
      ) : (
        <>
          <ChartKit
            kind="area"
            data={snapshots.map((s) => ({ label: s.label, Debt: s.totalDebt, Critical: s.criticalModules }))}
            xKey="label"
            series={[{ key: 'Debt', color: '#ef4444' }, { key: 'Critical', color: '#f59e0b' }]}
            height={220}
          />
          {treeData.length > 0 && <TreeDiagram root={treeData} />}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: unknown; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-rose-400' : tone === 'warn' ? 'text-amber-400' : tone === 'good' ? 'text-emerald-400' : 'text-neon-cyan';
  return (
    <span className="rounded border border-zinc-800 bg-black/40 px-2 py-1">
      <span className={`font-bold ${color}`}>{value == null ? '—' : String(value)}</span> <span className="text-zinc-500">{label}</span>
    </span>
  );
}
